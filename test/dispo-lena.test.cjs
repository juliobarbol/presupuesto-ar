// test/dispo-lena.test.cjs — Lugar de disposición de la leña y los residuos.
//
// Pedido: "además de las fotos de árboles, poder agregar una foto del lugar
// que se acordó con el cliente para disponer la leña o los residuos".
//
// El lugar se pacta en el terreno, señalando con el dedo; el trabajo se hace
// semanas después y a veces con otro del equipo. Por eso son texto + FOTOS, y
// van al PRESUPUESTO (uno por trabajo), no a un ítem: es un solo lugar para
// todo el trabajo.
//
// Lo que se protege acá:
//   1. La foto se guarda como ref 'p_...' en S.dispoPhotos (IndexedDB, igual
//      que las de los ítems) y NO embebida en el estado.
//   2. Sale en el documento de los TRES modos (normal, riesgo, estimativo).
//   3. El toggle "Mostrar en el presupuesto" la deja fuera del documento sin
//      borrar el dato (sigue siendo el recordatorio del podador).
//   4. El texto se escapa: es dato del usuario dentro de innerHTML.
//   5. Entra al backup — sin esto, la foto se pierde al cambiar de dispositivo,
//      que es justo cuando hace falta.
//   6. Es dato del PRESUPUESTO: viaja en el snapshot del historial y abrir un
//      presupuesto viejo (anterior a la función) NO hereda el lugar del que
//      estaba abierto.
//
// Uso:  node test/dispo-lena.test.cjs

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

async function nuevaPagina(browser) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => { allOk = false; console.log('PAGEERROR', e.message); });
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(() => { try { localStorage.clear(); } catch (_) {} });
  return page;
}

