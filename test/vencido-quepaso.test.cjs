// "¿Qué pasó?" en el banner de vencidos (v259).
//
// En el uso real había 20 enviados vencidos y 0 perdidos: el ✓ solo apaga el
// aviso y el presupuesto queda vencido para siempre, así que la conversión del
// Mapa se apoyaba en una suposición. Ahora cada vencido del banner se puede
// cerrar con lo que pasó:
//   A) Aceptó → estado aceptado, sale del banner.
//   B) Lo perdí → estado perdido, sale del banner y deja "Deshacer".
//   C) Sigue en pie → vigencia nueva desde hoy (los días del presupuesto),
//      vuelve a "esperando respuesta" y deja "Deshacer" (que repone la fecha).
//   D) Con el mismo presupuesto abierto en el editor, la fecha nueva llega a S
//      (si no, el autoguardado la pisaba con la vieja).
//   E) El deshacer de la prórroga sobrevive al saneo del arranque.

const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH
  || require('os').homedir() + '/.cache/cc-headless/chrome-headless-shell-linux64/chrome-headless-shell';
const INDEX = 'file://' + path.resolve(__dirname, '..', 'index.html');

let fallos = 0;
function check(ok, nombre, detalle) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nombre + (detalle ? '  — ' + detalle : ''));
  if (!ok) fallos++;
}

