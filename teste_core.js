const fs = require('fs'); const path=require('path');
const A = require('../js/arquivos.js'); const H = require('../js/core.js');
(async () => {
  const dir='/home/claude/pos/';
  let t0=Date.now();
  const xml = fs.readFileSync(dir+'2026_NTVPB_51_MARLA_121126_RED_ROT_335784449_tarr.xml','utf8');
  const enx = H.enxugarXml(xml); console.log('enxuto MB', (enx.length/1e6).toFixed(1), 'ms', Date.now()-t0);
  t0=Date.now(); const eng = H.lerEngine(xml, 'tarr.xml'); console.log('parse ms', Date.now()-t0, eng.projeto, eng.software, eng.versao, 'amostras', eng.amostras.length, 'locos', eng.locos.length);
  const assigns=[];
  for (const f of fs.readdirSync(dir).filter(f=>f.endsWith('.xlsx'))) {
    const abas = await A.lerXlsx(fs.readFileSync(dir+f)); assigns.push(H.lerAssign(abas, f));
  }
  console.log(assigns.map(a=>[a.arquivo.slice(0,12), a.software, a.referencia, a.locos.length]));
  const cons = H.consolidar(eng, assigns, {});
  const cont = {}; for (const l of cons.linhas) cont[l.comp.status]=(cont[l.comp.status]||0)+1; console.log(cont, 'linhas', cons.linhas.length, cons.locos);
  const pend = cons.linhas.filter(l=>!l.sugestao.automatica); console.log('pendentes', pend.length);
  const porLocus={}; for (const l of pend) porLocus[l.locus+' '+l.comp.status]=(porLocus[l.locus+' '+l.comp.status]||0)+1; console.log(porLocus);
  for (const l of cons.linhas.filter(l=>['divergente','parcial','campos2','so_engine','so_assign'].includes(l.comp.status) && l.locus!=='HLA-DPB1').slice(0,20))
    console.log(l.id, l.locus, l.comp.status, '| E:', l.engine&&l.engine.status, (l.engine&&l.engine.glConclusiva||'').slice(0,80), '| A:', (l.assign&&l.assign.gl||'').slice(0,80));
  const qc={}; for (const l of cons.linhas) qc[l.qcNivel]=(qc[l.qcNivel]||0)+1; console.log('qc', qc);
  const s = cons.linhas.find(l=>l.id==='3099' && l.locus==='HLA-A'); console.log(JSON.stringify({c:s.comp, op:s.opcoes, sug:s.sugestao, qc:s.qc}).slice(0,900));
  fs.writeFileSync('teste/sishla.csv', H.exportarSishla(cons, {}, ['1044736']));
  fs.writeFileSync('teste/redome.csv', H.exportarRedome(cons, {}, ['1044736']));
  fs.writeFileSync('teste/comparativo.csv', H.exportarComparativo(cons, {}));
  fs.writeFileSync('teste/info.csv', H.exportarInfoAdicionais(cons));
})().catch(e=>{console.error(e); process.exit(1)});