// PNG 1x1 transparente: alcanza para seguir la ref de punta a punta.
const PIX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const RESET = `
  setH([]);
  Object.keys(S).forEach(k => delete S[k]);
  Object.assign(S, JSON.parse(JSON.stringify(DEF)));
  S.dateIssue = today(); calcExpiry(); S.quoteNumber = mkQN();
  S.clientName = 'Consorcio Rivadavia 2210';
  S.items = [{ id:1, type:'tree', species:'Tipuana', price:'245000', qty:1 }];
  noSync = true; restoreUI(); noSync = false;
  renderItems(); renderEstItems(); applyMode('normal');
`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {

    // ── 1: la foto va a IndexedDB, el estado solo guarda la ref ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (async () => {
        ${RESET}
        const ref = await savePhoto('${PIX}');
        S.dispoPhotos.push(ref);
        S.dispoNota = 'Leña apilada contra el alambrado del fondo';
        renderDispo();
        const gal = document.getElementById('dispo-gallery');
        return {
          ref,
          esId: photoIsId(ref),
          // Nada de dataURL adentro del estado que se guarda en localStorage
          estadoPesado: JSON.stringify(S.dispoPhotos).indexOf('data:image') >= 0,
          miniaturas: gal.querySelectorAll('.item-photo-preview img').length,
          botón: document.getElementById('dispo-photo-btn').textContent.trim(),
          seRecupera: getPhotoData(ref) === '${PIX}',
        };
      })()`));
      check('La foto del lugar se guarda como ref p_… (el binario va a IndexedDB)',
        r.esId && !r.estadoPesado, r.ref);
      check('…y se recupera desde el caché de fotos', r.seRecupera);
      check('La galería del editor muestra la miniatura', r.miniaturas === 1);
      check('El botón lleva la cuenta de fotos', /Fotos del lugar ✓ \(1\)/.test(r.botón), r.botón);
      await page.close();
    }

    // ── 2: quitar una foto la saca del estado ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (async () => {
        ${RESET}
        S.dispoPhotos = [await savePhoto('${PIX}'), await savePhoto('${PIX}')];
        renderDispo();
        const antes = S.dispoPhotos.length;
        document.querySelector('#dispo-gallery .item-photo-remove').click();
        return { antes, después: S.dispoPhotos.length,
                 miniaturas: document.querySelectorAll('#dispo-gallery .item-photo-preview').length };
      })()`));
      check('El ✕ de la miniatura quita esa foto',
        r.antes === 2 && r.después === 1 && r.miniaturas === 1,
        r.antes + ' → ' + r.después);
      await page.close();
    }

    // ── 3: sale en el documento de los tres modos ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (async () => {
        ${RESET}
        S.dispoNota = 'Leña apilada contra el alambrado del fondo';
        S.dispoPhotos = [await savePhoto('${PIX}')];
        S.estItems = [{ id:9, type:'work', desc:'Poda estimada', price:'180000' }];
        const doc = document.getElementById('doc-a4');
        const leer = () => ({
          bloque: /class="pdispo"/.test(doc.innerHTML),
          texto:  doc.innerHTML.indexOf('alambrado del fondo') >= 0,
          foto:   (doc.innerHTML.match(/class="pdispo-photo"/g) || []).length,
        });
        setMode('normal');     buildDoc(); const normal = leer();
        setMode('riesgo');     buildDoc(); const riesgo = leer();
        setMode('estimativo'); buildDoc(); const est    = leer();
        setMode('normal');
        // Sin datos no se dibuja nada (como duración o notas)
        S.dispoNota = ''; S.dispoPhotos = [];
        buildDoc(); const vacío = leer();
        return { normal, riesgo, est, vacío };
      })()`));
      check('El bloque sale en el presupuesto normal',
        r.normal.bloque && r.normal.texto && r.normal.foto === 1, JSON.stringify(r.normal));
      check('…en el informe de riesgo',
        r.riesgo.bloque && r.riesgo.texto && r.riesgo.foto === 1, JSON.stringify(r.riesgo));
      check('…y en el presupuesto estimativo',
        r.est.bloque && r.est.texto && r.est.foto === 1, JSON.stringify(r.est));
      check('Sin lugar acordado no se dibuja ninguna sección', !r.vacío.bloque);
      await page.close();
    }

    // ── 4: el toggle lo saca del documento SIN borrar el dato ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (async () => {
        ${RESET}
        S.dispoNota = 'Contra el alambrado del fondo';
        S.dispoPhotos = [await savePhoto('${PIX}')];
        S.dispoEnDoc = false;
        noSync = true; restoreUI(); noSync = false;
        buildDoc();
        const doc = document.getElementById('doc-a4').innerHTML;
        // El toggle de la UI refleja el estado y lo puede volver a prender
        const tgl = document.getElementById('dispo-en-doc');
        const apagado = tgl.checked;
        tgl.checked = true; tgl.dispatchEvent(new Event('change', { bubbles:true }));
        buildDoc();
        return {
          apagado, enDoc: S.dispoEnDoc,
          ocultoEnDoc: doc.indexOf('pdispo') < 0,
          datoIntacto: S.dispoNota === 'Contra el alambrado del fondo' && S.dispoPhotos.length === 1,
          vuelveAlDoc: document.getElementById('doc-a4').innerHTML.indexOf('pdispo') >= 0,
        };
      })()`));
      check('Apagado, el lugar no sale en el documento…',
        r.apagado === false && r.ocultoEnDoc);
      check('…pero el texto y la foto siguen guardados', r.datoIntacto);
      check('Volver a prenderlo lo devuelve al documento', r.enDoc && r.vuelveAlDoc);
      await page.close();
    }

    // ── 5: XSS — el texto es dato del usuario ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (async () => {
        ${RESET}
        S.dispoNota = '<img src=x onerror="window.__pwn=1">';
        buildDoc();
        const doc = document.getElementById('doc-a4');
        return { escapado: doc.innerHTML.indexOf('&lt;img') >= 0,
                 // Lo importante: quedó como TEXTO, no como un <img> que se ejecuta
                 nodoInyectado: !!doc.querySelector('.pdispo img[src="x"]'),
                 pwn: !!window.__pwn };
      })()`));
      check('El texto del lugar se escapa antes de entrar al documento',
        r.escapado && !r.nodoInyectado && !r.pwn);
      await page.close();
    }

    // ── 6: backup y sanitización de lo que viene de afuera ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (async () => {
        ${RESET}
        const ref = await savePhoto('${PIX}');
        S.dispoPhotos = [ref];
        S.dispoNota = 'Volquete en la vereda';
        saveLS();
        const b = buildBackupObject();
        // Un backup ajeno con basura en las refs no puede envenenar el estado
        const sucio = sanitizeStateObj({ dispoNota: 'ok',
          dispoPhotos: [ref, 'p_"><script>', 'javascript:alert(1)', 42, '${PIX}'] });
        return {
          refEnBackup: !!(b.photos && b.photos[ref]),
          notaEnBackup: b.state.dispoNota === 'Volquete en la vereda',
          limpio: sucio.dispoPhotos,
          porDefectoEnDoc: sanitizeStateObj({}).dispoEnDoc === true,
        };
      })()`));
      check('La foto del lugar viaja dentro del backup',
        r.refEnBackup && r.notaEnBackup);
      check('Las refs basura de un backup ajeno se descartan',
        r.limpio.length === 2 && r.limpio[1].indexOf('data:image/') === 0,
        JSON.stringify(r.limpio.map(x => x.slice(0, 22))));
      check('Un estado sin el campo asume "sí, mostrarlo"', r.porDefectoEnDoc);
      await page.close();
    }

    // ── 7: es dato del presupuesto, no configuración del negocio ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (async () => {
        ${RESET}
        const global = ['dispoNota','dispoPhotos','dispoEnDoc']
          .filter(k => CFG_GLOBAL_FIELDS.indexOf(k) >= 0);
        // Presupuesto A: con lugar acordado, guardado en el historial
        S.dispoNota = 'Fondo, al lado del galpón';
        S.dispoPhotos = [await savePhoto('${PIX}')];
        noSync = true; restoreUI(); noSync = false;
        autoSaveToHistory();
        const idA = getH()[0].id;
        // Presupuesto B: uno nuevo arranca en blanco
        resetToNewQuote();
        const enNuevo = { nota: S.dispoNota, fotos: S.dispoPhotos.length, enDoc: S.dispoEnDoc };
        // Un presupuesto viejo (anterior a la función) no hereda el de al lado
        S.dispoNota = 'De este otro trabajo';
        const h = getH();
        const viejo = JSON.parse(JSON.stringify(h[0]));
        viejo.id = 999; delete viejo.snapshot.dispoNota; delete viejo.snapshot.dispoPhotos;
        setH([viejo].concat(h));
        loadFromHistory(999);
        const heredó = { nota: S.dispoNota, fotos: S.dispoPhotos.length };
        // Y el que sí lo tenía lo recupera tal cual
        loadFromHistory(idA);
        const vuelve = { nota: S.dispoNota, fotos: S.dispoPhotos.length,
                         enUI: document.getElementById('dispo-nota').value,
                         miniaturas: document.querySelectorAll('#dispo-gallery .item-photo-preview').length };
        return { global, enNuevo, heredó, vuelve };
      })()`));
      check('No es configuración global (cambia en cada presupuesto)',
        r.global.length === 0, r.global.join());
      check('Un presupuesto nuevo arranca sin lugar acordado',
        r.enNuevo.nota === '' && r.enNuevo.fotos === 0 && r.enNuevo.enDoc === true,
        JSON.stringify(r.enNuevo));
      check('Abrir un presupuesto anterior a la función no hereda el lugar de otro',
        r.heredó.nota === '' && r.heredó.fotos === 0, JSON.stringify(r.heredó));
      check('Abrir el presupuesto que lo tenía lo recupera (estado y pantalla)',
        r.vuelve.nota === 'Fondo, al lado del galpón' && r.vuelve.fotos === 1 &&
        r.vuelve.enUI === 'Fondo, al lado del galpón' && r.vuelve.miniaturas === 1,
        JSON.stringify(r.vuelve));
      await page.close();
    }

    // ── 8: el orden de secciones del PDF conoce la nueva ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (async () => {
        ${RESET}
        // Un usuario con el orden viejo guardado no pierde la sección nueva:
        // sanitizeSectionOrder la ubica junto a su vecina canónica.
        const viejo = ['duration','details','total','plan','criteria','observations','payment','validity','notes'];
        const arreglado = sanitizeSectionOrder(viejo);
        return {
          enCanónica: DOC_SECTIONS.some(s => s.id === 'dispo'),
          arreglado,
          posición: arreglado.indexOf('dispo'),
          trasObs: arreglado[arreglado.indexOf('observations') + 1] === 'dispo',
        };
      })()`));
      check('La sección está en la lista canónica del documento', r.enCanónica);
      check('Un orden guardado de antes la recupera junto a Observaciones',
        r.posición >= 0 && r.trasObs, r.arreglado.join(' '));
      await page.close();
    }

  } finally {
    await browser.close();
  }

  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
