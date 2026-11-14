/* HLA Consenso — interface. Depende de Arquivos (arquivos.js) e HLA (core.js). */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const h = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const semPrefixo = a => String(a || "").replace(/^[A-Z0-9]+\*/, "");
  const fmt = (v, d) => (v === null || v === undefined || v === "" ? "—" : typeof v === "number" ? (d !== undefined ? v.toFixed(d) : v.toLocaleString("pt-BR")) : v);
  const CHAVE_LS = "hlaConsenso:v1:";

  const ROT_CURTO = { identico: "Concordante", principal: "1º genótipo", parcial: "Parcial", campos2: "Só 2 campos", divergente: "Divergente", so_engine: "Só NGSengine", so_assign: "Só Assign", ausente: "não tipado" };
  const ICONE = { identico: "✓", principal: "≈", parcial: "◐", campos2: "2", divergente: "≠", so_engine: "E", so_assign: "A", ausente: "–" };
  const FONTES = { engine: "NGSengine", assign: "Assign", manual: "Manual", nao_liberar: "Não liberar", nenhuma: "—" };

  const E = {
    arquivos: { engine: null, assigns: [], dmr: null },
    engine: null, assigns: [], dmr: null, cons: null,
    decisoes: {}, desfazer: [],
    cfg: { limites: {}, ignorarNulos: true, revisarAlertaVermelho: true, excluir: "1044736", avancar: true },
    aba: "placa", filtro: "todos", busca: "", aberto: null,
    analista: localStorage.getItem("hlaConsenso:analista") || "",
  };

  // ================================================================ utilidades
  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  function carregando(msg) {
    let c = $("#carregando");
    if (!msg) { if (c) c.remove(); return; }
    if (!c) { c = document.createElement("div"); c.id = "carregando"; c.className = "carregando"; document.body.appendChild(c); }
    c.innerHTML = `<div>${h(msg)}</div>`;
  }
  function baixar(conteudo, nome, tipo) {
    const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo || "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function lote() { return (E.engine.arquivo || E.engine.projeto).split("/").pop().split(".")[0]; }
  function salvar() {
    if (!E.cons) return;
    try {
      localStorage.setItem(CHAVE_LS + E.cons.projeto, JSON.stringify({
        decisoes: E.decisoes, cfg: E.cfg, atualizado: new Date().toISOString(),
      }));
    } catch (e) { console.warn(e); }
  }
  function lerSalvo(projeto) {
    try { return JSON.parse(localStorage.getItem(CHAVE_LS + projeto) || "null"); } catch (e) { return null; }
  }

  // ================================================================ upload
  async function receberArquivos(lista) {
    $("#erro-inicio").textContent = "";
    for (const f of lista) {
      const nome = f.name, ext = nome.toLowerCase().split(".").pop();
      try {
        if (ext === "xml") E.arquivos.engine = { nome, texto: await f.text() };
        else if (ext === "xlsx") {
          if (!E.arquivos.assigns.some(a => a.nome === nome)) E.arquivos.assigns.push({ nome, buffer: await f.arrayBuffer() });
        } else if (ext === "csv") E.arquivos.dmr = { nome, texto: new TextDecoder("latin1").decode(await f.arrayBuffer()) };
        else if (ext === "zip") {
          const conteudo = await Arquivos.lerZip(await f.arrayBuffer(), n => !n.startsWith("__MACOSX") && /\.(xml|xlsx)$/i.test(n));
          for (const [n, bytes] of Object.entries(conteudo)) {
            const base = n.split("/").pop();
            if (/\.xml$/i.test(n)) E.arquivos.engine = { nome: base, texto: new TextDecoder().decode(bytes) };
            else E.arquivos.assigns.push({ nome: base, buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
          }
        } else throw new Error(`Formato não reconhecido: ${nome}`);
      } catch (e) { $("#erro-inicio").textContent += `${e.message}\n`; }
    }
    atualizarSlots();
  }
  function atualizarSlots() {
    const A = E.arquivos;
    const slot = (id, itens) => {
      const el = $(id);
      el.classList.toggle("vazio", !itens.length);
      if (itens.length) el.querySelectorAll(".arq").forEach(x => x.remove()), itens.forEach(n => el.insertAdjacentHTML("beforeend", `<div class="arq"><span class="ok">✓</span>${h(n)}</div>`));
    };
    slot("#slot-engine", A.engine ? [A.engine.nome] : []);
    slot("#slot-assign", A.assigns.map(a => a.nome));
    slot("#slot-dmr", A.dmr ? [A.dmr.nome] : []);
    $("#bt-analisar").disabled = !A.engine;
    $("#dica-inicio").textContent = !A.engine ? "Falta o export do NGSengine." : !A.assigns.length ? "Sem Assign: dá para analisar só o NGSengine, mas sem comparação." : "Tudo pronto.";
  }

  async function analisar() {
    carregando("Lendo o export do NGSengine…");
    await new Promise(r => setTimeout(r, 30));
    try {
      E.engine = HLA.lerEngine(E.arquivos.engine.texto, E.arquivos.engine.nome);
      carregando("Lendo os relatórios do Assign…");
      E.assigns = [];
      for (const a of E.arquivos.assigns) E.assigns.push(HLA.lerAssign(await Arquivos.lerXlsx(a.buffer), a.nome));
      E.dmr = E.arquivos.dmr ? HLA.lerDmr(E.arquivos.dmr.texto) : null;
      const salvo = lerSalvo(E.engine.projeto);
      E.decisoes = {};
      if (salvo) {
        E.decisoes = salvo.decisoes || {};
        Object.assign(E.cfg, salvo.cfg || {});
        if (Object.keys(E.decisoes).length) setTimeout(() => toast(`Retomando a sessão salva: ${Object.keys(E.decisoes).length} decisão(ões) do analista.`), 300);
      }
      recalcular();
      $("#tela-inicio").classList.add("hidden");
      $("#tela-app").classList.remove("hidden");
      $("#abas").classList.remove("hidden");
      $("#bt-nova").classList.remove("hidden");
      render();
    } catch (e) {
      console.error(e);
      $("#erro-inicio").textContent = "Erro: " + e.message;
    } finally { carregando(null); }
  }

  function recalcular() {
    E.cons = HLA.consolidar(E.engine, E.assigns, E.cfg);
    E.porChave = new Map(E.cons.linhas.map(l => [l.chave, l]));
  }

  // ================================================================ estado das decisões
  function efetiva(lin) {
    const d = E.decisoes[lin.chave];
    if (d) return { ...d, manual: true };
    if (lin.sugestao.automatica) return { fonte: lin.sugestao.fonte, automatica: true };
    return null;
  }
  const pendente = lin => !efetiva(lin);
  function decidir(lin, dados, silencioso) {
    E.desfazer.push({ chave: lin.chave, antes: E.decisoes[lin.chave] || null });
    if (dados === null) delete E.decisoes[lin.chave];
    else E.decisoes[lin.chave] = { ...dados, usuario: E.analista || "analista", quando: new Date().toISOString() };
    salvar();
    if (!silencioso) render();
  }
  function desfazer() {
    const u = E.desfazer.pop();
    if (!u) return toast("Nada para desfazer.");
    if (u.antes) E.decisoes[u.chave] = u.antes; else delete E.decisoes[u.chave];
    salvar(); render();
    if (E.aberto) abrirPainel(u.chave);
    toast("Decisão desfeita.");
  }
  function garantirAnalista(depois) {
    if (E.analista) return depois();
    modal(`<h2>Quem está analisando?</h2><p class="sec">O nome fica registrado em cada decisão e no relatório de conferência.</p>
      <div class="campo"><input type="text" id="nome-analista" placeholder="Seu nome" autofocus></div>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn primario" id="ok-analista">Continuar</button></div>`, m => {
      const ok = () => {
        const v = m.querySelector("#nome-analista").value.trim();
        if (!v) return;
        E.analista = v; localStorage.setItem("hlaConsenso:analista", v); fecharModal(); depois();
      };
      m.querySelector("#ok-analista").onclick = ok;
      m.querySelector("#nome-analista").onkeydown = ev => { if (ev.key === "Enter") ok(); };
      setTimeout(() => m.querySelector("#nome-analista").focus(), 30);
    });
  }

  // ================================================================ modal
  function modal(html, montar) {
    fecharModal();
    const f = document.createElement("div");
    f.className = "modal-fundo"; f.id = "modal";
    f.innerHTML = `<div class="modal">${html}</div>`;
    f.onclick = ev => { if (ev.target === f) fecharModal(); };
    document.body.appendChild(f);
    if (montar) montar(f);
  }
  function fecharModal() { const m = $("#modal"); if (m) m.remove(); }

  // ================================================================ render geral
  function render() {
    renderTopo();
    const app = $("#tela-app");
    if (E.aba === "placa") app.innerHTML = renderKpis() + renderPlaca();
    else if (E.aba === "revisao") app.innerHTML = renderKpis() + renderRevisao();
    else if (E.aba === "qualidade") app.innerHTML = renderQualidade();
    else app.innerHTML = renderExportar();
    ligar(app);
    if (E.aba === "qualidade") desenharGraficos();
    if (E.aberto) abrirPainel(E.aberto, true);
  }

  function imgtVersoes() {
    const ve = [...new Set(E.engine.locos.map(l => (l.imgt.match(/\d+\.\d+\.\d+/) || [""])[0]).filter(Boolean))];
    const va = [...new Set(E.assigns.map(a => (a.referencia.match(/\d+\.\d+\.\d+/) || [""])[0]).filter(Boolean))];
    return { ve, va, difere: va.length > 0 && ve.join() !== va.join() };
  }

  function renderTopo() {
    const eng = E.engine, iv = imgtVersoes();
    const as = E.assigns[0];
    $("#projeto").innerHTML = `<b title="${h(eng.projeto)}">${h(eng.projeto)}</b><div class="chips">
      <span class="chip">${h(eng.software)} ${h(eng.versao)} · IMGT ${h(iv.ve.join(", "))}</span>
      ${as ? `<span class="chip">${h(as.software.replace(/\s*v\.?/i, " "))} · IMGT ${h(iv.va.join(", "))} · ${E.assigns.length} arquivo(s)</span>` : `<span class="chip alerta">sem Assign</span>`}
      ${iv.difere ? `<span class="chip alerta" title="Versões diferentes do banco IMGT/HLA podem explicar divergências de nomenclatura">⚠ IMGT diferente entre softwares</span>` : ""}
      <span class="chip">${eng.amostras.length} amostras</span></div>`;
    const np = E.cons.linhas.filter(pendente).length;
    const c = $("#cont-pend");
    c.textContent = np; c.classList.toggle("zero", np === 0);
    document.querySelectorAll("#abas button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.aba === E.aba)));
  }

  function contagens() {
    const L = E.cons.linhas;
    const tipados = L.filter(l => l.comp.status !== "ausente");
    const comp = L.filter(l => l.engine && l.assign && l.comp.status !== "ausente" && !l.comp.status.startsWith("so_"));
    const conc = comp.filter(l => l.comp.status === "identico" || l.comp.status === "principal");
    const pend = L.filter(pendente);
    const decididas = L.filter(l => E.decisoes[l.chave]);
    const liberadas = L.filter(l => { const t = HLA.tipagemLiberada(l, E.decisoes[l.chave]); return ["engine", "assign", "manual"].includes(t.estado); });
    const qcErro = tipados.filter(l => l.qcNivel === "erro");
    const novos = L.filter(l => l.qc.some(q => q.metrica === "novo" && q.nivel === "erro"));
    const porStatus = {};
    for (const l of tipados) porStatus[l.comp.status] = (porStatus[l.comp.status] || 0) + 1;
    return { L, tipados, comp, conc, pend, decididas, liberadas, qcErro, novos, porStatus };
  }

  function renderKpis() {
    const c = contagens();
    const pct = c.comp.length ? Math.round((100 * c.conc.length) / c.comp.length) : 0;
    const ordem = ["identico", "principal", "parcial", "campos2", "divergente", "so_engine", "so_assign"];
    const barra = ordem.filter(s => c.porStatus[s]).map(s => `<span class="st-${s}" style="flex:${c.porStatus[s]};background:var(--c)" title="${h(HLA.STATUS[s].rotulo)}: ${c.porStatus[s]}"></span>`).join("");
    return `<div class="kpis">
      <div class="kpi"><div class="rot">Concordância NGSengine × Assign</div><div class="val">${pct}%</div><div class="det">${c.conc.length} de ${c.comp.length} locos comparáveis</div><div class="barra">${barra}</div></div>
      <div class="kpi clicavel" data-ir="revisao"><div class="rot">Pendentes de decisão</div><div class="val" style="color:${c.pend.length ? "var(--critical)" : "var(--good)"}">${c.pend.length}</div><div class="det">${c.pend.length ? "clique para revisar" : "tudo decidido ✓"}</div></div>
      <div class="kpi"><div class="rot">Tipagens liberadas</div><div class="val">${c.liberadas.length}</div><div class="det">${c.decididas.length} decididas pelo analista</div></div>
      <div class="kpi clicavel" data-filtro="qc"><div class="rot">Alertas vermelhos de QC</div><div class="val">${c.qcErro.length}</div><div class="det">locos tipados com métrica crítica</div></div>
      <div class="kpi clicavel" data-filtro="novo"><div class="rot">Possível alelo novo</div><div class="val">${c.novos.length}</div><div class="det">mismatch em éxon (aprovados)</div></div>
      <div class="kpi"><div class="rot">Amostras · locos</div><div class="val">${E.engine.amostras.length} · ${c.tipados.length}</div><div class="det">${E.cons.locos.length} locos no painel</div></div>
    </div>`;
  }

  // ================================================================ placa
  function linhaVisivel(l) {
    const f = E.filtro;
    if (f === "pendentes") return pendente(l);
    if (f === "divergencias") return ["parcial", "campos2", "divergente", "so_engine", "so_assign"].includes(l.comp.status);
    if (f === "qc") return l.qcNivel === "erro" && l.comp.status !== "ausente";
    if (f === "novo") return l.qc.some(q => q.metrica === "novo");
    if (f === "rejeitados") return l.engine && l.engine.status === "Rejected" && l.comp.status !== "ausente";
    return true;
  }
  function amostrasOrdenadas() {
    const m = new Map();
    for (const l of E.cons.linhas) {
      if (!m.has(l.chaveAmostra)) m.set(l.chaveAmostra, { chave: l.chaveAmostra, id: l.id, amostra: l.amostra, linhas: {} });
      m.get(l.chaveAmostra).linhas[l.locus] = l;
    }
    let lista = [...m.values()];
    if (E.busca) lista = lista.filter(a => a.id.toLowerCase().includes(E.busca.toLowerCase()) || (a.amostra && a.amostra.nome.toLowerCase().includes(E.busca.toLowerCase())));
    return lista;
  }
  function marcaDecisao(lin) {
    const ef = efetiva(lin);
    if (!ef) return `<span class="dec pend" title="Pendente de decisão">!</span>`;
    if (ef.fonte === "nenhuma") return "";
    if (ef.automatica) return `<span class="dec ok" title="Liberado automaticamente (NGSengine)">auto</span>`;
    const cls = { engine: "ok", assign: "assign", manual: "manual", nao_liberar: "nao" }[ef.fonte];
    const txt = { engine: "E", assign: "A", manual: "M", nao_liberar: "✕" }[ef.fonte];
    return `<span class="dec ${cls}" title="Decisão do analista: ${h(FONTES[ef.fonte])}">${txt}</span>`;
  }
  function alelosCelula(lin) {
    const t = HLA.tipagemLiberada(lin, E.decisoes[lin.chave]);
    let al = t.alelos;
    if (!al[0] && !al[1]) al = lin.opcoes.engine || lin.opcoes.assign || ["", ""];
    return al.map(semPrefixo);
  }
  function celula(lin) {
    if (!lin) return `<td><div class="cel st-ausente" style="cursor:default"><span class="t">—</span></div></td>`;
    const st = lin.comp.status;
    const vis = linhaVisivel(lin);
    const rej = lin.engine && lin.engine.status === "Rejected" && st !== "ausente";
    const novo = lin.qc.some(q => q.metrica === "novo" && q.nivel === "erro");
    const qc = st === "ausente" ? "" : lin.qcNivel === "erro" ? `<span class="qcdot erro" title="Alerta vermelho de QC"></span>` : lin.qcNivel === "aviso" ? `<span class="qcdot aviso" title="Alerta amarelo de QC"></span>` : "";
    const al = st === "ausente" ? [] : alelosCelula(lin);
    return `<td><button class="cel st-${st}${vis ? "" : " apagada"}${E.aberto === lin.chave ? " sel" : ""}" data-chave="${h(lin.chave)}"
      title="${h(HLA.STATUS[st].rotulo + (rej ? " · rejeitado no NGSengine" : ""))}" aria-label="${h(lin.id + " " + lin.locus + ": " + HLA.STATUS[st].rotulo)}">
      <span class="ico">${novo ? `<span class="qcdot novo" title="Possível alelo novo"></span>` : ""}${qc}${st !== "ausente" ? marcaDecisao(lin) : ""}</span>
      ${st === "ausente" ? `<span class="t">não tipado</span>` : `<span class="t">${h(al[0] || "")}</span><span class="t">${h(al[1] || "")}</span>
      <span class="stt">${ICONE[st]} ${h(ROT_CURTO[st])}${rej ? " · rej." : ""}</span>`}</button></td>`;
  }
  function renderPlaca() {
    const locos = E.cons.locos;
    const amostras = amostrasOrdenadas();
    const maxReads = Math.max(1, ...E.engine.amostras.map(a => a.readsTotal || 0));
    const filtros = [["todos", "Todos"], ["pendentes", "Pendentes"], ["divergencias", "Divergências"], ["rejeitados", "Rejeitados no NGSengine"], ["qc", "Alerta vermelho"], ["novo", "Alelo novo?"]];
    const legenda = ["identico", "principal", "parcial", "campos2", "divergente", "so_engine", "ausente"]
      .map(s => `<span><i class="sw st-${s}">${s === "ausente" ? "" : ICONE[s]}</i>${h(s === "so_engine" ? "Só um software" : HLA.STATUS[s].rotulo)}</span>`).join("");
    const linhas = amostras.map(a => {
      const am = a.amostra;
      const reads = am && am.readsTotal ? am.readsTotal : 0;
      return `<tr><td class="amostra"><b>${h(a.id)}</b>
        <div class="mini" title="${h(am ? am.nome : "")}"><span class="minibar"><span style="width:${(100 * reads) / maxReads}%"></span></span>${reads ? (reads / 1000).toFixed(0) + " mil reads" : "sem dados do NGSengine"}${am && am.mapPct !== null ? " · " + am.mapPct + "%" : ""}</div></td>
        ${locos.map(lc => celula(a.linhas[lc])).join("")}</tr>`;
    }).join("");
    return `<div class="filtros">
        <input type="search" id="busca" placeholder="Buscar amostra…" value="${h(E.busca)}">
        <div class="seg" id="seg-filtro">${filtros.map(([k, r]) => `<button data-f="${k}" aria-pressed="${E.filtro === k}">${r}</button>`).join("")}</div>
        <span class="muted" style="margin-left:auto">Clique numa tipagem para comparar e decidir · <kbd>?</kbd> atalhos</span>
      </div>
      <div class="legenda">${legenda}<span><i class="qcdot erro"></i>QC crítico</span><span><i class="qcdot aviso"></i>QC atenção</span><span><i class="qcdot novo"></i>alelo novo?</span><span><span class="dec pend">!</span>pendente</span></div>
      <div class="placa-wrap"><table class="placa"><thead><tr><th class="amostra-h">Amostra</th>${locos.map(l => `<th>${h(l.replace("HLA-", ""))}</th>`).join("")}</tr></thead><tbody>${linhas}</tbody></table></div>`;
  }

  // ================================================================ painel de decisão
  function ordemNavegacao() {
    const locos = E.cons.locos;
    const out = [];
    for (const a of amostrasOrdenadas()) for (const lc of locos) { const l = a.linhas[lc]; if (l && l.comp.status !== "ausente" && (E.aba !== "placa" || linhaVisivel(l))) out.push(l); }
    return out;
  }
  function navegar(passo, soPendentes) {
    const lista = ordemNavegacao().filter(l => !soPendentes || pendente(l));
    if (!lista.length) return toast(soPendentes ? "Nenhuma pendência restante 🎉" : "Nada para navegar.");
    let i = lista.findIndex(l => l.chave === E.aberto);
    if (soPendentes && i < 0) {
      const todas = ordemNavegacao(), atual = todas.findIndex(l => l.chave === E.aberto);
      const prox = todas.slice(atual + 1).find(pendente) || lista[0];
      return abrirPainel(prox.chave);
    }
    i = i < 0 ? 0 : (i + passo + lista.length) % lista.length;
    abrirPainel(lista[i].chave);
  }

  function paresHtml(pares, comuns, max) {
    max = max || 40;
    const set = new Set(comuns);
    const vis = pares.slice(0, max).map(p => `<span class="par ${set.has(p) ? "comum" : "exclusivo"}">${h(p.replace("+", " + "))}</span>`).join("");
    return vis + (pares.length > max ? `<span class="par">+${pares.length - max}</span>` : "");
  }
  function metricaHtml(nome, valor, ref, nivel, dec, maxEscala, inverso) {
    if (valor === null || valor === undefined) return `<div class="metrica"><span class="nome">${h(nome)}</span><span class="valor muted">—</span></div>`;
    const esc = maxEscala || Math.max(valor, ref || 0) * 1.25 || 1;
    const w = Math.min(100, (100 * valor) / esc), lim = ref !== undefined && ref !== null ? Math.min(100, (100 * ref) / esc) : null;
    return `<div class="metrica ${nivel || ""}" title="${h(nome)}${ref !== undefined && ref !== null ? ` · limite ${inverso ? "máximo" : "mínimo"} ${ref}` : ""}"><span class="nome">${h(nome)}</span><span class="valor">${fmt(valor, dec)}</span>
      <span class="trilha"><span class="enchido" style="width:${w}%"></span>${lim !== null ? `<span class="limite" style="left:${lim}%"></span>` : ""}</span></div>`;
  }
  function nivelMetrica(lin, m) { const q = lin.qc.find(x => x.metrica === m); return q ? q.nivel : ""; }

  function abrirPainel(chave, semFoco) {
    const lin = E.porChave.get(chave);
    if (!lin) return;
    E.aberto = chave;
    document.querySelectorAll(".cel.sel").forEach(c => c.classList.remove("sel"));
    const celEl = document.querySelector(`.cel[data-chave="${CSS.escape(chave)}"]`);
    if (celEl) { celEl.classList.add("sel"); if (!semFoco) celEl.scrollIntoView({ block: "nearest", inline: "nearest" }); }
    const p = $("#painel");
    const e = lin.engine, a = lin.assign, c = lin.comp, st = c.status, L = E.cons.limites;
    const ef = efetiva(lin), d = E.decisoes[lin.chave];
    const ex = e ? e.regioes["Exon+"] || e.regioes["Amplicon"] || {} : {};
    const opc = lin.opcoes;
    const fonteSel = ef ? ef.fonte : null;
    const prev = f => { const t = HLA.tipagemLiberada(lin, { fonte: f, alelo1: d && d.alelo1, alelo2: d && d.alelo2 }); return t.alelos.filter(Boolean).join(" + ") || "—"; };
    const rev = e && e.revisoes.length ? e.revisoes.map(r => `${r.acao === "Approve" ? "aprovado" : r.acao === "Reject" ? "rejeitado" : h(r.acao)} por ${h(r.nome)} (${h(r.nivel)}) ${r.quando ? new Date(r.quando).toLocaleString("pt-BR") : ""}${r.comentario ? " — “" + h(r.comentario) + "”" : ""}`).join("<br>") : "";
    const temQ = e && /\?/.test((e.nmdp1 || "") + (e.nmdp2 || ""));
    const lista = ordemNavegacao(), pos = lista.findIndex(l => l.chave === chave);
    const motivoDecisao = ef && ef.automatica ? `Liberado automaticamente: ${lin.sugestao.motivo}.` : lin.sugestao.motivo;
    p.innerHTML = `
      <header>
        <h2><span class="mono">${h(lin.id)}</span> · ${h(lin.locus)}</h2>
        <span class="badge st-${st}">${ICONE[st]} ${h(HLA.STATUS[st].rotulo)}</span>
        <span style="flex:1"></span>
        <button class="icone-btn" data-nav="-1" title="Anterior (↑ / K)">↑</button>
        <button class="icone-btn" data-nav="1" title="Próxima (↓ / J)">↓</button>
        <button class="icone-btn" data-nav="p" title="Próxima pendente (P)">Próx. pendente</button>
        <button class="icone-btn" id="fechar-painel" title="Fechar (Esc)">✕</button>
      </header>
      <div class="corpo">
        <div class="motivo">${h(motivoDecisao)}${e && lin.amostra ? ` <span class="muted">· ${h(lin.amostra.nome)}</span>` : ""}</div>
        <div class="lado-a-lado">
          <div class="caixa">
            <h4><span><span class="sw2" style="background:var(--accent)"></span> NGSengine</span>${e ? `<span class="status-rev ${h(e.status)}">${e.status === "Approved" ? "Aprovado" : e.status === "Rejected" ? "Rejeitado" : h(e.status || "sem revisão")}</span>` : ""}</h4>
            ${e ? `
              <div class="rot-pequeno">Genótipos (ConclusiveTypingResult, ${h(e.resolucaoConclusiva || "—")})</div>
              <div class="pares">${c.paresEngine ? paresHtml(c.paresEngine, c.comuns) : `<span class="muted">${e.glConclusiva ? h(e.glConclusiva) : "sem tipagem conclusiva"}</span>`}</div>
              <div class="rot-pequeno">Tipagem para liberação (NMDPCodes → 3 campos)</div>
              <div class="mono">${h(opc.engine ? opc.engine.join(" + ") : "—")}</div>
              <div class="rot-pequeno">GLString completa</div><div class="gl-bruto">${h(e.glConclusiva || e.glResultado || "—")}</div>
              <div class="historico">${e.nGenotipos ?? "?"} genótipo(s) possíveis · ${e.regioesFase ?? "?"} região(ões) de fase${rev ? "<br>" + rev : ""}</div>`
              : `<div class="muted">Locus ausente no export do NGSengine.</div>`}
          </div>
          <div class="caixa">
            <h4><span><span class="sw2" style="background:var(--side)"></span> AlloSeq Assign</span>${a ? `<span class="muted" style="font-weight:400;font-size:11.5px">${h(a.arquivo.replace(/^.*?(_p\d+).*$/i, "$1").replace(/^_/, "") || a.arquivo)}</span>` : ""}</h4>
            ${a && (a.gl || a.alelo1) ? `
              <div class="rot-pequeno">Genótipos (aba Ambiguities)</div>
              <div class="pares">${c.paresAssign ? paresHtml(c.paresAssign, c.comuns) : h(a.gl)}</div>
              <div class="rot-pequeno">Tipagem para liberação (aba Summary)</div>
              <div class="mono">${h(opc.assign ? opc.assign.filter(Boolean).join(" + ") : "—")}</div>
              <div class="rot-pequeno">String de ambiguidade</div><div class="gl-bruto">${h(a.gl || "—")}</div>
              <div class="historico">${a.motivo ? "Motivos: " + h(a.motivo) : ""}</div>`
              : `<div class="muted">Assign não tipou este locus${a ? "" : " (amostra ausente nos arquivos do Assign)"}.</div>`}
          </div>
        </div>
        ${c.paresEngine ? `<div class="legenda" style="margin-top:8px"><span><span class="par comum">par</span> presente nos dois</span><span><span class="par exclusivo">par</span> só neste software</span><span class="muted">comparação em 3 campos${E.cfg.ignorarNulos ? ", ignorando alternativas com alelo nulo (N)" : ""}</span></div>` : ""}

        <div class="rot-pequeno" style="margin-top:14px">Decisão de liberação</div>
        <div class="decisao">
          <button class="opcao" data-fonte="engine" aria-pressed="${fonteSel === "engine"}" ${opc.engine ? "" : "disabled"}><span class="t1">NGSengine <kbd>E</kbd></span><span class="t2">${h(prev("engine"))}</span></button>
          <button class="opcao" data-fonte="assign" aria-pressed="${fonteSel === "assign"}" ${opc.assign ? "" : "disabled"}><span class="t1">Assign <kbd>A</kbd></span><span class="t2">${h(prev("assign"))}</span></button>
          <button class="opcao" data-fonte="manual" aria-pressed="${fonteSel === "manual"}"><span class="t1">Manual <kbd>M</kbd></span><span class="t2">${fonteSel === "manual" ? h(prev("manual")) : "digitar alelos"}</span></button>
          <button class="opcao" data-fonte="nao_liberar" aria-pressed="${fonteSel === "nao_liberar"}"><span class="t1">Não liberar <kbd>X</kbd></span><span class="t2">repetir / investigar</span></button>
        </div>
        <div class="manual ${fonteSel === "manual" ? "" : "hidden"}" id="caixa-manual">
          <input id="man1" placeholder="alelo 1 (ex.: ${h(lin.locus.replace("HLA-", ""))}*02:01:01)" value="${h(d && d.fonte === "manual" ? d.alelo1 : (opc.engine || opc.assign || [""])[0])}">
          <input id="man2" placeholder="alelo 2" value="${h(d && d.fonte === "manual" ? d.alelo2 : (opc.engine || opc.assign || ["", ""])[1])}">
          <button class="btn primario pequeno" id="salvar-manual">Salvar</button>
        </div>
        <textarea class="obs" id="obs" placeholder="Observação (vai para o relatório de conferência)">${h(d ? d.obs || "" : "")}</textarea>
        ${temQ ? `<div class="aviso-imgt" style="margin-top:8px">O código NMDP do NGSengine contém “?” (${h(e.nmdp1)} + ${h(e.nmdp2)}). Como no app antigo, dá para gerar o código pela API MAC do NMDP a partir do TypingResult:
          <div class="manual"><input id="mac-email" placeholder="e-mail exigido pela API MAC" value="${h(localStorage.getItem("hlaConsenso:macEmail") || "")}" style="font-family:var(--sans)"><button class="btn pequeno" id="bt-mac">Consultar API MAC</button></div>
          <div class="historico" id="mac-res"></div></div>` : ""}
        ${d ? `<div class="historico">Decidido por <b>${h(d.usuario)}</b> em ${new Date(d.quando).toLocaleString("pt-BR")} · <a href="#" id="limpar-dec">voltar à sugestão automática</a></div>` : ""}

        <div class="rot-pequeno" style="margin-top:16px">Qualidade</div>
        ${lin.qc.length ? `<ul class="alertas">${lin.qc.map(q => `<li class="${q.nivel}"><span class="ic">${q.nivel === "erro" ? "⨯" : q.nivel === "aviso" ? "!" : "i"}</span>${h(q.texto)}</li>`).join("")}</ul>` : `<div class="muted">Nenhum alerta com os limites atuais.</div>`}
        <div class="lado-a-lado" style="margin-top:10px">
          <div class="caixa"><h4>NGSengine · região Exon+</h4><div class="metricas" style="grid-template-columns:1fr">
            ${metricaHtml("Profundidade mínima", ex.profMin, L.profMinAviso, nivelMetrica(lin, "profMin"), undefined, Math.max(300, ex.profMin || 0))}
            ${metricaHtml("Profundidade mediana", ex.profMed, null, "", undefined, Math.max(300, ex.profMed || 0))}
            ${metricaHtml("Heterozigoto vs ruído máx.", ex.sinalRuido, L.sinalRuidoAviso, nivelMetrica(lin, "sinalRuido"), 3, 0.5)}
            ${metricaHtml("Ruído total máximo", ex.ruidoMax, L.ruidoMaxAviso, nivelMetrica(lin, "ruidoMax"), 3, 0.3, true)}
            ${metricaHtml("2ª base em heterozigotos (mín.)", ex.segBaseMin, L.segBaseAviso, nivelMetrica(lin, "segBaseMin"), 3, 0.5)}
            ${metricaHtml("Reads usados no locus (%)", e ? e.mapPct : null, L.mapPctAviso, nivelMetrica(lin, "mapPct"), undefined, 100)}
          </div></div>
          <div class="caixa"><h4>Assign</h4><div class="metricas" style="grid-template-columns:1fr">
            ${metricaHtml("Q30 (%)", a ? a.q30 : null, L.q30Aviso, nivelMetrica(lin, "q30"), undefined, 100)}
            ${metricaHtml("Cobertura média", a ? a.cobertura : null, L.coberturaAviso, nivelMetrica(lin, "cobertura"), undefined, Math.max(300, (a && a.cobertura) || 0))}
            ${metricaHtml("Balanço alélico (%)", a ? a.balanco : null, L.balancoAviso, nivelMetrica(lin, "balanco"), undefined, 50)}
          </div>
          <div class="historico" style="margin-top:8px">${e ? `Reads aceitos no locus: ${fmt(e.readsAceitos)} · leitura média ${fmt(e.leituraMedia)} pb · insert ${fmt(e.insertMedio)} pb` : ""}</div></div>
        </div>
        ${e && e.alelosAnot.length ? `<details class="mais"><summary>Alelos anotados no NGSengine</summary><table class="tabela-qc"><tr><th>Alelo</th><th>Mismatches</th><th>Éxon</th><th>Íntron</th><th>Estendido</th></tr>
          ${e.alelosAnot.map(x => `<tr><td class="mono">${h(x.alelo)}</td><td>${x.mismatches}</td><td>${x.mmExon}</td><td>${x.mmIntron}</td><td>${x.estendido ? "sim" : "não"}</td></tr>`).join("")}</table></details>` : ""}
        ${e && e.edicoes.length ? `<details class="mais"><summary>Edições manuais no NGSengine (${e.edicoes.length})</summary><ul class="alertas">${e.edicoes.map(x => `<li><span class="ic">✎</span>${h(x.acao)} na posição ${h(x.posicao)} (${h(x.de)} → ${h(x.para)}) por ${h(x.usuario)}</li>`).join("")}</ul></details>` : ""}
        <div class="rodape-nav"><span>${pos >= 0 ? `${pos + 1} de ${lista.length} na visão atual` : ""}</span><span><kbd>E</kbd> <kbd>A</kbd> <kbd>M</kbd> <kbd>X</kbd> decidir · <kbd>J</kbd>/<kbd>K</kbd> navegar · <kbd>P</kbd> próxima pendente · <kbd>Ctrl</kbd>+<kbd>Z</kbd> desfazer</span></div>
      </div>`;
    p.classList.add("aberto");
    p.setAttribute("aria-hidden", "false");
    ligarPainel(p, lin);
  }
  function fecharPainel() {
    E.aberto = null;
    const p = $("#painel");
    p.classList.remove("aberto"); p.setAttribute("aria-hidden", "true");
    document.querySelectorAll(".cel.sel").forEach(c => c.classList.remove("sel"));
  }
  function escolher(lin, fonte) {
    if (fonte === "manual") {
      $("#caixa-manual").classList.remove("hidden");
      $("#man1").focus(); $("#man1").select();
      return;
    }
    if (fonte === "engine" && !lin.opcoes.engine) return toast("NGSengine não tem tipagem para liberar neste locus.");
    if (fonte === "assign" && !lin.opcoes.assign) return toast("Assign não tem tipagem para liberar neste locus.");
    garantirAnalista(() => {
      decidir(lin, { fonte, obs: ($("#obs") || {}).value || "" });
      toast(`${lin.id} · ${lin.locus}: ${FONTES[fonte]}`);
      if (E.cfg.avancar) navegar(1, true); else abrirPainel(lin.chave, true);
    });
  }
  function ligarPainel(p, lin) {
    p.querySelector("#fechar-painel").onclick = fecharPainel;
    p.querySelectorAll("[data-nav]").forEach(b => b.onclick = () => b.dataset.nav === "p" ? navegar(1, true) : navegar(+b.dataset.nav));
    p.querySelectorAll(".opcao").forEach(b => b.onclick = () => escolher(lin, b.dataset.fonte));
    const sm = p.querySelector("#salvar-manual");
    if (sm) sm.onclick = () => {
      const a1 = p.querySelector("#man1").value.trim(), a2 = p.querySelector("#man2").value.trim();
      if (!a1 && !a2) return toast("Informe ao menos um alelo.");
      garantirAnalista(() => { decidir(lin, { fonte: "manual", alelo1: a1, alelo2: a2, obs: p.querySelector("#obs").value }); toast("Tipagem manual salva."); abrirPainel(lin.chave, true); });
    };
    ["#man1", "#man2"].forEach(s => { const i = p.querySelector(s); if (i) i.onkeydown = ev => { if (ev.key === "Enter") sm.click(); }; });
    const obs = p.querySelector("#obs");
    obs.onchange = () => { const d = E.decisoes[lin.chave]; if (d) { d.obs = obs.value; salvar(); } };
    const bm = p.querySelector("#bt-mac");
    if (bm) bm.onclick = async () => {
      const email = p.querySelector("#mac-email").value.trim();
      if (!email) return toast("Informe o e-mail usado na API MAC.");
      localStorage.setItem("hlaConsenso:macEmail", email);
      const res = p.querySelector("#mac-res");
      const imgt = (lin.engine.imgt.match(/\d+\.\d+\.\d+/) || [""])[0];
      res.textContent = "Consultando…";
      try {
        const url = `https://hml.nmdp.org/mac/api/encode?trialRun=false&email=${encodeURIComponent(email)}&imgtHlaRelease=${encodeURIComponent(imgt)}`;
        const r = await fetch(url, { method: "POST", body: lin.engine.glResultado, headers: { "Content-Type": "text/plain" } });
        const txt = (await r.text()).trim();
        if (!r.ok || !txt) throw new Error(`HTTP ${r.status}`);
        const [a1, a2] = txt.split("+");
        p.querySelector("#man1").value = a1 || ""; p.querySelector("#man2").value = a2 || "";
        p.querySelector("#caixa-manual").classList.remove("hidden");
        res.innerHTML = `Resposta: <span class="mono">${h(txt)}</span> — confira e clique em <b>Salvar</b> na tipagem manual.`;
      } catch (err) {
        navigator.clipboard && navigator.clipboard.writeText(lin.engine.glResultado).catch(() => {});
        res.innerHTML = `Não foi possível consultar a API daqui (${h(err.message)}; o servidor do NMDP pode bloquear chamadas de páginas web). A GLString foi copiada para a área de transferência: codifique-a pela ferramenta MAC do NMDP e informe o resultado na opção Manual.`;
      }
    };
    const lim = p.querySelector("#limpar-dec");
    if (lim) lim.onclick = ev => { ev.preventDefault(); decidir(lin, null); abrirPainel(lin.chave, true); };
  }

  // ================================================================ revisão em lote
  function grupoDe(l) {
    const rej = l.engine && l.engine.status !== "Approved";
    const qcR = l.qcNivel === "erro" && (l.comp.status === "identico" || l.comp.status === "principal") && !rej;
    return [l.locus, l.comp.status, rej ? "rej" : "ok", qcR ? "qc" : ""].join("|");
  }
  function renderRevisao() {
    const pend = E.cons.linhas.filter(pendente);
    if (!pend.length) {
      const nd = Object.keys(E.decisoes).length;
      return `<div class="vazio-ok"><div class="grande">✓</div><h2>Nenhuma pendência</h2><p class="sec">${nd} tipagem(ns) decidida(s) pelo analista. Confira a aba <b>Exportar</b> para gerar os arquivos.</p>
        <button class="btn primario" data-ir="exportar">Ir para Exportar →</button></div>`;
    }
    const grupos = new Map();
    for (const l of pend) { const g = grupoDe(l); if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(l); }
    const ordenados = [...grupos.entries()].sort((a, b) => b[1].length - a[1].length);
    return `<p class="sec" style="margin-top:0">As pendências estão agrupadas por locus e tipo de situação. Dá para decidir um grupo inteiro de uma vez (cada tipagem fica registrada com o seu nome) ou abrir uma por uma.</p>
      <div class="grupos">${ordenados.map(([g, ls]) => {
        const [locus, st, rej, qc] = g.split("|");
        const temE = ls.every(l => l.opcoes.engine), temA = ls.every(l => l.opcoes.assign);
        const desc = [HLA.STATUS[st].rotulo, rej === "rej" ? "não aprovado no NGSengine" : "", qc ? "com alerta vermelho de QC" : ""].filter(Boolean).join(" · ");
        return `<section class="grupo"><header><span class="badge st-${st}">${ICONE[st]} ${ls.length}</span>
          <div class="tit"><b>${h(locus)} · ${h(desc)}</b><span>${h(ls[0].sugestao.motivo)}</span></div>
          <button class="btn pequeno" data-lote="engine" data-grupo="${h(g)}" ${temE ? "" : "disabled"}>Liberar NGSengine (${ls.length})</button>
          <button class="btn pequeno" data-lote="assign" data-grupo="${h(g)}" ${temA ? "" : "disabled"}>Liberar Assign (${ls.length})</button>
          <button class="btn pequeno" data-lote="nao_liberar" data-grupo="${h(g)}">Não liberar</button></header>
          <div class="linhas">${ls.map(l => `<div class="linha-rev" data-chave="${h(l.chave)}"><b>${h(l.id)}</b>
            <div><div class="lbl">NGSengine</div><div class="gl" title="${h(l.engine ? l.engine.glConclusiva : "")}">${h(l.engine ? l.engine.glConclusiva || "—" : "—")}</div>
            <div class="lbl">Assign</div><div class="gl" title="${h(l.assign ? l.assign.gl : "")}">${h(l.assign ? l.assign.gl || "—" : "—")}</div></div></div>`).join("")}</div></section>`;
      }).join("")}</div>`;
  }
  function decidirLote(fonte, g) {
    const ls = E.cons.linhas.filter(l => pendente(l) && grupoDe(l) === g);
    if (!ls.length) return;
    const [locus, st] = g.split("|");
    modal(`<h2>Decidir ${ls.length} tipagem(ns) de uma vez?</h2>
      <p>${h(locus)} · ${h(HLA.STATUS[st].rotulo)} → <b>${h(FONTES[fonte])}</b></p>
      <p class="sec">Amostras: ${ls.map(l => h(l.id)).join(", ")}</p>
      <textarea class="obs" id="obs-lote" placeholder="Observação aplicada a todas (opcional)"></textarea>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="btn" id="cancelar">Cancelar</button><button class="btn primario" id="confirmar">Confirmar</button></div>`, m => {
      m.querySelector("#cancelar").onclick = fecharModal;
      m.querySelector("#confirmar").onclick = () => garantirAnalista(() => {
        const obs = m.querySelector("#obs-lote") ? m.querySelector("#obs-lote").value : "";
        for (const l of ls) decidir(l, { fonte, obs: obs || `Decisão em lote (${HLA.STATUS[st].rotulo})` }, true);
        fecharModal(); render(); toast(`${ls.length} tipagem(ns): ${FONTES[fonte]}`);
      });
    });
  }

  // ================================================================ qualidade
  function renderQualidade() {
    const L = E.cons.limites;
    const campos = [
      ["profMinErro", "Profundidade mín. — crítico <"], ["profMinAviso", "Profundidade mín. — atenção <"],
      ["sinalRuidoErro", "Het. vs ruído — crítico <"], ["sinalRuidoAviso", "Het. vs ruído — atenção <"],
      ["ruidoMaxErro", "Ruído máx. — crítico >"], ["ruidoMaxAviso", "Ruído máx. — atenção >"],
      ["segBaseErro", "2ª base het. — crítico <"], ["segBaseAviso", "2ª base het. — atenção <"],
      ["mapPctAviso", "Reads usados no locus (%) <"], ["q30Aviso", "Assign Q30 (%) <"],
      ["coberturaErro", "Assign cobertura — crítico <"], ["coberturaAviso", "Assign cobertura — atenção <"], ["balancoAviso", "Assign balanço alélico (%) <"],
    ];
    const alertas = E.cons.linhas.filter(l => l.comp.status !== "ausente" && (l.qcNivel === "erro" || l.qcNivel === "aviso"))
      .sort((a, b) => (a.qcNivel === b.qcNivel ? 0 : a.qcNivel === "erro" ? -1 : 1));
    return `<div class="graficos">
      <div class="cartao"><h3>Profundidade mínima por locus</h3><div class="sub">NGSengine, região Exon+, locos tipados · linhas = limites de atenção e crítico</div><div id="g-prof"></div></div>
      <div class="cartao"><h3>Concordância por locus</h3><div class="sub">Proporção dos locos tipados em cada situação</div><div id="g-conc"></div></div>
      <div class="cartao"><h3>Sinal heterozigoto vs ruído</h3><div class="sub">Quanto maior, mais separado o 2º alelo do ruído · só locos heterozigotos</div><div id="g-sn"></div></div>
      <div class="cartao"><h3>Reads por amostra</h3><div class="sub">Total de reads no NGSengine</div><div id="g-reads"></div></div>
      <div class="cartao largo"><h3>Limites de qualidade</h3><div class="sub">Valores iniciais sugeridos (o dashboard antigo alertava profundidade &lt; 50x). Ajuste ao POP do laboratório: os alertas e as sugestões são recalculados na hora e ficam salvos.</div>
        <div class="limites">${campos.map(([k, r]) => `<label>${h(r)}<input type="number" step="any" data-lim="${k}" value="${L[k]}"></label>`).join("")}</div>
        <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:12px;font-size:13px">
          <label><input type="checkbox" id="cfg-nulos" ${E.cfg.ignorarNulos ? "checked" : ""}> Ignorar alternativas com alelo nulo (N) na comparação</label>
          <label><input type="checkbox" id="cfg-qc" ${E.cfg.revisarAlertaVermelho ? "checked" : ""}> Exigir revisão de concordantes com alerta vermelho</label>
          <label><input type="checkbox" id="cfg-avancar" ${E.cfg.avancar ? "checked" : ""}> Ir para a próxima pendência após decidir</label>
          <button class="btn pequeno" id="lim-padrao">Restaurar padrões</button>
        </div></div>
      <div class="cartao largo"><h3>Locos com alerta (${alertas.length})</h3><div class="sub">Clique para abrir a comparação</div>
        <div style="max-height:420px;overflow:auto"><table class="tabela-qc"><thead><tr><th>Amostra</th><th>Locus</th><th>Nível</th><th>Situação</th><th>Alertas</th></tr></thead><tbody>
        ${alertas.map(l => `<tr data-chave="${h(l.chave)}"><td class="mono">${h(l.id)}</td><td>${h(l.locus)}</td><td><span class="qcdot ${l.qcNivel}"></span> ${l.qcNivel === "erro" ? "crítico" : "atenção"}</td><td><span class="badge st-${l.comp.status}" style="font-size:11px;padding:0 7px">${ICONE[l.comp.status]} ${h(ROT_CURTO[l.comp.status])}</span></td><td>${l.qc.filter(q => q.nivel !== "info").map(q => h(q.texto)).join(" · ")}</td></tr>`).join("")}
        </tbody></table></div></div>
    </div>`;
  }

  // ---------- gráficos SVG (sem bibliotecas)
  const NS = "http://www.w3.org/2000/svg";
  function hash(s) { let x = 0; for (const ch of s) x = (x * 31 + ch.charCodeAt(0)) | 0; return ((x >>> 0) % 1000) / 1000; }
  function escala(d0, d1, r0, r1) { return v => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0); }
  function ticks(max, n) { const passo = Math.pow(10, Math.floor(Math.log10(max / n))); const m = [1, 2, 5, 10].find(k => max / (passo * k) <= n) * passo; const t = []; for (let v = 0; v <= max + 1e-9; v += m) t.push(+v.toFixed(6)); return t; }
  function dica(ev, html) {
    const d = $("#dica");
    if (!html) { d.classList.add("hidden"); return; }
    d.innerHTML = html; d.classList.remove("hidden");
    const x = Math.min(ev.clientX + 14, window.innerWidth - d.offsetWidth - 10), y = Math.min(ev.clientY + 14, window.innerHeight - d.offsetHeight - 10);
    d.style.left = x + "px"; d.style.top = y + "px";
  }
  function corNivel(n) { return n === "erro" ? "var(--critical)" : n === "aviso" ? "var(--warning)" : "var(--accent)"; }
  function svgBase(w, hgt) { const s = document.createElementNS(NS, "svg"); s.setAttribute("viewBox", `0 0 ${w} ${hgt}`); s.setAttribute("class", "graf"); return s; }
  function el(tag, attrs, pai, txt) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (txt !== undefined) e.textContent = txt; if (pai) pai.appendChild(e); return e; }
  function eixoY(s, y, valores, x0, x1, fmtv) { for (const v of valores) { el("line", { x1: x0, x2: x1, y1: y(v), y2: y(v), class: "grade" }, s); el("text", { x: x0 - 6, y: y(v) + 4, "text-anchor": "end" }, s, fmtv ? fmtv(v) : v); } }
  function pontoInterativo(s, cx, cy, cor, lin, html) {
    const c = el("circle", { cx, cy, r: 4.5, fill: cor, class: "ponto" }, s);
    const alvo = el("circle", { cx, cy, r: 10, class: "alvo" }, s);
    for (const t of [c, alvo]) {
      t.addEventListener("mousemove", ev => dica(ev, html));
      t.addEventListener("mouseleave", ev => dica(ev, null));
      t.addEventListener("click", () => abrirPainel(lin.chave));
    }
  }
  function desenharGraficos() {
    const L = E.cons.limites, locos = E.cons.locos;
    const tip = E.cons.linhas.filter(l => l.engine && l.comp.status !== "ausente");
    const ex = l => l.engine.regioes["Exon+"] || l.engine.regioes["Amplicon"] || {};
    // 1) profundidade por locus
    {
      const W = 640, H = 290, m = { l: 44, r: 12, t: 12, b: 30 };
      const vals = tip.map(l => ex(l).profMin).filter(v => v !== null && v !== undefined);
      const max = Math.max(L.profMinAviso * 1.2, ...vals) * 1.05;
      const s = svgBase(W, H), y = escala(0, max, H - m.b, m.t);
      const bw = (W - m.l - m.r) / locos.length;
      eixoY(s, y, ticks(max, 5), m.l, W - m.r);
      el("line", { x1: m.l, x2: W - m.r, y1: y(L.profMinAviso), y2: y(L.profMinAviso), class: "lim" }, s);
      el("text", { x: W - m.r, y: y(L.profMinAviso) - 4, "text-anchor": "end" }, s, `atenção < ${L.profMinAviso}x`);
      el("line", { x1: m.l, x2: W - m.r, y1: y(L.profMinErro), y2: y(L.profMinErro), class: "lim-erro" }, s);
      el("text", { x: W - m.r, y: y(L.profMinErro) - 4, "text-anchor": "end" }, s, `crítico < ${L.profMinErro}x`);
      locos.forEach((lc, i) => {
        const cx = m.l + bw * (i + 0.5);
        el("text", { x: cx, y: H - 10, "text-anchor": "middle" }, s, lc.replace("HLA-", ""));
        for (const l of tip.filter(t => t.locus === lc)) {
          const v = ex(l).profMin; if (v === null || v === undefined) continue;
          const nivel = v < L.profMinErro ? "erro" : v < L.profMinAviso ? "aviso" : "";
          pontoInterativo(s, cx + (hash(l.chave) - 0.5) * bw * 0.6, y(v), corNivel(nivel), l,
            `<b class="mono">${h(l.id)}</b> · ${h(l.locus)}<br>Profundidade mínima: <b>${v}x</b><br>Mediana: ${fmt(ex(l).profMed)}x · ${h(l.engine.status)}`);
        }
      });
      $("#g-prof").appendChild(s);
    }
    // 2) concordância por locus (barras 100% empilhadas)
    {
      const ordem = ["identico", "principal", "parcial", "campos2", "divergente", "so_engine", "so_assign"];
      const W = 640, rowH = 26, m = { l: 56, r: 40, t: 34, b: 8 };
      const H = m.t + locos.length * rowH + m.b;
      const s = svgBase(W, H), x = escala(0, 1, m.l, W - m.r);
      // legenda
      let lx = m.l;
      for (const st of ordem) {
        if (!E.cons.linhas.some(l => l.comp.status === st)) continue;
        const g = el("g", { class: `st-${st}` }, s);
        el("rect", { x: lx, y: 6, width: 10, height: 10, rx: 3, style: "fill:var(--c)" }, g);
        const t = el("text", { x: lx + 14, y: 15 }, g, ROT_CURTO[st]);
        lx += 22 + ROT_CURTO[st].length * 6.2;
      }
      locos.forEach((lc, i) => {
        const ls = E.cons.linhas.filter(l => l.locus === lc && l.comp.status !== "ausente");
        const yy = m.t + i * rowH;
        el("text", { x: m.l - 8, y: yy + 15, "text-anchor": "end" }, s, lc.replace("HLA-", ""));
        if (!ls.length) { el("text", { x: m.l, y: yy + 15 }, s, "não tipado"); return; }
        let acc = 0;
        for (const st of ordem) {
          const n = ls.filter(l => l.comp.status === st).length; if (!n) continue;
          const x0 = x(acc / ls.length), x1 = x((acc + n) / ls.length);
          const g = el("g", { class: `st-${st}` }, s);
          const r = el("rect", { x: x0, y: yy + 4, width: Math.max(1, x1 - x0 - 2), height: rowH - 10, rx: 3, style: "fill:var(--c);cursor:pointer" }, g);
          r.addEventListener("mousemove", ev => dica(ev, `<b>${h(lc)}</b> · ${h(HLA.STATUS[st].rotulo)}<br>${n} de ${ls.length} locos (${Math.round((100 * n) / ls.length)}%)`));
          r.addEventListener("mouseleave", ev => dica(ev, null));
          r.addEventListener("click", () => { E.aba = "placa"; E.filtro = st === "identico" || st === "principal" ? "todos" : "divergencias"; render(); });
          acc += n;
        }
        const ok = ls.filter(l => l.comp.status === "identico" || l.comp.status === "principal").length;
        el("text", { x: W - m.r + 6, y: yy + 15 }, s, Math.round((100 * ok) / ls.length) + "%");
      });
      $("#g-conc").appendChild(s);
    }
    // 3) sinal vs ruído x profundidade
    {
      const W = 640, H = 290, m = { l: 44, r: 12, t: 12, b: 34 };
      const pts = tip.map(l => ({ l, x: ex(l).profMin, y: ex(l).sinalRuido })).filter(p => p.x !== null && p.x !== undefined && p.y !== null && p.y !== undefined);
      const mx = Math.max(100, ...pts.map(p => p.x)) * 1.05, my = Math.max(0.5, ...pts.map(p => p.y)) * 1.05;
      const ymin = Math.min(0, ...pts.map(p => p.y)) * 1.1;
      const s = svgBase(W, H), x = escala(0, mx, m.l, W - m.r), y = escala(ymin, my, H - m.b, m.t);
      eixoY(s, y, ticks(my, 5), m.l, W - m.r, v => v.toFixed(2));
      if (ymin < 0) el("text", { x: m.l + 4, y: H - m.b - 4 }, s, "valores negativos = 2º alelo abaixo do ruído");
      for (const t of ticks(mx, 6)) el("text", { x: x(t), y: H - m.b + 16, "text-anchor": "middle" }, s, t);
      el("text", { x: (m.l + W - m.r) / 2, y: H - 2, "text-anchor": "middle" }, s, "profundidade mínima (x)");
      el("line", { x1: m.l, x2: W - m.r, y1: y(L.sinalRuidoAviso), y2: y(L.sinalRuidoAviso), class: "lim" }, s);
      el("line", { x1: m.l, x2: W - m.r, y1: y(L.sinalRuidoErro), y2: y(L.sinalRuidoErro), class: "lim-erro" }, s);
      el("line", { x1: x(L.profMinAviso), x2: x(L.profMinAviso), y1: m.t, y2: H - m.b, class: "lim" }, s);
      for (const p of pts) {
        const nivel = p.y < L.sinalRuidoErro || p.x < L.profMinErro ? "erro" : p.y < L.sinalRuidoAviso || p.x < L.profMinAviso ? "aviso" : "";
        pontoInterativo(s, x(p.x), y(p.y), corNivel(nivel), p.l, `<b class="mono">${h(p.l.id)}</b> · ${h(p.l.locus)}<br>Het. vs ruído: <b>${p.y.toFixed(3)}</b><br>Profundidade mínima: ${p.x}x · ${h(p.l.engine.status)}`);
      }
      $("#g-sn").appendChild(s);
    }
    // 4) reads por amostra
    {
      const am = E.engine.amostras.filter(a => a.readsTotal);
      const W = 640, H = 290, m = { l: 52, r: 12, t: 12, b: 50 };
      const max = Math.max(...am.map(a => a.readsTotal)) * 1.08;
      const s = svgBase(W, H), y = escala(0, max, H - m.b, m.t);
      const bw = (W - m.l - m.r) / am.length;
      eixoY(s, y, ticks(max, 5), m.l, W - m.r, v => (v / 1000) + " mil");
      const ord = am.map(a => a.readsTotal).sort((p, q) => p - q), med = ord[Math.floor(ord.length / 2)];
      am.forEach((a, i) => {
        const x0 = m.l + i * bw;
        const r = el("rect", { x: x0 + 1, y: y(a.readsTotal), width: Math.max(1, bw - 2), height: y(0) - y(a.readsTotal), rx: Math.min(4, bw / 3), fill: a.readsTotal < med * 0.5 ? "var(--critical)" : "var(--accent)", style: "cursor:pointer" }, s);
        r.addEventListener("mousemove", ev => dica(ev, `<b class="mono">${h(a.id)}</b><br>${a.readsTotal.toLocaleString("pt-BR")} reads · ${fmt(a.mapPct)}% usados${a.readsTotal < med * 0.5 ? "<br><b>menos da metade da mediana</b>" : ""}`));
        r.addEventListener("mouseleave", ev => dica(ev, null));
        r.addEventListener("click", () => { E.aba = "placa"; E.busca = a.id; E.filtro = "todos"; render(); });
        if (am.length <= 48) el("text", { x: x0 + bw / 2, y: H - m.b + 10, "text-anchor": "end", transform: `rotate(-60 ${x0 + bw / 2} ${H - m.b + 10})`, style: "font-size:9.5px" }, s, a.id);
      });
      el("line", { x1: m.l, x2: W - m.r, y1: y(med), y2: y(med), class: "lim" }, s);
      $("#g-reads").previousElementSibling.textContent = `Total de reads no NGSengine · linha tracejada = mediana da placa (${(med / 1000).toFixed(0)} mil) · vermelho = menos da metade da mediana`;
      $("#g-reads").appendChild(s);
    }
  }

  // ================================================================ exportar
  function renderExportar() {
    const c = contagens(), iv = imgtVersoes();
    const libQC = c.liberadas.filter(l => l.qcNivel === "erro");
    const semAssign = E.engine.amostras.filter(a => !E.cons.linhas.some(l => l.chaveAmostra === a.chave && l.assign && (l.assign.gl || l.assign.alelo1)));
    const decididasA = Object.keys(E.decisoes).length;
    const passo = (ok, txt, nivel) => `<li class="${ok ? "" : nivel || "pend"}"><span class="ic">${ok ? "✓" : nivel === "aviso" ? "!" : "✕"}</span><div>${txt}</div></li>`;
    return `<div class="exportar">
      <div class="cartao"><h3>Conferência antes de liberar</h3>
        <ul class="passos" style="margin-top:10px">
          ${passo(!c.pend.length, c.pend.length ? `<b>${c.pend.length}</b> tipagem(ns) ainda sem decisão — ficam <b>em branco</b> nos arquivos. <a href="#" data-ir="revisao">Revisar</a>` : "Todas as tipagens têm decisão.")}
          ${passo(!libQC.length, libQC.length ? `<b>${libQC.length}</b> tipagem(ns) liberada(s) com alerta vermelho de QC (${libQC.slice(0, 8).map(l => h(l.id + " " + l.locus.replace("HLA-", ""))).join(", ")}${libQC.length > 8 ? "…" : ""}).` : "Nenhuma tipagem liberada com alerta vermelho.", "aviso")}
          ${passo(!iv.difere, iv.difere ? `Versões IMGT/HLA diferentes: NGSengine ${h(iv.ve.join(", "))} × Assign ${h(iv.va.join(", "))}.` : "Mesma versão IMGT/HLA nos dois softwares (ou Assign ausente).", "aviso")}
          ${passo(!semAssign.length, semAssign.length ? `Amostra(s) sem resultado no Assign: ${semAssign.map(a => h(a.id)).join(", ")}.` : "Todas as amostras do NGSengine têm resultado no Assign.", "aviso")}
          ${passo(true, `${c.liberadas.length} tipagens liberadas: ${c.liberadas.filter(l => !E.decisoes[l.chave]).length} automáticas (concordantes e aprovadas) + ${c.liberadas.filter(l => E.decisoes[l.chave]).length} por decisão de ${h(E.analista || "analista")}. ${decididasA} decisões registradas no total.`)}
        </ul>
        <div class="campo" style="margin-top:16px">Analista responsável<input type="text" id="cfg-analista" value="${h(E.analista)}" placeholder="Seu nome"></div>
        <div class="campo">Excluir dos arquivos SISHLA/REDOME as amostras que contenham (separe por vírgula)<input type="text" id="cfg-excluir" value="${h(E.cfg.excluir)}"></div>
        <div class="campo">IL_DMR para o REDOME: ${E.dmr ? `<b>${h(E.arquivos.dmr.nome)}</b> (${E.dmr.size} pacientes)` : "não carregado"}
          <div><button class="btn pequeno" id="carregar-dmr">${E.dmr ? "Trocar" : "Carregar"} CSV IL_DMR</button><input type="file" id="arq-dmr" accept=".csv" hidden></div></div>
      </div>
      <div class="cartao"><h3>Arquivos</h3><div class="sub">Mesmo layout do ngsengine_to_sishla_report (separador “;”). A tipagem liberada vem da decisão de cada locus.</div>
        <div class="botoes-export">
          <button class="btn primario" id="exp-zip">📦 Pacote completo (.zip) <span>5 arquivos</span></button>
          <button class="btn" id="exp-sishla">SISHLA <span class="muted">resultados_${h(lote())}_sishla_format.csv</span></button>
          <button class="btn" id="exp-redome">REDOME <span class="muted">resultados_${h(lote())}_redome_format.csv</span></button>
          <button class="btn" id="exp-comp">Relatório comparativo <span class="muted">tipagem a tipagem, com métricas</span></button>
          <button class="btn" id="exp-info">Informações adicionais <span class="muted">métricas por locus</span></button>
          <button class="btn" id="exp-print">🖨 Relatório de conferência <span class="muted">imprimir / PDF</span></button>
        </div>
        <h3 style="margin-top:18px">Sessão</h3><div class="sub">As decisões são salvas automaticamente neste navegador. Para continuar em outro computador, exporte a sessão.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn pequeno" id="exp-sessao">Exportar sessão (.json)</button><button class="btn pequeno" id="imp-sessao">Importar sessão</button><input type="file" id="arq-sessao" accept=".json" hidden>
          <button class="btn pequeno" id="limpar-sessao">Apagar decisões desta corrida</button></div>
      </div></div>`;
  }
  function excluirLista() { return E.cfg.excluir.split(",").map(s => s.trim()).filter(Boolean); }
  function arquivosExport() {
    const b = lote(), ex = excluirLista();
    return [
      { nome: `resultados_${b}_sishla_format.csv`, conteudo: HLA.exportarSishla(E.cons, E.decisoes, ex) },
      { nome: `resultados_${b}_redome_format.csv`, conteudo: HLA.exportarRedome(E.cons, E.decisoes, ex, E.dmr) },
      { nome: `resultados_${b}_informacoes_adicionais.csv`, conteudo: HLA.exportarInfoAdicionais(E.cons) },
      { nome: `${b}_engine_assign_consenso.csv`, conteudo: HLA.exportarComparativo(E.cons, E.decisoes) },
      { nome: `${b}_sessao_decisoes.json`, conteudo: JSON.stringify(sessao(), null, 2) },
    ];
  }
  function sessao() { return { app: "HLA Consenso", versao: 1, projeto: E.cons.projeto, analista: E.analista, exportadoEm: new Date().toISOString(), cfg: E.cfg, decisoes: E.decisoes }; }
  function confirmarPendencias(acao) {
    const n = E.cons.linhas.filter(pendente).length;
    if (!n) return acao();
    modal(`<h2>Há ${n} tipagem(ns) sem decisão</h2><p class="sec">Elas sairão em branco nos arquivos SISHLA/REDOME. Deseja exportar mesmo assim?</p>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" id="ir-rev">Revisar pendências</button><button class="btn primario" id="exp-mesmo">Exportar assim</button></div>`, m => {
      m.querySelector("#ir-rev").onclick = () => { fecharModal(); E.aba = "revisao"; render(); };
      m.querySelector("#exp-mesmo").onclick = () => { fecharModal(); acao(); };
    });
  }
  function imprimirRelatorio() {
    const c = contagens(), locos = E.cons.locos;
    const amostras = amostrasOrdenadas();
    const marca = l => { const ef = efetiva(l); return !ef ? " [pendente]" : ef.fonte === "assign" ? " ᴬ" : ef.fonte === "manual" ? " ᴹ" : ef.fonte === "nao_liberar" ? " [não liberado]" : ""; };
    const decisoes = E.cons.linhas.filter(l => E.decisoes[l.chave]);
    $("#relatorio").innerHTML = `<h1>Relatório de conferência NGSengine × Assign — ${h(E.cons.projeto)}</h1>
      <div>${h(E.engine.software)} ${h(E.engine.versao)} · ${E.assigns[0] ? h(E.assigns[0].software) + " · " + h(E.assigns[0].referencia) : "sem Assign"} · Gerado em ${new Date().toLocaleString("pt-BR")} por ${h(E.analista || "—")}</div>
      <div>Concordância: ${c.conc.length}/${c.comp.length} locos comparáveis · ${c.liberadas.length} tipagens liberadas · ${c.pend.length} pendentes · ${decisoes.length} decisões do analista</div>
      <table><thead><tr><th>Amostra</th>${locos.map(l => `<th>${h(l.replace("HLA-", ""))}</th>`).join("")}</tr></thead><tbody>
      ${amostras.map(a => `<tr><td class="mono">${h(a.id)}</td>${locos.map(lc => { const l = a.linhas[lc]; if (!l || l.comp.status === "ausente") return "<td></td>"; const t = HLA.tipagemLiberada(l, E.decisoes[l.chave]); return `<td class="mono">${h(t.alelos.filter(Boolean).map(semPrefixo).join(" / "))}${h(marca(l))}<br><span style="color:#666">${h(ROT_CURTO[l.comp.status])}</span></td>`; }).join("")}</tr>`).join("")}
      </tbody></table>
      <p style="font-size:9px">ᴬ liberado pelo Assign · ᴹ tipagem manual · demais: NGSengine (NMDPCodes reduzidos a 3 campos)</p>
      ${decisoes.length ? `<h1 style="margin-top:14px">Decisões do analista</h1><table><thead><tr><th>Amostra</th><th>Locus</th><th>Situação</th><th>NGSengine</th><th>Assign</th><th>Decisão</th><th>Liberado</th><th>Por / quando</th><th>Observação</th></tr></thead><tbody>
      ${decisoes.map(l => { const d = E.decisoes[l.chave], t = HLA.tipagemLiberada(l, d); return `<tr><td class="mono">${h(l.id)}</td><td>${h(l.locus)}</td><td>${h(HLA.STATUS[l.comp.status].rotulo)}${l.engine && l.engine.status !== "Approved" ? " (NGSengine: " + h(l.engine.status) + ")" : ""}</td><td class="mono">${h(l.engine ? l.engine.glConclusiva : "")}</td><td class="mono">${h(l.assign ? l.assign.gl : "")}</td><td>${h(FONTES[d.fonte])}</td><td class="mono">${h(t.alelos.filter(Boolean).join(" + "))}</td><td>${h(d.usuario)}<br>${new Date(d.quando).toLocaleString("pt-BR")}</td><td>${h(d.obs || "")}</td></tr>`; }).join("")}</tbody></table>` : ""}
      <div class="assin"><div>Analista</div><div>Responsável técnico</div></div>`;
    window.print();
  }

  // ================================================================ eventos
  function ligar(app) {
    app.querySelectorAll(".cel[data-chave], .linha-rev[data-chave], .tabela-qc tr[data-chave]").forEach(b => b.onclick = () => abrirPainel(b.dataset.chave));
    app.querySelectorAll("[data-ir]").forEach(b => b.onclick = ev => { ev.preventDefault(); E.aba = b.dataset.ir; render(); });
    app.querySelectorAll("[data-filtro]").forEach(b => b.onclick = () => { E.aba = "placa"; E.filtro = b.dataset.filtro; render(); });
    app.querySelectorAll("#seg-filtro button").forEach(b => b.onclick = () => { E.filtro = b.dataset.f; render(); });
    const busca = app.querySelector("#busca");
    if (busca) busca.oninput = () => { E.busca = busca.value; const pos = busca.selectionStart; render(); const nb = $("#busca"); nb.focus(); nb.setSelectionRange(pos, pos); };
    app.querySelectorAll("[data-lote]").forEach(b => b.onclick = () => decidirLote(b.dataset.lote, b.dataset.grupo));
    app.querySelectorAll("[data-lim]").forEach(i => i.onchange = () => {
      const v = parseFloat(i.value); if (!Number.isFinite(v)) return;
      E.cfg.limites = { ...E.cfg.limites, [i.dataset.lim]: v }; recalcular(); salvar(); render(); toast("Limites atualizados.");
    });
    const chk = (id, k) => { const c = app.querySelector(id); if (c) c.onchange = () => { E.cfg[k] = c.checked; recalcular(); salvar(); render(); }; };
    chk("#cfg-nulos", "ignorarNulos"); chk("#cfg-qc", "revisarAlertaVermelho"); chk("#cfg-avancar", "avancar");
    const lp = app.querySelector("#lim-padrao"); if (lp) lp.onclick = () => { E.cfg.limites = {}; recalcular(); salvar(); render(); };
    const an = app.querySelector("#cfg-analista"); if (an) an.onchange = () => { E.analista = an.value.trim(); localStorage.setItem("hlaConsenso:analista", E.analista); };
    const exc = app.querySelector("#cfg-excluir"); if (exc) exc.onchange = () => { E.cfg.excluir = exc.value; salvar(); };
    const bind = (id, fn) => { const b = app.querySelector(id); if (b) b.onclick = fn; };
    bind("#exp-zip", () => confirmarPendencias(() => baixar(Arquivos.criarZip(arquivosExport()), `relatorios_completos_${lote()}.zip`)));
    bind("#exp-sishla", () => confirmarPendencias(() => { const a = arquivosExport()[0]; baixar(a.conteudo, a.nome); }));
    bind("#exp-redome", () => confirmarPendencias(() => { const a = arquivosExport()[1]; baixar(a.conteudo, a.nome); }));
    bind("#exp-info", () => { const a = arquivosExport()[2]; baixar(a.conteudo, a.nome); });
    bind("#exp-comp", () => { const a = arquivosExport()[3]; baixar(a.conteudo, a.nome); });
    bind("#exp-print", imprimirRelatorio);
    bind("#exp-sessao", () => baixar(JSON.stringify(sessao(), null, 2), `${lote()}_sessao_decisoes.json`, "application/json"));
    bind("#imp-sessao", () => app.querySelector("#arq-sessao").click());
    bind("#carregar-dmr", () => app.querySelector("#arq-dmr").click());
    bind("#limpar-sessao", () => modal(`<h2>Apagar as decisões desta corrida?</h2><p class="sec">As ${Object.keys(E.decisoes).length} decisões do analista serão removidas deste navegador. As sugestões automáticas continuam.</p><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" id="nao">Cancelar</button><button class="btn primario" id="sim">Apagar</button></div>`, m => {
      m.querySelector("#nao").onclick = fecharModal;
      m.querySelector("#sim").onclick = () => { E.decisoes = {}; salvar(); fecharModal(); render(); toast("Decisões apagadas."); };
    }));
    const as = app.querySelector("#arq-sessao");
    if (as) as.onchange = async () => {
      try {
        const s = JSON.parse(await as.files[0].text());
        const aplicar = () => { E.decisoes = s.decisoes || {}; if (s.cfg) Object.assign(E.cfg, s.cfg); recalcular(); salvar(); render(); toast(`Sessão importada: ${Object.keys(E.decisoes).length} decisões.`); };
        if (s.projeto && s.projeto !== E.cons.projeto) modal(`<h2>Sessão de outra corrida</h2><p>O arquivo é da corrida <b>${h(s.projeto)}</b>, mas a aberta é <b>${h(E.cons.projeto)}</b>. Importar mesmo assim?</p><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" id="nao">Cancelar</button><button class="btn primario" id="sim">Importar</button></div>`, m => { m.querySelector("#nao").onclick = fecharModal; m.querySelector("#sim").onclick = () => { fecharModal(); aplicar(); }; });
        else aplicar();
      } catch (e) { toast("Arquivo de sessão inválido."); }
    };
    const ad = app.querySelector("#arq-dmr");
    if (ad) ad.onchange = async () => {
      try { const f = ad.files[0]; const t = new TextDecoder("latin1").decode(await f.arrayBuffer()); E.dmr = HLA.lerDmr(t); E.arquivos.dmr = { nome: f.name, texto: t }; render(); toast("IL_DMR carregado."); }
      catch (e) { toast(e.message); }
    };
  }

  document.addEventListener("keydown", ev => {
    if ($("#modal")) { if (ev.key === "Escape") fecharModal(); return; }
    const alvo = ev.target;
    const digitando = alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA");
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z" && !digitando) { ev.preventDefault(); return desfazer(); }
    if (digitando) { if (ev.key === "Escape") alvo.blur(); return; }
    if (!E.cons) return;
    const k = ev.key.toLowerCase();
    if (k === "?") return mostrarAtalhos();
    if (k === "escape") return fecharPainel();
    if (k === "p") return navegar(1, true);
    if (!E.aberto) { if (k === "j" || k === "arrowdown") { ev.preventDefault(); navegar(1, true); } return; }
    const lin = E.porChave.get(E.aberto);
    if (k === "j" || k === "arrowdown") { ev.preventDefault(); return navegar(1); }
    if (k === "k" || k === "arrowup") { ev.preventDefault(); return navegar(-1); }
    const mapa = { e: "engine", 1: "engine", a: "assign", 2: "assign", m: "manual", 3: "manual", x: "nao_liberar", 4: "nao_liberar" };
    if (mapa[k]) { ev.preventDefault(); escolher(lin, mapa[k]); }
  });
  function mostrarAtalhos() {
    modal(`<h2>Atalhos de teclado</h2><div class="atalhos">
      <kbd>P</kbd><span>abrir a próxima tipagem pendente</span>
      <kbd>E</kbd> / <kbd>1</kbd><span>liberar a tipagem do NGSengine</span>
      <kbd>A</kbd> / <kbd>2</kbd><span>liberar a tipagem do Assign</span>
      <kbd>M</kbd> / <kbd>3</kbd><span>digitar a tipagem manualmente</span>
      <kbd>X</kbd> / <kbd>4</kbd><span>não liberar (repetir/investigar)</span>
      <kbd>J</kbd> / <kbd>↓</kbd><span>próxima tipagem</span>
      <kbd>K</kbd> / <kbd>↑</kbd><span>tipagem anterior</span>
      <kbd>Ctrl</kbd>+<kbd>Z</kbd><span>desfazer a última decisão</span>
      <kbd>Esc</kbd><span>fechar o painel</span></div>
      <div style="text-align:right;margin-top:14px"><button class="btn" onclick="document.getElementById('modal').remove()">Fechar</button></div>`);
  }

  // ---------------------------------------------------------------- inicialização
  const drop = $("#drop"), inp = $("#arquivos");
  drop.onclick = () => inp.click();
  drop.onkeydown = ev => { if (ev.key === "Enter" || ev.key === " ") inp.click(); };
  inp.onchange = () => receberArquivos([...inp.files]);
  ["dragenter", "dragover"].forEach(t => document.addEventListener(t, ev => { ev.preventDefault(); drop.classList.add("sobre"); }));
  ["dragleave", "drop"].forEach(t => document.addEventListener(t, ev => { ev.preventDefault(); if (t === "drop" || ev.target === drop) drop.classList.remove("sobre"); }));
  document.addEventListener("drop", ev => { if (ev.dataTransfer && ev.dataTransfer.files.length && !E.cons) receberArquivos([...ev.dataTransfer.files]); });
  $("#bt-analisar").onclick = analisar;
  $("#abas").onclick = ev => { const b = ev.target.closest("button[data-aba]"); if (b) { E.aba = b.dataset.aba; render(); } };
  $("#bt-atalhos").onclick = mostrarAtalhos;
  $("#bt-nova").onclick = () => location.reload();
  $("#bt-tema").onclick = () => {
    const r = document.documentElement, escuro = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    r.dataset.theme = escuro ? "light" : "dark"; localStorage.setItem("hlaConsenso:tema", r.dataset.theme);
  };
  const tema = localStorage.getItem("hlaConsenso:tema"); if (tema) document.documentElement.dataset.theme = tema;
  window.HLAConsenso = { E, receberArquivos, analisar };   // para testes
})();