function isoEnDias(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function historial() {
  const alta = (id, cli, validez) => ({
    id, quoteNumber: '2026-0' + id, clientName: cli, estado: 'enviado', total: 5000000, currency: 'ARS',
    savedAt: '2026-08-01T12:00:00.000Z', enviadoEn: '2026-08-01T12:00:00.000Z',
    snapshot: { quoteNumber: '2026-0' + id, clientName: cli, dateIssue: isoEnDias(-60),
      dateExpiry: isoEnDias(-30), validityDays: validez, items: [] },
  });
  return [alta(701, 'Cliente acepta', 30), alta(702, 'Cliente perdido', 30), alta(703, 'Cliente lo piensa', 15)];
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true });
  await page.setRequestInterception(true);
  page.on('request', (req) => { if (req.url().startsWith('file://')) req.continue(); else req.abort(); });
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));

  await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.evaluate((h) => {
    localStorage.clear();
    localStorage.setItem('pq_onboarded', '1');
    localStorage.setItem('pq_h', JSON.stringify(h));
  }, historial());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 900)));
  await page.evaluate(() => { switchTab('historial'); renderHistory(); histAvisosToggle(true); });

  const banner = () => page.evaluate(() => {
    const el = document.getElementById('expiry-banner');
    return {
      texto: el ? el.textContent.replace(/\s+/g, ' ') : '',
      preguntas: el ? el.querySelectorAll('.fub-quepaso').length : 0,
    };
  });

  const b0 = await banner();
  check(b0.preguntas === 3 && /¿Qué pasó\?/.test(b0.texto) && /Sigue en pie/.test(b0.texto),
    'Cada vencido del banner pregunta qué pasó', b0.preguntas + ' pregunta(s)');

  // La fila entra en un celular de 360 px sin desbordar la tarjeta.
  const ancho = await page.evaluate(() => {
    const fila = document.querySelector('#expiry-banner .fub-quepaso');
    const card = fila && fila.closest('.fub-item');
    return fila && card ? { fila: fila.scrollWidth, card: card.clientWidth } : null;
  });
  check(ancho && ancho.card > 0 && ancho.fila <= ancho.card, 'La fila de respuestas entra en la tarjeta a 360 px', JSON.stringify(ancho));

  // ── A) Aceptó ─────────────────────────────────────────────────────────
  await page.evaluate(() => {
    document.querySelector('#expiry-banner .fub-qp.is-acepto[onclick*="701"]').click();
    if (typeof closeAgendaDlg === 'function') closeAgendaDlg();
  });
  const a = await page.evaluate(() => getH().find(e => e.id === 701).estado);
  const b1 = await banner();
  check(a === 'aceptado' && !/Cliente acepta/.test(b1.texto), 'Aceptó: pasa a aceptado y sale del banner', a);

  // ── B) Lo perdí ───────────────────────────────────────────────────────
  await page.evaluate(() => document.querySelector('#expiry-banner .fub-qp.is-perdido[onclick*="702"]').click());
  const b = await page.evaluate(() => {
    const e = getH().find(x => x.id === 702);
    const rec = getNotifLog().find(n => n.undo && n.undo.type === 'estado' && n.undo.id === 702);
    return { estado: e.estado, undo: rec ? rec.undo : null, recId: rec ? rec.id : null };
  });
  const b2 = await banner();
  check(b.estado === 'perdido' && !/Cliente perdido/.test(b2.texto), 'Lo perdí: pasa a perdido y sale del banner', b.estado);
  check(b.undo && b.undo.prev === 'enviado', 'Lo perdí deja "Deshacer" al estado anterior', JSON.stringify(b.undo));
  const bUndo = await page.evaluate((rid) => { notifUndo(rid); return getH().find(x => x.id === 702).estado; }, b.recId);
  check(bUndo === 'enviado', 'Deshacer el perdido lo vuelve a enviado', bUndo);

  // ── C + D) Sigue en pie, con el presupuesto abierto en el editor ──────
  const c = await page.evaluate(() => {
    S.quoteNumber = '2026-0703'; S.dateExpiry = getH().find(x => x.id === 703).snapshot.dateExpiry;
    document.querySelector('#expiry-banner .fub-qp[onclick*="703"][onclick*="sigue"]').click();
    const e = getH().find(x => x.id === 703);
    const rec = getNotifLog().find(n => n.undo && n.undo.type === 'prorroga' && n.undo.id === 703);
    return { exp: e.snapshot.dateExpiry, sExp: S.dateExpiry, venc: mapaEsVencido(e),
      visto: !!e.vencimientoVistoEn, undo: rec ? rec.undo : null, recId: rec ? rec.id : null };
  });
  const b3 = await banner();
  check(c.exp === isoEnDias(15) && !c.venc, 'Sigue en pie: vigencia nueva desde hoy con los días del presupuesto (15)', c.exp);
  check(!/Cliente lo piensa/.test(b3.texto), 'Sigue en pie: sale del banner de vencidos');
  check(c.sExp === c.exp, 'Con el editor en ese presupuesto, S recibe la fecha nueva (el autoguardado no la pisa)', c.sExp);
  check(c.undo && c.undo.dateExpiry === isoEnDias(-30), 'Sigue en pie deja "Deshacer" con la fecha anterior', JSON.stringify(c.undo));

  // ── E) El deshacer sobrevive al saneo ─────────────────────────────────
  const e = await page.evaluate(() => {
    const log = sanitizeNotifLog(getNotifLog());
    const r = log.find(n => n.undo && n.undo.type === 'prorroga');
    return r ? r.undo : null;
  });
  check(e && e.dateExpiry === isoEnDias(-30) && e.id === 703, 'sanitizeNotifLog conserva el deshacer de la prórroga', JSON.stringify(e));

  const cUndo = await page.evaluate((rid) => {
    notifUndo(rid);
    const x = getH().find(y => y.id === 703);
    return { exp: x.snapshot.dateExpiry, sExp: S.dateExpiry };
  }, c.recId);
  const b4 = await banner();
  check(cUndo.exp === isoEnDias(-30) && cUndo.sExp === isoEnDias(-30) && /Cliente lo piensa/.test(b4.texto),
    'Deshacer la prórroga repone la fecha (también en S) y vuelve al banner', JSON.stringify(cUndo));

  check(!errores.length, 'Sin errores de JS', errores.join(' | '));
  await browser.close();
  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
