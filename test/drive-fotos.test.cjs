// test/drive-fotos.test.cjs — Backup a Drive con las fotos aparte (v230).
//
// Antes el backup era UN archivo con todas las fotos en base64 y se subía
// entero en cada cambio (20 MB por corregir un precio). Ahora cada foto es un
// archivo propio que sube una sola vez, y el backup va sin fotos.
//
// Se corre contra un Drive FALSO en memoria (netFetch reemplazado en la
// página): appDataFolder con listado paginado, subida multipart, PATCH,
// bajada y borrado. Lo que se protege:
//
//   1. Primera copia: cada foto en su archivo, el JSON sin fotos y chico.
//   2. Un cambio sin fotos nuevas sube solo el JSON.
//   3. Una foto nueva sube sola.
//   4. Lo que no se puede guardar aparte (un ID con otro formato) queda
//      adentro del JSON: nunca se pierde una foto.
//   5. Limpieza: se borran de Drive las fotos que ya no usa ningún
//      presupuesto, una vez por sesión, y NO las que se usan aunque este
//      equipo no las tenga.
//   6. Restaurar en un equipo nuevo trae todas las fotos, idénticas.
//   7. Si una foto no baja, la restauración falla entera (no aplica nada a
//      medias).
//   8. Una copia del formato viejo (fotos adentro) se sigue restaurando.
//   9. Un ID de foto manipulado en el backup no llega a la consulta de Drive.
//  10. Si otro teléfono borró una foto de Drive, la próxima copia la repone.
//
// Uso:  node test/drive-fotos.test.cjs

const path = require('node:path');

let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch (e) {
  console.error('Falta puppeteer-core. Corré .claude/hooks/session-start.sh');
  process.exit(2);
}
const EXEC = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_HEADLESS_SHELL;
if (!EXEC) { console.error('Falta $PUPPETEER_EXECUTABLE_PATH'); process.exit(2); }

const APP = 'file://' + path.resolve(__dirname, '..', 'index.html');

let allOk = true;
const check = (name, ok, extra) => {
  if (!ok) allOk = false;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};

