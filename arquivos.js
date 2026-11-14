/* Leitura de ZIP e XLSX sem bibliotecas externas (usa DecompressionStream do navegador).
   Funciona no navegador e no Node 18+ (para testes). */
(function (raiz) {
  "use strict";

  async function inflarRaw(bytes) {
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** Lê um arquivo ZIP. Retorna {nome: Uint8Array} (só os nomes pedidos, se `filtro`). */
  async function lerZip(buffer, filtro) {
    const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    // procura o "End of central directory"
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("Arquivo ZIP inválido.");
    const total = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const saida = {};
    for (let n = 0; n < total; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const metodo = dv.getUint16(p + 10, true);
      const tamComp = dv.getUint32(p + 20, true);
      const lenNome = dv.getUint16(p + 28, true);
      const lenExtra = dv.getUint16(p + 30, true);
      const lenCom = dv.getUint16(p + 32, true);
      const offLocal = dv.getUint32(p + 42, true);
      const nome = dec.decode(u8.subarray(p + 46, p + 46 + lenNome));
      p += 46 + lenNome + lenExtra + lenCom;
      if (filtro && !filtro(nome)) continue;
      const lnome = dv.getUint16(offLocal + 26, true);
      const lextra = dv.getUint16(offLocal + 28, true);
      const ini = offLocal + 30 + lnome + lextra;
      const dados = u8.subarray(ini, ini + tamComp);
      if (metodo === 0) saida[nome] = dados.slice();
      else if (metodo === 8) saida[nome] = await inflarRaw(dados);
      else throw new Error(`Compressão ZIP não suportada (${metodo}) em ${nome}`);
    }
    return saida;
  }

  // ------------------------------------------------------------------ XLSX
  const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  function desescapar(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
      if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENT[e.toLowerCase()];
    });
  }

  function colIdx(ref) {
    let n = 0;
    for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  function textoDeSi(xml) {
    // junta todos os <t> (texto com formatação rica tem vários <r><t>)
    let s = "";
    const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
    let m;
    while ((m = re.exec(xml))) s += m[1] ? desescapar(m[1]) : "";
    return s;
  }

  /** Lê um .xlsx. Retorna {nomeDaAba: [[celulas]]} com strings (ou "" para vazio). */
  async function lerXlsx(buffer) {
    const arq = await lerZip(buffer, n => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(n));
    const dec = new TextDecoder();
    const txt = n => (arq[n] ? dec.decode(arq[n]) : "");
    const compart = [];
    const ss = txt("xl/sharedStrings.xml");
    const reSi = /<si>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = reSi.exec(ss))) compart.push(textoDeSi(m[1]));

    const rels = {};
    const relsXml = txt("xl/_rels/workbook.xml.rels");
    const reRel = /<Relationship\b[^>]*>/g;
    while ((m = reRel.exec(relsXml))) {
      const id = /Id="([^"]+)"/.exec(m[0]), alvo = /Target="([^"]+)"/.exec(m[0]);
      if (id && alvo) rels[id[1]] = alvo[1].replace(/^\/?(xl\/)?/, "xl/");
    }
    const abas = {};
    const wb = txt("xl/workbook.xml");
    const reSheet = /<sheet\b[^>]*>/g;
    while ((m = reSheet.exec(wb))) {
      const nome = desescapar(/name="([^"]*)"/.exec(m[0])[1]);
      const rid = /r:id="([^"]+)"/.exec(m[0]);
      const caminho = rid && rels[rid[1]];
      abas[nome] = caminho && arq[caminho] ? lerAba(dec.decode(arq[caminho]), compart) : [];
    }
    return abas;
  }

  function lerAba(xml, compart) {
    const linhas = [];
    const reRow = /<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g;
    let m;
    while ((m = reRow.exec(xml))) {
      const attrs = m[1] || m[3] || "";
      const r = /\br="(\d+)"/.exec(attrs);
      const ri = r ? parseInt(r[1], 10) - 1 : linhas.length;
      const linha = [];
      const corpo = m[2] || "";
      const reC = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let c, auto = 0;
      while ((c = reC.exec(corpo))) {
        const a = c[1];
        const ref = /\br="([A-Z]+\d+)"/.exec(a);
        const ci = ref ? colIdx(ref[1]) : auto;
        auto = ci + 1;
        const tipo = (/\bt="([^"]+)"/.exec(a) || [])[1];
        const inner = c[2] || "";
        let v = "";
        if (tipo === "inlineStr") v = textoDeSi(inner);
        else {
          const vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
          if (vm) {
            v = desescapar(vm[1]);
            if (tipo === "s") v = compart[parseInt(v, 10)] ?? "";
          }
        }
        linha[ci] = v;
      }
      for (let i = 0; i < linha.length; i++) if (linha[i] === undefined) linha[i] = "";
      linhas[ri] = linha;
    }
    for (let i = 0; i < linhas.length; i++) if (!linhas[i]) linhas[i] = [];
    return linhas;
  }

  // ------------------------------------------------------------------ escrita de ZIP (sem compressão)
  const TAB_CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = TAB_CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** Cria um ZIP (método "store"). arquivos: [{nome, conteudo: string|Uint8Array}] */
  function criarZip(arquivos) {
    const enc = new TextEncoder();
    const partes = [], central = [];
    let off = 0;
    const agora = new Date();
    const dosT = (agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1);
    const dosD = ((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();
    for (const a of arquivos) {
      const nome = enc.encode(a.nome);
      const dados = typeof a.conteudo === "string" ? enc.encode(a.conteudo) : a.conteudo;
      const crc = crc32(dados);
      const loc = new DataView(new ArrayBuffer(30));
      loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true);
      loc.setUint16(8, 0, true); loc.setUint16(10, dosT, true); loc.setUint16(12, dosD, true);
      loc.setUint32(14, crc, true); loc.setUint32(18, dados.length, true); loc.setUint32(22, dados.length, true);
      loc.setUint16(26, nome.length, true); loc.setUint16(28, 0, true);
      partes.push(new Uint8Array(loc.buffer), nome, dados);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true); cen.setUint16(12, dosT, true); cen.setUint16(14, dosD, true);
      cen.setUint32(16, crc, true); cen.setUint32(20, dados.length, true); cen.setUint32(24, dados.length, true);
      cen.setUint16(28, nome.length, true); cen.setUint32(42, off, true);
      central.push(new Uint8Array(cen.buffer), nome);
      off += 30 + nome.length + dados.length;
    }
    const tamCentral = central.reduce((s, p) => s + p.length, 0);
    const fim = new DataView(new ArrayBuffer(22));
    fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true);
    fim.setUint32(12, tamCentral, true); fim.setUint32(16, off, true);
    return new Blob([...partes, ...central, new Uint8Array(fim.buffer)], { type: "application/zip" });
  }

  const api = { lerZip, lerXlsx, criarZip, desescapar };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.Arquivos = api;
})(typeof self !== "undefined" ? self : this);
