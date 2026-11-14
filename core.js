/* HLA Consenso - núcleo (sem interface). Funciona no navegador e no Node (testes).
   - lê o export TARR (XML) do NGSengine
   - lê o relatório Excel do AlloSeq Assign
   - compara as tipagens (ConclusiveTypingResult/GLString x aba Ambiguities)
   - avalia métricas de qualidade
   - gera os arquivos SISHLA / REDOME no mesmo formato do ngsengine_to_sishla_report */
(function (raiz) {
  "use strict";

  const LOCOS = ["HLA-A", "HLA-B", "HLA-C", "HLA-DRB1", "HLA-DRB3", "HLA-DRB4", "HLA-DRB5",
                 "HLA-DQB1", "HLA-DQA1", "HLA-DPB1", "HLA-DPA1"];

  // ================================================================== XML
  /** Remove blocos enormes que o app não usa (sequências, listas de genótipos,
   *  regiões do banco). Reduz ~65 MB para poucos MB antes do parse. */
  function enxugarXml(t) {
    const remover = (txt, tag) => txt
      .replace(new RegExp(`<${tag}\\b[^>]*?\\/>`, "g"), "")                       // forma vazia <Tag ... />
      .replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "g"), "");   // bloco completo
    for (const tag of ["GenoTypeList", "GenotypeRanking", "Haplotypes", "Matching", "Features", "Regions", "PriorityRegions"])
      t = remover(t, tag);
    return t.replace(/(<AlleleSequence\b[^>]*>)[^<]*(<\/AlleleSequence>)/g, "$1$2");
  }

  function desesc(s) {
    return s.indexOf("&") < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
      if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e.toLowerCase()];
    });
  }

  /** Parser XML mínimo -> {t: tag, a: atributos, c: filhos, x: texto} */
  function parseXml(texto) {
    const raizN = { t: "#doc", a: {}, c: [], x: "" };
    const pilha = [raizN];
    const re = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=>\/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    const reA = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(texto))) {
      const topo = pilha[pilha.length - 1];
      if (m[6] !== undefined) { if (topo.c.length === 0) topo.x += m[6]; continue; }
      if (m[1] !== undefined) { topo.x += m[1]; continue; }
      if (!m[3]) continue;                       // declaração / comentário
      if (m[2] === "/") { pilha.pop(); continue; }
      const no = { t: m[3], a: {}, c: [], x: "" };
      if (m[4]) { let a; reA.lastIndex = 0; while ((a = reA.exec(m[4]))) no.a[a[1]] = desesc(a[2] ?? a[3]); }
      topo.c.push(no);
      if (m[5] !== "/") pilha.push(no);
    }
    return raizN;
  }

  const filho = (n, t) => (n ? n.c.find(k => k.t === t) : undefined);
  const filhos = (n, t) => (n ? n.c.filter(k => k.t === t) : []);
  function caminho(n, p) { for (const t of p.split("/")) { n = filho(n, t); if (!n) return undefined; } return n; }
  const texto = (n, p) => { const k = p ? caminho(n, p) : n; return k ? desesc(k.x).trim() : ""; };
  const atr = (n, p, a) => { const k = p ? caminho(n, p) : n; return k && k.a[a] !== undefined ? k.a[a] : ""; };
  const num = v => { if (v === "" || v === undefined || v === null) return null; const f = parseFloat(v); return Number.isFinite(f) && f > -1e30 && f !== -1 ? f : null; };

  // ================================================================== NGSengine
  function idDaAmostra(nome) { return String(nome || "").split("-")[0]; }
  function chaveId(id) { return String(id || "").trim().replace(/^0+/, "") || "0"; }

  function metricasRegiao(rq) {
    const rd = caminho(rq, "InputData/ReadDepth");
    const noise = filho(rq, "Noise");
    const tn = filho(noise, "TotalNoiseLevel");
    const sb = filho(noise, "SecondBaseStatisticsAtHeterozygotes");
    const an = filho(rq, "Analysis");
    return {
      profMin: num(atr(rd, "", "minimum")), profMed: num(atr(rd, "", "median")),
      profMedia: num(atr(rd, "", "average")), profMax: num(atr(rd, "", "maximum")),
      sinalRuido: num(atr(noise, "", "minimumHeterozygousVsMaxTotalNoise")),
      ruidoMax: num(atr(tn, "", "maximum")), ruidoMedio: num(atr(tn, "", "average")),
      segBaseMin: num(atr(sb, "", "minimum")), segBaseMedia: num(atr(sb, "", "average")),
      posHet: num(atr(an, "", "heterozygousPosnsCount")),
      cobertura: num(atr(rq, "", "analysisCoveredFraction")),
    };
  }

  /** Lê o export TARR do NGSengine. */
  function lerEngine(xmlTexto, nomeArquivo) {
    const doc = parseXml(enxugarXml(xmlTexto));
    const px = filho(doc, "ProjectXml");
    if (!px) throw new Error(`${nomeArquivo}: não parece um export TARR do NGSengine (falta <ProjectXml>).`);
    const proj = {
      arquivo: nomeArquivo,
      projeto: texto(px, "ProjectName"),
      software: texto(px, "AnalysisSoftware/Software"),
      versao: texto(px, "AnalysisSoftware/Version"),
      usuario: atr(px, "User", "Name"),
      exportadoEm: atr(px, "User", "DateTime"),
      pasta: texto(px, "ProjectFolder"),
      amostras: [], locos: [],
    };
    for (const s of filhos(caminho(px, "Samples"), "Sample")) {
      const nome = texto(s, "Name");
      const id = idDaAmostra(nome);
      const arquivos = filhos(caminho(s, "Files"), "File").map(f => texto(f));
      const outros = filhos(caminho(s, "DetectedLoci"), "DetectedLocus").map(d => ({
        locus: d.a.Name, fracao: num(atr(d, "ReadAssignment", "AssignedFraction")),
        reads: num(atr(d, "ReadAssignment", "CountAssignedReads")),
      }));
      const amostra = {
        id, chave: chaveId(id), nome,
        readsTotal: num(atr(s, "Mappability", "TotalReads")),
        readsAceitos: num(atr(s, "Mappability", "AcceptedReads")),
        mapPct: num(atr(s, "Mappability", "PercentageUsed")),
        pastaFastq: arquivos[0] ? arquivos[0].split(/[\\/]/).slice(-2, -1)[0] : "",
        arquivos, outrosLocos: outros,
      };
      proj.amostras.push(amostra);

      for (const l of filhos(caminho(s, "Loci"), "Locus")) {
        const locus = texto(l, "Name");
        const rev = filho(l, "ReviewList");
        const revisoes = filhos(rev, "Review").map(r => ({
          acao: r.a.Action, nome: atr(r, "User", "Name"), quando: atr(r, "User", "DateTime"),
          nivel: atr(r, "User", "Level"), comentario: texto(r, "Comment"),
        }));
        const regioes = {};
        for (const rq of filhos(caminho(l, "PreferredAnalysisRegionsQualityMetrics"), "RegionQualityMetrics"))
          regioes[rq.a.region] = metricasRegiao(rq);
        const alelosAnot = filhos(caminho(l, "AnnotatedAlleles"), "AnnotatedAllele").map(a => ({
          alelo: atr(a, "AlleleSequence", "Match"),
          estendido: texto(a, "Extended") === "true",
          mismatches: num(texto(a, "Mismatches")) || 0,
          mmExon: num(atr(a, "AlleleSequence", "ExonMismatches")) || 0,
          mmIntron: num(atr(a, "AlleleSequence", "IntronMismatches")) || 0,
          mmCore: num(atr(a, "AlleleSequence", "CorePlusMM")) || 0,
        }));
        const edicoes = (caminho(l, "Edits") || { c: [] }).c.map(e => ({
          tipo: e.t, acao: e.a.action, posicao: e.a.position, de: e.a.fromBases, para: e.a.toBases,
          usuario: e.a.user, quando: e.a.datetime,
        }));
        const qmp = caminho(l, "QuestionMarkPositions");
        const avisos = (caminho(l, "Warnings") || { c: [] }).c.map(w => desesc(w.x || w.t).trim()).filter(Boolean);
        const conc = caminho(l, "ConclusiveTypingResult");
        proj.locos.push({
          id, chave: chaveId(id), amostra: nome, locus,
          imgt: texto(l, "AlleleDB/Version"),
          status: rev ? rev.a.CurrentApprovalStatus || "" : "",
          nivelRevisao: rev ? rev.a.Level || "" : "",
          revisoes,
          glConclusiva: conc ? texto(conc, "Typing/GLString") : "",
          resolucaoConclusiva: conc ? texto(conc, "Settings/Resolution") : "",
          glResultado: texto(l, "TypingResult/GLString"),
          gl3: texto(l, "TypingResultThreeFields/GLString"),
          glP: texto(l, "TypingResultPGroup/GLString"),
          glG: texto(l, "TypingResultGGroup/GLString"),
          nmdp1: atr(l, "TypingResult/NMDPCodes/allele_1", "Name"),
          nmdp2: atr(l, "TypingResult/NMDPCodes/allele_2", "Name"),
          nGenotipos: num(texto(l, "NumberOfGenotypes")),
          regioesFase: num(texto(l, "PhasingRegions")),
          interrogacoes: qmp ? qmp.c.length : 0,
          mapPct: num(atr(l, "Mappability", "PercentageUsed")),
          readsAceitos: num(atr(l, "Mappability", "AcceptedReads")),
          leituraMedia: num(atr(l, "ReadLength", "Mean")),
          insertMedio: num(atr(l, "TotalLocusQualityMetrics/Analysis/Aligning/InsertSizeDistributionAllReads", "average")),
          regioes, alelosAnot, edicoes, avisos,
        });
      }
    }
    return proj;
  }

  // ================================================================== Assign
  const MAPA_LOCUS_ASSIGN = c => "HLA-" + String(c).replace(/^IMGT\//i, "").replace(/^HLA-/i, "").trim();

  /** Lê uma aba "por amostra" do Assign: cabeçalho na linha com "IMGT/...",
   *  cada amostra ocupa 2 linhas (id na 1ª). Retorna {id: {locus: [v1, v2]}} */
  function lerAbaAssign(linhas) {
    // cabeçalho = linha com várias colunas "IMGT/<locus>" (a linha "References: IMGT/HLA..." não conta)
    const ih = linhas.findIndex(r => r && r.filter(v => /^IMGT\/[A-Z0-9]+$/i.test(String(v || "").trim())).length >= 2);
    if (ih < 0) return { locos: [], dados: {} };
    const cab = linhas[ih];
    const cols = [];
    cab.forEach((v, i) => { if (/^IMGT\/[A-Z0-9]+$/i.test(String(v || "").trim())) cols.push([i, MAPA_LOCUS_ASSIGN(v)]); });
    const dados = {};
    let atual = null;
    for (let r = ih + 1; r < linhas.length; r++) {
      const row = linhas[r] || [];
      const id0 = String(row[0] ?? "").trim();
      if (id0) { atual = id0; dados[atual] = dados[atual] || {}; }
      if (!atual) continue;
      for (const [ci, lc] of cols) {
        const v = String(row[ci] ?? "").trim();
        (dados[atual][lc] = dados[atual][lc] || []).push(v);
      }
    }
    return { locos: cols.map(c => c[1]), dados };
  }

  function lerAssign(abas, nomeArquivo) {
    const sumario = abas["Summary"] || [];
    const info = {};
    for (const r of sumario.slice(0, 8)) {
      const k = String(r[0] || "").replace(/:$/, "").trim();
      if (k && r[1]) info[k] = String(r[1]).trim();
    }
    const S = lerAbaAssign(sumario), A = lerAbaAssign(abas["Ambiguities"] || []);
    const Q = lerAbaAssign(abas["Quality"] || []), C = lerAbaAssign(abas["Coverage"] || []);
    const B = lerAbaAssign(abas["Allele Balance"] || []), M = lerAbaAssign(abas["Motif"] || []);
    const E = lerAbaAssign(abas["User Edits"] || []), K = lerAbaAssign(abas["Comments"] || []);
    if (!S.locos.length && !A.locos.length)
      throw new Error(`${nomeArquivo}: não encontrei as abas Summary/Ambiguities do Assign.`);
    const ids = new Set([...Object.keys(S.dados), ...Object.keys(A.dados)]);
    const locos = [];
    const v = (T, id, lc) => ((T.dados[id] || {})[lc] || []).filter(Boolean);
    const pct = s => { const f = parseFloat(String(s).replace("%", "")); return Number.isFinite(f) ? f : null; };
    for (const id of ids) {
      for (const lc of (S.locos.length ? S.locos : A.locos)) {
        const sum = v(S, id, lc);
        const amb = v(A, id, lc).join(" / ");
        const q30 = v(Q, id, lc).map(pct).filter(x => x !== null);
        const cov = v(C, id, lc).map(x => parseFloat(x)).filter(Number.isFinite);
        const bal = v(B, id, lc).map(pct).filter(x => x !== null);
        locos.push({
          id, chave: chaveId(id), locus: lc, arquivo: nomeArquivo,
          alelo1: sum[0] || "", alelo2: sum[1] || "",
          gl: amb.replace(/\s+/g, ""),
          q30: q30.length ? Math.min(...q30) : null,
          cobertura: cov.length ? Math.min(...cov) : null,
          balanco: bal.length ? Math.min(...bal) : null,
          motivo: v(M, id, lc).join("; "),
          edicoes: v(E, id, lc).join("; "),
          comentarios: v(K, id, lc).join("; "),
        });
      }
    }
    return {
      arquivo: nomeArquivo, software: info["Software"] || "", referencia: info["References"] || "",
      operador: info["Operator"] || "", criado: info["Created"] || "", locos,
    };
  }

  // ================================================================== nomenclatura / genótipos
  const SUFIXO = /([NLSCAQ])$/;
  /** Reduz um alelo a `n` campos, preservando sufixo de expressão (N, L, S, Q...). */
  function reduzirCampos(alelo, n) {
    const a = String(alelo || "").trim().replace(/^HLA-/, "");
    const i = a.indexOf("*");
    if (i < 0) return a;
    let resto = a.slice(i + 1);
    const suf = (SUFIXO.exec(resto) || [""])[0];
    if (suf) resto = resto.slice(0, -1);
    const campos = resto.split(":");
    if (campos.length <= n) return a;
    return a.slice(0, i + 1) + campos.slice(0, n).join(":") + suf;
  }
  /** Equivalente à redução 'exon' (3 campos) aplicada pelo app atual nos códigos NMDP. */
  const tresCampos = a => (String(a || "").split(":").length > 3 ? reduzirCampos(a, 3) : String(a || ""));

  function prefixarLocus(locus, v) {
    v = String(v || "").trim();
    if (!v) return "";
    if (v.includes("*")) return v;
    return locus.replace(/^HLA-/, "") + "*" + v;
  }

  /** GL do NGSengine: '|' separa genótipos, '+' os dois alelos, '/' alelos alternativos. */
  function genotiposEngine(gl) {
    const out = [];
    for (const g of String(gl || "").split("|").map(s => s.trim()).filter(Boolean)) {
      const lados = g.split("+").map(l => l.split("/").map(a => a.trim()).filter(Boolean));
      out.push(lados);
    }
    return out;
  }
  /** GL do Assign (aba Ambiguities): genótipos "X + Y" separados por '/'. */
  function genotiposAssign(gl) {
    const out = [];
    for (const g of String(gl || "").replace(/\s+/g, "").split("/").filter(Boolean))
      out.push(g.split("+").filter(Boolean).map(a => [a]));
    return out;
  }

  /** Converte genótipos em conjunto de pares normalizados "a+b" (ordenados). */
  function paresDe(genotipos, campos, ignorarNulos) {
    const pares = new Set();
    let primeiro = null;
    for (const lados of genotipos) {
      const L = lados[0] || [], R = lados.length > 1 ? lados[1] : lados[0] || [];   // hemizigoto -> X+X
      for (const a of L) for (const b of R) {
        const x = reduzirCampos(a, campos), y = reduzirCampos(b, campos);
        const par = [x, y].sort().join("+");
        if (primeiro === null) primeiro = par;
        if (ignorarNulos && (/N$/.test(x) || /N$/.test(y))) continue;
        pares.add(par);
      }
    }
    if (ignorarNulos && pares.size === 0 && primeiro) pares.add(primeiro);   // só havia nulos
    return { pares, primeiro };
  }

  const STATUS = {
    identico:   { rotulo: "Concordante",                  ordem: 0, cor: "ok" },
    principal:  { rotulo: "Concordante no 1º genótipo",   ordem: 1, cor: "ok2" },
    parcial:    { rotulo: "Concordância parcial",         ordem: 3, cor: "aviso" },
    campos2:    { rotulo: "Concordante só em 2 campos",   ordem: 4, cor: "aviso" },
    divergente: { rotulo: "Divergente",                   ordem: 5, cor: "erro" },
    so_engine:  { rotulo: "Só NGSengine",                 ordem: 6, cor: "lado" },
    so_assign:  { rotulo: "Só Assign",                    ordem: 6, cor: "lado" },
    ausente:    { rotulo: "Não tipado (ambos)",           ordem: 9, cor: "vazio" },
  };

  function comparar(glEngine, glAssign, opc) {
    const ign = opc ? opc.ignorarNulos !== false : true;
    const temE = !!String(glEngine || "").trim(), temA = !!String(glAssign || "").trim();
    if (!temE && !temA) return { status: "ausente" };
    if (!temE) return { status: "so_assign" };
    if (!temA) return { status: "so_engine" };
    const gE = genotiposEngine(glEngine), gA = genotiposAssign(glAssign);
    const e3 = paresDe(gE, 3, ign), a3 = paresDe(gA, 3, ign);
    const comuns = [...e3.pares].filter(p => a3.pares.has(p));
    const so = (X, Y) => [...X.pares].filter(p => !Y.pares.has(p));
    const base = { paresEngine: [...e3.pares], paresAssign: [...a3.pares], comuns,
                   soEngine: so(e3, a3), soAssign: so(a3, e3),
                   primeiroEngine: e3.primeiro, primeiroAssign: a3.primeiro };
    const iguais = e3.pares.size === a3.pares.size && comuns.length === e3.pares.size;
    if (iguais) return { status: "identico", ...base };
    if (e3.primeiro === a3.primeiro) return { status: "principal", ...base };
    if (comuns.length) return { status: "parcial", ...base };
    const e2 = paresDe(gE, 2, ign), a2 = paresDe(gA, 2, ign);
    if ([...e2.pares].some(p => a2.pares.has(p))) return { status: "campos2", ...base };
    return { status: "divergente", ...base };
  }

  // ================================================================== QC
  const LIMITES_PADRAO = {
    profMinErro: 30, profMinAviso: 50,            // profundidade mínima Exon+ (dashboard antigo: alerta < 50x)
    sinalRuidoErro: 0.10, sinalRuidoAviso: 0.20,  // heterozigoto mínimo vs ruído máximo (Exon+)
    ruidoMaxAviso: 0.15, ruidoMaxErro: 0.25,      // ruído total máximo (Exon+)
    segBaseErro: 0.20, segBaseAviso: 0.25,        // 2ª base em heterozigotos (balanço alélico)
    mapPctAviso: 80,                              // % de reads do locus usados
    q30Aviso: 80, coberturaErro: 50, coberturaAviso: 80, balancoAviso: 30,   // Assign
  };

  /** Lista de alertas {nivel: erro|aviso|info, texto, metrica} para um locus. */
  function avaliarQC(e, a, L) {
    const al = [];
    const add = (nivel, metrica, textoA) => al.push({ nivel, metrica, texto: textoA });
    if (e) {
      const ex = e.regioes["Exon+"] || e.regioes["Amplicon"] || {};
      const aprovado = e.status === "Approved";
      if (ex.profMin !== null && ex.profMin !== undefined) {
        if (ex.profMin < L.profMinErro) add("erro", "profMin", `Profundidade mínima ${ex.profMin}x (< ${L.profMinErro}x)`);
        else if (ex.profMin < L.profMinAviso) add("aviso", "profMin", `Profundidade mínima ${ex.profMin}x (< ${L.profMinAviso}x)`);
      }
      if (ex.sinalRuido !== null && ex.sinalRuido !== undefined) {
        if (ex.sinalRuido < L.sinalRuidoErro) add("erro", "sinalRuido", `Heterozigoto vs ruído ${ex.sinalRuido.toFixed(3)} (< ${L.sinalRuidoErro})`);
        else if (ex.sinalRuido < L.sinalRuidoAviso) add("aviso", "sinalRuido", `Heterozigoto vs ruído ${ex.sinalRuido.toFixed(3)} (< ${L.sinalRuidoAviso})`);
      }
      if (ex.ruidoMax !== null && ex.ruidoMax !== undefined) {
        if (ex.ruidoMax > L.ruidoMaxErro) add("erro", "ruidoMax", `Ruído máximo ${ex.ruidoMax.toFixed(3)} (> ${L.ruidoMaxErro})`);
        else if (ex.ruidoMax > L.ruidoMaxAviso) add("aviso", "ruidoMax", `Ruído máximo ${ex.ruidoMax.toFixed(3)} (> ${L.ruidoMaxAviso})`);
      }
      if (ex.segBaseMin !== null && ex.segBaseMin !== undefined) {
        if (ex.segBaseMin < L.segBaseErro) add("erro", "segBaseMin", `2ª base em heterozigoto ${ex.segBaseMin.toFixed(3)} (< ${L.segBaseErro})`);
        else if (ex.segBaseMin < L.segBaseAviso) add("aviso", "segBaseMin", `2ª base em heterozigoto ${ex.segBaseMin.toFixed(3)} (< ${L.segBaseAviso})`);
      }
      if (e.mapPct !== null && e.mapPct < L.mapPctAviso) add("aviso", "mapPct", `Reads usados no locus ${e.mapPct}% (< ${L.mapPctAviso}%)`);
      if (e.interrogacoes > 0) add("aviso", "interrogacoes", `${e.interrogacoes} posição(ões) indeterminada(s) (?)`);
      for (const x of e.alelosAnot) {
        if (x.mmExon > 0 && aprovado) add("erro", "novo", `Possível alelo novo: ${x.mmExon} mismatch(es) em éxon vs ${x.alelo}`);
        else if (x.mismatches > 0) add("info", "novo", `${x.mismatches} mismatch(es) fora de éxon vs ${x.alelo} (variante intrônica?)`);
        if (x.estendido) add("info", "estendido", `${x.alelo}: referência estendida pelo NGSengine`);
      }
      if (e.edicoes.length) add("info", "edicoes", `${e.edicoes.length} edição(ões) manual(is) no NGSengine`);
      for (const w of e.avisos) add("aviso", "avisoEngine", `NGSengine: ${w}`);
    }
    if (a) {
      if (a.q30 !== null && a.q30 < L.q30Aviso) add("aviso", "q30", `Assign: Q30 ${a.q30}% (< ${L.q30Aviso}%)`);
      if (a.cobertura !== null) {
        if (a.cobertura < L.coberturaErro) add("erro", "cobertura", `Assign: cobertura ${a.cobertura}x (< ${L.coberturaErro}x)`);
        else if (a.cobertura < L.coberturaAviso) add("aviso", "cobertura", `Assign: cobertura ${a.cobertura}x (< ${L.coberturaAviso}x)`);
      }
      if (a.balanco !== null && a.balanco < L.balancoAviso) add("aviso", "balanco", `Assign: balanço alélico ${a.balanco}% (< ${L.balancoAviso}%)`);
      if (a.edicoes) add("info", "edicoesAssign", `Assign: edições do usuário (${a.edicoes})`);
      if (a.comentarios) add("info", "comentarioAssign", `Assign: ${a.comentarios}`);
    }
    return al;
  }
  const pior = al => (al.some(x => x.nivel === "erro") ? "erro" : al.some(x => x.nivel === "aviso") ? "aviso" : al.length ? "info" : "ok");

  // ================================================================== consolidação
  function opcoesLiberacao(lin) {
    const e = lin.engine, a = lin.assign, lc = lin.locus;
    const op = {};
    if (e && (e.nmdp1 || e.nmdp2))
      op.engine = [tresCampos(e.nmdp1), tresCampos(e.nmdp2)];
    if (a && (a.alelo1 || a.alelo2))
      op.assign = [prefixarLocus(lc, a.alelo1), prefixarLocus(lc, a.alelo2)];
    return op;
  }

  /** Junta Engine + Assign por amostra/locus, compara e sugere a decisão. */
  function consolidar(engine, assigns, cfg) {
    const L = Object.assign({}, LIMITES_PADRAO, (cfg && cfg.limites) || {});
    const opc = { ignorarNulos: !cfg || cfg.ignorarNulos !== false };
    const exigirRevisaoQC = !cfg || cfg.revisarAlertaVermelho !== false;
    const mapaA = new Map();
    const infoAssign = [];
    for (const as of assigns || []) {
      infoAssign.push({ arquivo: as.arquivo, software: as.software, referencia: as.referencia, operador: as.operador, criado: as.criado });
      for (const r of as.locos) mapaA.set(r.chave + "|" + r.locus, r);
    }
    const amostras = new Map();
    for (const s of engine.amostras) amostras.set(s.chave, s);
    const linhas = [];
    const vistos = new Set();
    for (const e of engine.locos) {
      const k = e.chave + "|" + e.locus;
      if (vistos.has(k)) continue;        // mesma regra do app atual: 1 linha por amostra/locus
      vistos.add(k);
      linhas.push(montarLinha(e.chave, e.id, e.locus, e, mapaA.get(k), amostras.get(e.chave)));
    }
    // locos/amostras que só existem no Assign
    for (const [k, a] of mapaA) if (!vistos.has(k)) {
      vistos.add(k);
      linhas.push(montarLinha(a.chave, a.id, a.locus, null, a, amostras.get(a.chave)));
    }
    function montarLinha(chave, id, locus, e, a, s) {
      const lin = { chave: chave + "|" + locus, chaveAmostra: chave, id, locus, engine: e || null, assign: a || null, amostra: s || null };
      lin.comp = comparar(e ? e.glConclusiva : "", a ? a.gl : "", opc);
      lin.qc = avaliarQC(e, a, L);
      lin.qcNivel = pior(lin.qc);
      lin.opcoes = opcoesLiberacao(lin);
      lin.sugestao = sugerir(lin);
      return lin;
    }
    function sugerir(lin) {
      const st = lin.comp.status, aprov = lin.engine && lin.engine.status === "Approved";
      const temOpcao = !!lin.opcoes.engine;
      if (st === "ausente") return { fonte: "nenhuma", automatica: true, motivo: "Locus não tipado em nenhum software" };
      if ((st === "identico" || st === "principal") && aprov && temOpcao) {
        if (exigirRevisaoQC && lin.qcNivel === "erro")
          return { fonte: null, automatica: false, motivo: "Concordante, mas com alerta vermelho de QC" };
        return { fonte: "engine", automatica: true, motivo: st === "identico" ? "Concordante e aprovado no NGSengine" : "1º genótipo concordante e aprovado no NGSengine" };
      }
      const motivos = {
        parcial: "Os softwares têm genótipos em comum, mas também alternativas diferentes",
        campos2: "Concordam apenas em 2 campos",
        divergente: "Nenhum genótipo em comum",
        so_engine: "Assign não tipou este locus",
        so_assign: "NGSengine não tipou este locus",
      };
      let m = motivos[st] || "";
      if (lin.engine && !aprov) m = `Locus ${lin.engine.status === "Rejected" ? "rejeitado" : "não aprovado"} no NGSengine` + (m ? " · " + m : "");
      return { fonte: null, automatica: false, motivo: m || "Revisar" };
    }
    linhas.sort((x, y) => (x.chaveAmostra.localeCompare(y.chaveAmostra, undefined, { numeric: true }))
      || (LOCOS.indexOf(x.locus) - LOCOS.indexOf(y.locus)));
    const locosPresentes = LOCOS.filter(l => linhas.some(r => r.locus === l));
    for (const r of linhas) if (!locosPresentes.includes(r.locus)) locosPresentes.push(r.locus);
    return { projeto: engine.projeto, engine, infoAssign, linhas, locos: locosPresentes, limites: L };
  }

  /** Tipagem liberada conforme a decisão do analista. */
  function tipagemLiberada(lin, decisao) {
    const d = decisao || (lin.sugestao.automatica ? { fonte: lin.sugestao.fonte } : null);
    if (!d || !d.fonte) return { estado: "pendente", alelos: ["", ""] };
    if (d.fonte === "nenhuma" || d.fonte === "nao_liberar") return { estado: d.fonte, alelos: ["", ""] };
    if (d.fonte === "manual") return { estado: "manual", alelos: [d.alelo1 || "", d.alelo2 || ""] };
    const op = lin.opcoes[d.fonte];
    return op ? { estado: d.fonte, alelos: op.slice() } : { estado: "pendente", alelos: ["", ""] };
  }

  // ================================================================== exportação
  const ORDEM_SISHLA = ["HLA-A", "HLA-B", "HLA-C", "HLA-DQB1", "HLA-DPB1", "HLA-DRB1", "HLA-DQA1", "HLA-DPA1", "HLA-DRB3", "HLA-DRB4", "HLA-DRB5"];
  const ORDEM_REDOME = ["HLA-A", "HLA-B", "HLA-C", "HLA-DRB1", "HLA-DQB1", "HLA-DRB3", "HLA-DRB4", "HLA-DRB5", "HLA-DQA1", "HLA-DPA1", "HLA-DPB1"];

  function csv(linhas, sep) {
    sep = sep || ";";
    const esc = v => {
      v = v === null || v === undefined ? "" : String(v);
      return /[";\n\r]/.test(v) || v.includes(sep) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    return linhas.map(r => r.map(esc).join(sep)).join("\n") + "\n";
  }

  /** Linhas liberadas por amostra: [{amostra, locos:{locus:[a1,a2]}}] */
  function agruparLiberadas(cons, decisoes, excluir) {
    const filtroExcluir = (excluir || []).map(s => String(s).trim()).filter(Boolean);
    const por = new Map();
    for (const lin of cons.linhas) {
      const s = lin.amostra;
      const nomeAmostra = s ? s.nome : (lin.engine ? lin.engine.amostra : lin.id);
      if (filtroExcluir.some(x => String(lin.id).includes(x) || nomeAmostra.includes(x))) continue;
      const t = tipagemLiberada(lin, decisoes[lin.chave]);
      if (!["engine", "assign", "manual"].includes(t.estado)) continue;
      if (!t.alelos[0] && !t.alelos[1]) continue;
      const k = lin.chaveAmostra;
      if (!por.has(k)) por.set(k, { id: lin.id, nome: nomeAmostra, locos: {} });
      por.get(k).locos[lin.locus] = t.alelos;
    }
    // mesma ordem do pivot do pandas (texto do sample_name)
    return [...por.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** Mesmo layout do ngsengine_to_sishla_report: 4 linhas vazias, colunas ordenadas. */
  function exportarSishla(cons, decisoes, excluir) {
    const grupos = agruparLiberadas(cons, decisoes, excluir);
    const locos = ORDEM_SISHLA.filter(l => grupos.some(g => g.locos[l]));
    const cols = [];
    locos.forEach(l => {
      const n = ORDEM_SISHLA.indexOf(l) * 2 + 1;
      cols.push([`${String(n).padStart(2, "0")}_alelo01_${l}_sishla`, l, 0]);
      cols.push([`${String(n + 1).padStart(2, "0")}_alelo02_${l}_sishla`, l, 1]);
    });
    const cab = ["00_sample_name", ...cols.map(c => c[0]), "fastq_filename", "software_name", "software_version"];
    const out = [cab];
    for (let i = 0; i < 4; i++) out.push(cab.map(() => ""));
    const eng = cons.engine;
    for (const g of grupos)
      out.push([g.id, ...cols.map(c => (g.locos[c[1]] || ["", ""])[c[2]]), g.nome, eng.software, eng.versao]);
    return csv(out);
  }

  function exportarRedome(cons, decisoes, excluir, dmr) {
    const grupos = agruparLiberadas(cons, decisoes, excluir);
    const hoje = new Date();
    const data = `${String(hoje.getDate()).padStart(2, "0")}/${String(hoje.getMonth() + 1).padStart(2, "0")}/${hoje.getFullYear()}`;
    const cols = [["01_date_redome", null, null]];
    ORDEM_REDOME.forEach((l, i) => {
      cols.push([`${String(i * 2 + 2).padStart(2, "0")}_alelo01_${l}_redome`, l, 0]);
      cols.push([`${String(i * 2 + 3).padStart(2, "0")}_alelo02_${l}_redome`, l, 1]);
    });
    const eng = cons.engine;
    const valores = g => cols.map(c => (c[1] ? (g.locos[c[1]] || ["", ""])[c[2]] : data));
    if (!dmr) {
      const out = [["sample_name", "fastq_filename", "software_name", "software_version", ...cols.map(c => c[0])]];
      for (const g of grupos) out.push([g.id, g.nome, eng.software, eng.versao, ...valores(g)]);
      return csv(out);
    }
    // com IL_DMR: mesma ordenação de colunas que o pandas gera após o merge
    const nomes = ["00_DMR", ...cols.map(c => c[0]), "Patient", "fastq_filename", "sample_name", "software_name", "software_version"];
    const out = [nomes];
    for (const g of grupos) {
      const d = dmr.get(g.id) || dmr.get(chaveId(g.id));
      out.push([d ? d.dmr : "", ...valores(g), d ? d.patient : "", g.nome, g.id, eng.software, eng.versao]);
    }
    return csv(out);
  }

  /** Lê o CSV IL_DMR (separador ';', latin1) -> Map(Patient -> {patient, dmr}) */
  function lerDmr(textoCsv) {
    const linhas = textoCsv.split(/\r?\n/).filter(l => l.trim());
    const cab = linhas.shift().split(";").map(s => s.replace(/"/g, "").trim());
    const ip = cab.indexOf("Patient"), id = cab.indexOf("DMR");
    if (ip < 0 || id < 0) throw new Error("O CSV IL_DMR precisa das colunas Patient e DMR.");
    const m = new Map();
    for (const l of linhas) {
      const c = l.split(";").map(s => s.replace(/"/g, "").trim());
      m.set(c[ip], { patient: c[ip], dmr: c[id] });
    }
    return m;
  }

  function exportarComparativo(cons, decisoes) {
    const cab = ["projeto", "amostra", "locus", "status_comparacao", "decisao", "decidido_por", "decidido_em", "observacao",
      "liberado_alelo1", "liberado_alelo2", "engine_status_revisao", "engine_conclusive_glstring", "engine_nmdp_alelo1", "engine_nmdp_alelo2",
      "assign_ambiguity", "assign_alelo1", "assign_alelo2", "alerta_qc", "alertas",
      "exon_prof_min", "exon_het_vs_ruido", "exon_ruido_max", "exon_2a_base_min", "locus_map_pct", "n_genotipos",
      "assign_q30_pct", "assign_cobertura", "assign_balanco_pct", "assign_motivo"];
    const out = [cab];
    for (const lin of cons.linhas) {
      const d = decisoes[lin.chave] || {};
      const t = tipagemLiberada(lin, decisoes[lin.chave]);
      const e = lin.engine || {}, a = lin.assign || {};
      const ex = (e.regioes && (e.regioes["Exon+"] || e.regioes["Amplicon"])) || {};
      out.push([cons.projeto, lin.id, lin.locus, STATUS[lin.comp.status].rotulo, t.estado, d.usuario || (lin.sugestao.automatica ? "automático" : ""),
        d.quando || "", d.obs || "", t.alelos[0], t.alelos[1], e.status || "", e.glConclusiva || "", e.nmdp1 || "", e.nmdp2 || "",
        a.gl || "", a.alelo1 || "", a.alelo2 || "", lin.qcNivel, lin.qc.map(x => x.texto).join(" | "),
        ex.profMin ?? "", ex.sinalRuido ?? "", ex.ruidoMax ?? "", ex.segBaseMin ?? "", e.mapPct ?? "", e.nGenotipos ?? "",
        a.q30 ?? "", a.cobertura ?? "", a.balanco ?? "", a.motivo || ""]);
    }
    return csv(out);
  }

  /** Equivalente ao "informacoes_adicionais" do app atual (métricas por locus). */
  function exportarInfoAdicionais(cons) {
    const cab = ["fastq_filename", "sample_name", "software_name", "software_version", "imgt_version", "locus_name",
      "nmdp_typing_allele1", "nmdp_typing_allele2", "typing_pgroup", "locus_review_status", "locus_review_level",
      "locus_first_reviewer_name", "locus_first_reviewer_datetime", "locus_first_reviewer_action",
      "locus_second_reviewer_name", "locus_second_reviewer_action", "locus_map_percentage",
      "exon_qm_noise_delta_ston", "core_qm_noise_delta_ston", "exon_qm_noise_max", "core_qm_noise_max",
      "exon_qm_read_depth_min", "exon_qm_read_depth_max", "exon_qm_secondbase_min", "core_qm_read_depth_min", "core_qm_secondbase_min"];
    const out = [cab];
    const eng = cons.engine;
    for (const e of eng.locos) {
      const ex = e.regioes["Exon+"] || {}, co = e.regioes["Core+"] || {};
      const r1 = e.revisoes.find(r => r.nivel === "First reviewer") || {}, r2 = e.revisoes.find(r => r.nivel && r.nivel !== "First reviewer") || {};
      out.push([e.amostra, e.id, eng.software, eng.versao, e.imgt, e.locus, e.nmdp1, e.nmdp2, e.glP, e.status, e.nivelRevisao,
        r1.nome || "", r1.quando || "", r1.acao || "", r2.nome || "", r2.acao || "", e.mapPct ?? "",
        ex.sinalRuido ?? "", co.sinalRuido ?? "", ex.ruidoMax ?? "", co.ruidoMax ?? "", ex.profMin ?? "", ex.profMax ?? "",
        ex.segBaseMin ?? "", co.profMin ?? "", co.segBaseMin ?? ""]);
    }
    return csv(out);
  }

  const api = {
    LOCOS, STATUS, LIMITES_PADRAO, enxugarXml, parseXml, lerEngine, lerAssign, reduzirCampos, tresCampos,
    genotiposEngine, genotiposAssign, comparar, avaliarQC, consolidar, tipagemLiberada,
    exportarSishla, exportarRedome, exportarComparativo, exportarInfoAdicionais, lerDmr, chaveId, csv,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.HLA = api;
})(typeof self !== "undefined" ? self : this);