// Drive falso + datos de prueba. Queda en window.__drive.
const PREPARAR = `
  (() => {
    const files = new Map();      // fileId → { name, mime, data: string | Uint8Array }
    let seq = 0;
    const D = window.__drive = { files, log: [], fallarFotoGet: false, pagina: 2 };
    const json = (o, st) => new Response(JSON.stringify(o), { status: st || 200, headers: { 'Content-Type': 'application/json' } });
    const latin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; };
    netFetch = async (url, opts, o) => {
      opts = opts || {};
      const m = opts.method || 'GET';
      const u = new URL(url);
      let bytes = 0;
      if (typeof opts.body === 'string') bytes = opts.body.length;
      else if (opts.body && opts.body.size != null) bytes = opts.body.size;
      D.log.push({ m, url, bytes, blob: !!(opts.body && typeof opts.body !== 'string') });
      // Listado
      if (m === 'GET' && /\\/drive\\/v3\\/files$/.test(u.pathname)) {
        const q = u.searchParams.get('q') || '';
        let lista = [...files.entries()].map(([id, f]) => ({ id, name: f.name }));
        const eq = /name='([^']+)'/.exec(q), co = /name contains '([^']+)'/.exec(q);
        if (eq) lista = lista.filter(f => f.name === eq[1]);
        if (co) lista = lista.filter(f => f.name.indexOf(co[1]) >= 0);
        const desde = parseInt(u.searchParams.get('pageToken') || '0', 10);
        const tam = co ? D.pagina : 1000;
        const pag = lista.slice(desde, desde + tam);
        const out = { files: pag };
        if (desde + tam < lista.length) out.nextPageToken = String(desde + tam);
        return json(out);
      }
      // Subida nueva (multipart)
      if (m === 'POST' && /upload\\/drive\\/v3\\/files$/.test(u.pathname)) {
        let raw, u8 = null;
        if (typeof opts.body === 'string') raw = opts.body;
        else { u8 = new Uint8Array(await opts.body.arrayBuffer()); raw = latin1(u8); }
        const b = /boundary=(.+)$/.exec(opts.headers['Content-Type'])[1];
        const partes = raw.split('--' + b);
        const meta = JSON.parse(partes[1].split('\\r\\n\\r\\n')[1].trim());
        const p2 = partes[2];
        const cab = p2.split('\\r\\n\\r\\n')[0];
        const mime = /Content-Type: ([^\\r\\n]+)/.exec(cab)[1].trim();
        const ini = raw.indexOf(p2) + cab.length + 4;
        const fin = raw.lastIndexOf('\\r\\n--' + b + '--');
        const data = u8 ? u8.slice(ini, fin) : raw.slice(ini, fin);
        const id = 'f' + (++seq);
        files.set(id, { name: meta.name, mime, data });
        return json({ id });
      }
      // Actualizar el JSON
      if (m === 'PATCH') {
        const id = /files\\/([^/?]+)/.exec(u.pathname)[1];
        const f = files.get(id); if (!f) return json({}, 404);
        f.data = opts.body; return json({ id });
      }
      // Bajar
      if (m === 'GET' && u.searchParams.get('alt') === 'media') {
        const id = decodeURIComponent(/files\\/([^/?]+)/.exec(u.pathname)[1]);
        const f = files.get(id); if (!f) return json({}, 404);
        if (typeof f.data !== 'string') {
          if (D.fallarFotoGet) return json({}, 500);
          return new Response(new Blob([f.data], { type: f.mime }), { status: 200 });
        }
        return new Response(f.data, { status: 200 });
      }
      if (m === 'DELETE') {
        const id = decodeURIComponent(/files\\/([^/?]+)/.exec(u.pathname)[1]);
        files.delete(id); return new Response('', { status: 204 });
      }
      return json({ error: 'no simulado' }, 400);
    };
    gdriveGetToken = async () => 'tok';
    D.fotosArriba = () => [...files.values()].filter(f => /^pq-foto-/.test(f.name)).map(f => f.name);
    D.json = () => { const f = [...files.values()].find(f => f.name === GDRIVE.FILE); return f ? JSON.parse(f.data) : null; };
    D.reset = () => { D.log.length = 0; };
    // Las fotos suben como Blob (binario); el backup, como texto.
    D.subidasFoto = () => D.log.filter(l => l.m === 'POST' && l.blob && /upload/.test(l.url)).length;
  })();
`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => { allOk = false; console.log('PAGEERROR', e.message); });
    await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1200));
    const r = await page.evaluate(new Function(`return (async () => {
      ${PREPARAR}
      const D = window.__drive;
      setH([]);
      // Fotos reales: JPEG chicos de colores distintos.
      const foto = (color) => { const c = document.createElement('canvas'); c.width = 40; c.height = 30;
        const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, 40, 30); return c.toDataURL('image/jpeg', 0.8); };
      const presupuesto = async (n, color) => {
        const id = await savePhoto(foto(color));
        S.numPrefix = '2026-'; S.numNext = n; S.quoteNumber = mkQN(); S.dateIssue = today(); calcExpiry();
        S.clientName = 'Cliente ' + n;
        S.items = [{ id: 1, type: 'tree', species: 'Pino', desc: 'Poda', price: '100000', qty: 1, photos: [id] }];
        noSync = true; restoreUI(); noSync = false; renderItems(); autoSaveToHistory();
        return id;
      };
      const ids = [await presupuesto(1, '#c00'), await presupuesto(2, '#0c0'), await presupuesto(3, '#00c')];
      // Una foto con un ID de otro formato (no se puede guardar aparte).
      const raro = 'p_raro-1';
      photoCache.set(raro, foto('#999'));
      { const h = getH(); h[0].snapshot.dispoPhotos = [raro]; setH(h); }
      const original = Object.fromEntries([...ids, raro].map(i => [i, photoCache.get(i)]));
      const out = {};

      // 1. Primera copia
      D.reset(); GDRIVE._limpiado = true;
      await gdriveUpload();
      const j1 = D.json();
      out.primera = { fotos: D.fotosArriba().length, subidas: D.subidasFoto(),
        aparte: (j1._fotosAparte || []).slice().sort().join() === ids.slice().sort().join(),
        jsonSinFotosNormales: ids.every(i => !j1.photos[i]), raroAdentro: !!j1.photos[raro],
        jsonBytes: GDRIVE._ultimaSubida.json };

      // 2. Cambio sin fotos nuevas
      D.reset();
      S.clientName = 'Cliente 3 bis'; autoSaveToHistory();
      await gdriveUpload();
      out.segunda = { subidasFoto: D.subidasFoto(), patch: D.log.filter(l => l.m === 'PATCH').length,
        bytes: D.log.reduce((a, l) => a + l.bytes, 0) };

      // 3. Foto nueva
      D.reset();
      const id4 = await presupuesto(4, '#cc0'); ids.push(id4); original[id4] = photoCache.get(id4);
      await gdriveUpload();
      out.tercera = { subidasFoto: D.subidasFoto(), fotos: D.fotosArriba().length };

      // 5. Limpieza: se borra el presupuesto 1. La foto del 2 desaparece de
      //    ESTE equipo pero sigue nombrada: no se tiene que borrar de Drive.
      D.reset();
      setH(getH().filter(e => e.clientName !== 'Cliente 1'));
      photoCache.delete(ids[1]);
      GDRIVE._limpiado = false;
      await gdriveUpload();
      const arriba = D.fotosArriba().join(' ');
      out.limpieza = { borrados: D.log.filter(l => l.m === 'DELETE').length,
        sinLaDel1: arriba.indexOf(ids[0]) < 0, conservaLaDel2: arriba.indexOf(ids[1]) >= 0,
        del2EnLista: (D.json()._fotosAparte || []).includes(ids[1]) };
      D.reset(); await gdriveUpload();
      out.limpiezaUnaVez = D.log.filter(l => l.m === 'DELETE').length === 0;
      photoCache.set(ids[1], original[ids[1]]);

      // 10. Otro teléfono borró una foto: la próxima copia la repone.
      const fid = [...D.files.entries()].find(([k, f]) => f.name.indexOf(ids[2]) >= 0)[0];
      D.files.delete(fid);
      D.reset(); await gdriveUpload();
      out.repuesta = D.subidasFoto() === 1 && D.fotosArriba().join(' ').indexOf(ids[2]) >= 0;

      // 6. Restaurar en un equipo nuevo
      const usadas = new Set(); getH().forEach(e => collectPhotoIds(e.snapshot, usadas));
      photoCache.clear(); setH([]);
      D.reset();
      const d = await gdriveDownload();
      const okAplicar = applyBackupObject(d);
      out.restaurar = { aplico: okAplicar, presupuestos: getH().length,
        todas: [...usadas].every(i => photoCache.get(i) === original[i]),
        faltan: [...usadas].filter(i => photoCache.get(i) !== original[i]) };

      // 7. Una foto que no baja: falla entera, sin aplicar nada.
      photoCache.clear();
      D.fallarFotoGet = true;
      let fallo = false;
      try { await gdriveDownload(); } catch (_) { fallo = true; }
      D.fallarFotoGet = false;
      out.fallaEntera = fallo;

      // 8. Formato viejo (fotos adentro del JSON).
      const viejo = { _type: 'backup_completo', _version: 4, state: JSON.parse(JSON.stringify(S)),
        history: getH(), photos: { [ids[0]]: original[ids[0]] } };
      const fj = [...D.files.entries()].find(([k, f]) => f.name === GDRIVE.FILE)[0];
      D.files.get(fj).data = JSON.stringify(viejo);
      photoCache.clear();
      const dv = await gdriveDownload();
      applyBackupObject(dv);
      out.viejo = photoCache.get(ids[0]) === original[ids[0]];

      // 9. ID manipulado en _fotosAparte
      const malo = "p_x' or name contains '";
      D.files.get(fj).data = JSON.stringify(Object.assign({}, viejo, { photos: {}, _fotosAparte: [malo] }));
      D.reset();
      await gdriveDownload();
      out.inyeccion = !D.log.some(l => l.url.indexOf(encodeURIComponent(malo)) >= 0 || l.url.indexOf(malo) >= 0);

      return out;
    })()`));

    check('Primera copia: cada foto en su propio archivo de Drive',
      r.primera.fotos === 3 && r.primera.subidas === 3 && r.primera.aparte, JSON.stringify(r.primera));
    check('…y el backup va sin esas fotos adentro', r.primera.jsonSinFotosNormales === true);
    check('Una foto que no se puede guardar aparte queda adentro del backup', r.primera.raroAdentro === true);
    check('Un cambio sin fotos nuevas sube solo el backup (ninguna foto)',
      r.segunda.subidasFoto === 0 && r.segunda.patch === 1, JSON.stringify(r.segunda));
    check('…y esa copia pesa poco (menos de 60 KB en total)', r.segunda.bytes < 60000, r.segunda.bytes + ' bytes');
    check('Una foto nueva sube sola', r.tercera.subidasFoto === 1 && r.tercera.fotos === 4, JSON.stringify(r.tercera));
    check('Limpieza: se borra de Drive la foto que ya no usa nadie',
      r.limpieza.borrados === 1 && r.limpieza.sinLaDel1, JSON.stringify(r.limpieza));
    check('…pero NO una que se usa aunque este equipo no la tenga',
      r.limpieza.conservaLaDel2 && r.limpieza.del2EnLista, JSON.stringify(r.limpieza));
    check('La limpieza corre una vez por sesión', r.limpiezaUnaVez === true);
    check('Si otro teléfono borró una foto, la próxima copia la repone', r.repuesta === true);
    check('Restaurar en un equipo nuevo trae todas las fotos, idénticas',
      r.restaurar.aplico && r.restaurar.presupuestos > 0 && r.restaurar.todas, JSON.stringify(r.restaurar));
    check('Si una foto no baja, la restauración falla entera', r.fallaEntera === true);
    check('Una copia del formato viejo (fotos adentro) se sigue restaurando', r.viejo === true);
    check('Un ID de foto manipulado no llega a la consulta de Drive', r.inyeccion === true);
  } finally {
    await browser.close();
  }
  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
