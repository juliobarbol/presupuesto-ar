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

    // ── 8: va DEBAJO de las fotos de los árboles ──
    // "Es información menos importante la mayoría de las veces": la foto del
    // rincón donde va la leña no puede empujar hacia abajo el registro
    // fotográfico de los árboles, que es lo que el cliente mira.
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (async () => {
        ${RESET}
        S.dispoNota = 'Contra el alambrado del fondo';
        S.dispoPhotos = [await savePhoto('${PIX}')];
        S.items = [{ id:1, type:'tree', species:'Olmo', price:'245000', qty:1,
                     photos:[await savePhoto('${PIX}')] }];
        S.estItems = [{ id:9, type:'work', desc:'Poda estimada', price:'180000',
                        photos:[await savePhoto('${PIX}')] }];
        const doc = document.getElementById('doc-a4');
        // Posición de cada bloque dentro del documento ya armado
        const pos = () => {
          const h = doc.innerHTML;
          return { registro: h.indexOf('Registro Fotográfico'),
                   dispo: h.indexOf('class="pdispo"'),
                   // El estimativo no lleva firmas: ahí el cierre es el saludo.
                   cierre: Math.max(h.indexOf('class="psigs"'), h.indexOf('pest-greeting')) };
        };
        setMode('normal');     buildDoc(); const normal = pos();
        setMode('riesgo');     buildDoc(); const riesgo = pos();
        setMode('estimativo'); buildDoc(); const est    = pos();
        setMode('normal');
        return { normal, riesgo, est,
                 // Y ya no está entre las secciones reordenables del cuerpo:
                 // todas ésas caen ARRIBA del registro fotográfico.
                 fueraDelOrden: !DOC_SECTIONS.some(s => s.id === 'dispo'),
                 ordenLimpio: sanitizeSectionOrder(['duration','dispo','details']).indexOf('dispo') };
      })()`));
      const abajo = m => m.registro >= 0 && m.dispo > m.registro && m.dispo < m.cierre;
      check('Normal: la disposición queda DEBAJO del registro fotográfico',
        abajo(r.normal), JSON.stringify(r.normal));
      check('…lo mismo en el informe de riesgo', abajo(r.riesgo), JSON.stringify(r.riesgo));
      check('…y en el estimativo', abajo(r.est), JSON.stringify(r.est));
      check('…y arriba de las firmas, no después', r.normal.dispo < r.normal.cierre);
      check('No entra en las secciones reordenables del cuerpo',
        r.fueraDelOrden && r.ordenLimpio === -1);
      await page.close();
    }

    // ── 9: la foto tiene que LEERSE (no una estampilla) ──
    // Reporte: "la foto de la disposición quedó diminuta". Era un max-width en
    // % dentro de un flex: el porcentaje se resolvía contra el ítem estirado y
    // daba ~38% del tamaño de las de los árboles. Es una foto de un LUGAR: si
    // no se ve, no sirve para nada. Debe ser algo menor que las del registro
    // (es secundaria) pero del mismo orden de magnitud.
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (async () => {
        ${RESET}
        // Foto apaisada 4:3, que es lo que deja compressImage(…, 1000, 0.7)
        const mk = (w, h) => { const c = document.createElement('canvas');
          c.width = w; c.height = h; const x = c.getContext('2d');
          x.fillStyle = '#6b8e5a'; x.fillRect(0, 0, w, h);
          return c.toDataURL('image/jpeg', 0.7); };
        const horiz = await savePhoto(mk(1000, 750));
        const vert  = await savePhoto(mk(750, 1000));
        S.items = [{ id:1, type:'tree', species:'Olmo', price:'1219000', qty:1, photos:[horiz] }];
        S.dispoNota = 'Lugar donde se acomodarán las ramas y troncos';
        S.dispoPhotos = [horiz];
        buildDoc();
        // Se mide en el host de la vista previa: #doc-a4 vive oculto
        const host = document.getElementById('doc-preview-content');
        host.innerHTML = document.getElementById('doc-a4').innerHTML;
        const ov = document.getElementById('doc-preview-overlay');
        ov.classList.add('open'); ov.style.display = 'block';
        document.getElementById('doc-preview-paper').style.transform = 'none';
        await new Promise(r => setTimeout(r, 400));
        const caja = sel => { const b = host.querySelector(sel).getBoundingClientRect();
                              return { w: Math.round(b.width), h: Math.round(b.height) }; };
        const árbol = caja('.pphoto img');
        const dispo = caja('.pdispo-photo img');
        // Y una vertical no puede desbordar ni deformarse
        S.dispoPhotos = [vert]; buildDoc();
        host.innerHTML = document.getElementById('doc-a4').innerHTML;
        await new Promise(r => setTimeout(r, 200));
        const vertical = caja('.pdispo-photo img');
        return { árbol, dispo, vertical, página: Math.round(host.getBoundingClientRect().width),
                 // La proporción original (4:3 / 3:4) tiene que sobrevivir:
                 // html2canvas ignora object-fit y dibuja la caja tal cual.
                 ratio: +(dispo.w / dispo.h).toFixed(2),
                 ratioVert: +(vertical.w / vertical.h).toFixed(2) };
      })()`));
      check('La foto del lugar se lee (no baja del 70% del ancho de las de los árboles)',
        r.dispo.w >= r.árbol.w * 0.7,
        'dispo ' + r.dispo.w + 'px vs árbol ' + r.árbol.w + 'px');
      check('…pero sigue siendo secundaria (no más grande que las de los árboles)',
        r.dispo.w <= r.árbol.w && r.dispo.h < r.árbol.h,
        r.dispo.w + 'x' + r.dispo.h + ' vs ' + r.árbol.w + 'x' + r.árbol.h);
      check('Conserva la proporción original (apaisada y vertical)',
        r.ratio === 1.33 && r.ratioVert === 0.75, r.ratio + ' / ' + r.ratioVert);
      check('Y no desborda el ancho de la hoja', r.dispo.w < r.página);
      await page.close();
    }

  } finally {
    await browser.close();
  }

  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
