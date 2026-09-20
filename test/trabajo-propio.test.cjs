// test/trabajo-propio.test.cjs — Trabajos sin presupuesto: colaboraciones
// (para un colega) y trabajos directos (para un cliente propio).
//
// Pedido 1: "un día de trabajo como trepador, que es el servicio que presto
// cuando un colega me llama a trabajar con él… esos son trabajos los cuales
// debo facturar y me gustaría apretar un botón y que quede registrado que hice
// ese trabajo en el historial".
// Pedido 2: "no quiero que en el mapa esto cambie las estadísticas sobre mis
// propios trabajos… para que no se confunda de que fueron aceptados más
// trabajos de los que de verdad fueron".
// Pedido 3: "también voy a usar esta misma función para agendar pequeños
// trabajos a clientes que ya existen".
//
// El pedido 3 es el que parte la regla en DOS, y es lo que más se blinda acá:
//
//   · Ninguno de los dos entra en la CONVERSIÓN: nacen 'aceptado' o
//     'realizado' y nunca 'perdido'. Contarlos la subiría sola.
//   · El trabajo directo SÍ es VENTA (total del mes, acumulado del cliente):
//     se lo cobró a un cliente suyo. La colaboración no: la paga un colega.
//
// Lo que se protege:
//
//   1. Alta de un toque: fecha pasada/hoy → realizado; futura → agendado (y
//      visible en la Agenda ese día).
//   2. Numeración propia por tipo ('T-' y 'D-') que NO consume correlativo.
//   3. Las cuentas: qué suma cada tipo y qué no, en el historial y en el mapa.
//   4. El pin: la colaboración arranca oculta, el trabajo directo se ve.
//   5. Los dos llegan a Facturación con el concepto del trabajo.
//   6. No inventan vencimientos ni seguimientos.
//   7. Tarifas y trabajos sobreviven al backup, y un archivo ajeno no puede
//      meter basura en la bandera, el tipo ni la tarifa.
//   8. El cliente ya conocido completa solo su teléfono y su lugar.
//   9. El documento: cada tipo dice lo que es, ninguno inventa vigencia y el
//      presupuesto de verdad sale igual que antes.
//
// Uso:  node test/trabajo-propio.test.cjs

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

// Estado limpio + UN presupuesto real de cliente, aceptado, de $400.000. Es el
// número contra el que se compara todo: si una colaboración se colara en
// alguna cuenta, esa cuenta dejaría de coincidir con este presupuesto solo.
const RESET = `
  setH([]);
  Object.keys(S).forEach(k => delete S[k]);
  Object.assign(S, JSON.parse(JSON.stringify(DEF)));
  S.numPrefix = '2026-'; S.numNext = 1;
  S.dateIssue = today(); calcExpiry(); S.quoteNumber = mkQN();
  S.coName = 'Poda en Altura AR';
  S.clientName = 'Consorcio Rivadavia 2210';
  S.workMapLink = '-31.416,-64.183';
  S.items = [{ id:1, type:'tree', species:'Tipuana', desc:'Extracción', price:'400000', qty:1 }];
  noSync = true; restoreUI(); noSync = false;
  renderItems(); renderEstItems(); applyMode('normal');
  autoSaveToHistory();
  (function(){ const h = getH(); h[0].estado = 'aceptado'; setH(h); })();
  setMisServicios([]);
  saveMiServicio({ nombre:'Día de trabajo como trepador', precio:180000, unidad:'jornada' });

  // Alta por el mismo camino que el usuario: el diálogo, con su segmentado.
  const _alta = (fecha, cant, quien, tipo, nombre, precio) => {
    abrirColaboracion(null, tipo || 'colab');
    document.getElementById('colab-nombre').value = nombre || 'Día de trabajo como trepador';
    document.getElementById('colab-precio').value = String(precio || 180000);
    document.getElementById('colab-cant').value   = String(cant || 1);
    document.getElementById('colab-unidad').value = 'jornada';
    document.getElementById('colab-fecha').value  = fecha;
    document.getElementById('colab-colega').value = quien || 'Martín (colega)';
    document.getElementById('colab-tel').value    = '3543 68-0871';
    document.getElementById('colab-lugar').value  = '-31.417,-64.184';
    colabSync();
    colabGuardar();
  };
  // Atajo del caso nuevo: trabajo chico para un cliente propio.
  const _altaDirecto = (fecha, cant, cliente) =>
    _alta(fecha, cant, cliente || 'Consorcio Rivadavia 2210', 'directo', 'Poda de dos siempre verdes', 80000);
  const _enDias = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return toLocalISODate(d); };

  // Marcas falsas para las stats de zona: mapaUpdateZonaStats solo necesita
  // unos bounds que contengan todo y las entradas de cada marca. Así se prueba
  // la cuenta real sin depender de Leaflet ni de los tiles (que no hay red).
  const _statsDeZona = () => {
    const box = document.getElementById('mapa-zonastats');
    // Solo lo que el filtro deja ver, igual que mapaRefresh: la colaboración
    // depende del interruptor, el trabajo directo se dibuja siempre.
    const entries = getH().filter(e => !esColaboracion(e) || _mapaVerColab);
    const prevMapa = _mapa, prevLayer = _mapaLayer;
    _mapa = { getBounds: () => ({ contains: () => true }) };
    _mapaLayer = { eachLayer: (cb) => entries.forEach(e => cb({
      getLatLng: () => ({ lat: 0, lng: 0 }), _entries: [e],
    })) };
    mapaUpdateZonaStats();
    // Devolver el mapa como estaba: lo demás de la app (colabGuardar llama a
    // mapaRefresh) espera un Leaflet de verdad o nada.
    _mapa = prevMapa; _mapaLayer = prevLayer;
    return box ? box.textContent.replace(/\\s+/g, ' ').trim() : '';
  };
`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {

    // ── 1: alta de un toque, estado según la fecha, numeración propia ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        const proxNum = calcNextNumFromHistory();
        _alta(today(), 2);
        const hecha = getH().find(e => esTrabajoPropio(e));
        const futuro = _enDias(5);
        _alta(futuro, 1);
        const agendada = getH().filter(esTrabajoPropio).find(e => e.id !== hecha.id);
        const idx = calBuildIndex();
        const ev = (idx[futuro] || []).find(x => x.entryId === agendada.id);
        return {
          num: hecha.quoteNumber, num2: agendada.quoteNumber,
          total: hecha.total, totalSnap: totalDeSnapshot(hecha.snapshot),
          estadoHecha: hecha.estado, estadoAgendada: agendada.estado,
          fechaAgendada: agendada.fechaTrabajo, futuro,
          proxNum, proxNumDespues: calcNextNumFromHistory(),
          enAgenda: !!(ev && ev.tipo === 'trabajo'),
          subAgenda: ev && ev.sub,
          colegaEnDB: getClientDB().some(c => (c.name || '').indexOf('Martín') === 0),
          desc: hecha.snapshot.items[0].desc,
        };
      })()`));
      check('La colaboración se registra con numeración propia T-AAAA-0001',
        /^T-\d{4}-0001$/.test(r.num) && /^T-\d{4}-0002$/.test(r.num2), `${r.num} · ${r.num2}`);
      check('Dos jornadas × $180.000 = $360.000, y el snapshot dice lo mismo',
        r.total === 360000 && r.totalSnap === 360000, `${r.total} / ${r.totalSnap}`);
      check('Hecha hoy → queda realizada', r.estadoHecha === 'realizado', r.estadoHecha);
      check('Fecha futura → queda agendada como aceptada',
        r.estadoAgendada === 'aceptado' && r.fechaAgendada === r.futuro,
        `${r.estadoAgendada} · ${r.fechaAgendada}`);
      check('…y aparece ese día en la Agenda, dicha como colaboración',
        r.enAgenda && /Colaboración/.test(r.subAgenda || ''), `"${r.subAgenda}"`);
      check('NO consume número correlativo de presupuestos',
        r.proxNum === r.proxNumDespues, `${r.proxNum} → ${r.proxNumDespues}`);
      check('El detalle guarda la cantidad en palabras',
        /2 jornadas/.test(r.desc), r.desc);
      check('El colega queda en la base para la próxima', r.colegaEnDB);
      await page.close();
    }

    // ── 2: afuera de TODAS las cuentas de presupuestos ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        // Antes: un presupuesto aceptado de $400.000 y nada más.
        switchTab('historial'); renderHistory();
        const contAntes  = document.getElementById('hist-count').textContent;
        const mesAntes   = document.querySelector('.hmonth-total').textContent;
        const zonaAntes  = _statsDeZona();
        // Dos colaboraciones: una hecha y una agendada.
        _alta(today(), 2);
        _alta(_enDias(3), 1);
        renderHistory();
        const contDespues = document.getElementById('hist-count').textContent;
        const mesDespues  = document.querySelector('.hmonth-total').textContent;
        const cantMes     = document.querySelector('.hmonth-count').textContent;
        const zonaDespues = _statsDeZona();
        // Acumulado por cliente: el colega no tiene presupuestos, así que su
        // acumulado tiene que dar cero aunque le hayamos trabajado $540.000.
        document.getElementById('hist-client-filter').value = 'Martín (colega)';
        renderHistory();
        const acumColega = document.querySelector('#history-list div[style*="Total acumulado"], #history-list').textContent
          .replace(/\\s+/g, ' ');
        document.getElementById('hist-client-filter').value = '';
        renderHistory();
        return {
          contAntes, contDespues, mesAntes, mesDespues, cantMes,
          zonaAntes, zonaDespues, acumColega,
          // El renglón propio del mes sí existe.
          lineaColab: (document.querySelector('.hmonth-colab') || {}).textContent || '',
        };
      })()`));
      check('El contador sigue contando presupuestos, no colaboraciones',
        r.contAntes === '1' && r.contDespues === '1', `${r.contAntes} → ${r.contDespues}`);
      check('El total del mes no se mueve', r.mesAntes === r.mesDespues,
        `${r.mesAntes} → ${r.mesDespues}`);
      check('…ni la cantidad del mes', r.cantMes === '1', r.cantMes);
      check('La conversión y el presupuestado de la zona no se mueven',
        r.zonaAntes.replace(/\s+/g,' ') === r.zonaDespues.split('colaboracion')[0].replace(/\s+/g,' ')
          || r.zonaDespues.indexOf('Conversión: 100%') === r.zonaAntes.indexOf('Conversión: 100%'),
        `antes: "${r.zonaAntes}" · después: "${r.zonaDespues}"`);
      check('El presupuestado de la zona sigue siendo el del presupuesto solo',
        /Presupuestado: \$ 400\.000/.test(r.zonaDespues) && !/940\.000/.test(r.zonaDespues),
        r.zonaDespues);
      check('En esta zona sigue diciendo 1 presupuesto',
        /En esta zona: 1 presupuesto/.test(r.zonaDespues), r.zonaDespues);
      check('El acumulado del colega no suma las colaboraciones',
        /Total acumulado \$ 0 /.test(r.acumColega), r.acumColega.slice(0, 120));
      check('…y no las cuenta como presupuestos suyos',
        /Presupuestos 0 /.test(r.acumColega) && /Colaboraciones 2 · \$ 540\.000/.test(r.acumColega),
        r.acumColega.slice(0, 140));
      check('Pero el mes muestra su renglón propio de colaboraciones',
        /2 colaboraciones/.test(r.lineaColab) && /540\.000/.test(r.lineaColab), r.lineaColab);
      await page.close();
    }

    // ── 3: el mapa las esconde por defecto y las cuenta aparte ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        _alta(today(), 1);
        const porDefecto = _mapaVerColab;
        // Con el interruptor apagado no se dibujan (mapaRefresh las saltea).
        const visibles = () => {
          const out = [];
          getH().forEach(e => {
            if (esTrabajoPropio(e)) { if (!_mapaVerColab) return; }
            out.push(e.id);
          });
          return out.length;
        };
        const nApagado = visibles();
        mapaBuildFilters();
        const hayCheck = !!document.querySelector('.mapa-filter-colab');
        _mapaVerColab = true;
        const nPrendido = visibles();
        const zona = _statsDeZona();
        return { porDefecto, nApagado, nPrendido, hayCheck, zona };
      })()`));
      check('El filtro del mapa arranca apagado', r.porDefecto === false);
      check('Con el filtro apagado el pin no se dibuja',
        r.nApagado === 1 && r.nPrendido === 2, `${r.nApagado} → ${r.nPrendido}`);
      check('El interruptor existe en la barra de filtros', r.hayCheck);
      check('Prendido, la zona las cuenta APARTE y lo dice',
        /1 colaboración/.test(r.zona) && /aparte de los números/.test(r.zona)
        && /Presupuestado: \$ 400\.000/.test(r.zona), r.zona);
      await page.close();
    }

    // ── 4: llega a Facturación con el concepto del trabajo ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        _alta(today(), 2);
        const e = getH().find(esTrabajoPropio);
        irARegistrarFactura(e.id);
        const desc   = document.getElementById('fact-desc').value;
        const monto  = document.getElementById('fact-monto').value;
        const cliente= document.getElementById('fact-cliente').value;
        factRegistrar();
        const f = getFacturas()[0];
        const marcada = getH().find(x => x.id === e.id).facturado === true;
        return { desc, monto, cliente, fMonto: f && f.monto, marcada,
                 total: document.getElementById('fact-anual-val').textContent };
      })()`));
      check('El formulario de factura viene con el trabajo, no con "Presupuesto N°"',
        /Día de trabajo como trepador/.test(r.desc) && /2 jornadas/.test(r.desc), r.desc);
      check('…con el monto y el colega cargados',
        String(r.monto) === '360000' && /Martín/.test(r.cliente), `${r.monto} · ${r.cliente}`);
      check('La factura se registra y suma al tope anual',
        r.fMonto === 360000 && /360\.000/.test(r.total), `${r.fMonto} · ${r.total}`);
      check('…y la colaboración queda marcada como facturada', r.marcada);
      await page.close();
    }

    // ── 5: no inventa vencimientos ni seguimientos ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        // El peor caso: el usuario configuró el seguimiento para que dispare
        // en los estados en los que vive una colaboración.
        const cfg = getFollowupCfg();
        cfg.enabled = true; cfg.expiryEnabled = true;
        cfg.estados = ['enviado','aceptado','realizado'];
        setFollowupCfg(cfg);
        _alta(_enDias(-30), 1);   // una colaboración vieja
        const e = getH().find(esTrabajoPropio);
        const idx = calBuildIndex();
        const eventosDeLaColab = Object.keys(idx).reduce((acc, k) => acc.concat(
          idx[k].filter(ev => ev.entryId === e.id).map(ev => ev.tipo)), []);
        return {
          expiry: e.snapshot.dateExpiry,
          vencidos: getExpiredQuotes().some(v => v.entry.id === e.id),
          seguimiento: getPendingFollowups().some(p => p.entry.id === e.id),
          tipos: eventosDeLaColab.join(','),
        };
      })()`));
      check('Una colaboración no tiene fecha de vencimiento', !r.expiry, String(r.expiry));
      check('…no aparece en el banner de vencidos', !r.vencidos);
      check('…ni pide seguimiento comercial', !r.seguimiento);
      check('…y en la Agenda solo es un día de trabajo',
        r.tipos === 'trabajo', r.tipos);
      await page.close();
    }

    // ── 6: TRABAJO DIRECTO — es venta, pero no pasó por el embudo ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        switchTab('historial'); renderHistory();
        const mesAntes  = document.querySelector('.hmonth-total').textContent;
        const zonaAntes = _statsDeZona();
        // Dos trabajos chicos al MISMO cliente que ya tiene el presupuesto.
        _altaDirecto(today(), 1);
        _altaDirecto(_enDias(2), 1);
        renderHistory();
        // El primero de la lista es el último registrado (el agendado): acá
        // interesa el de HOY, que es el que tiene que haber quedado realizado.
        const e = getH().filter(esTrabajoDirecto).find(x => x.fechaTrabajo === today());
        const mesDespues = document.querySelector('.hmonth-total').textContent;
        const cantMes    = document.querySelector('.hmonth-count').textContent;
        const zonaDespues = _statsDeZona();
        // El pin se dibuja SIN prender el filtro de colaboraciones.
        const visibleSinFiltro = !_mapaVerColab && !esColaboracion(e);
        document.getElementById('hist-client-filter').value = 'Consorcio Rivadavia 2210';
        renderHistory();
        const acum = document.getElementById('history-list').textContent.replace(/\\s+/g, ' ');
        document.getElementById('hist-client-filter').value = '';
        renderHistory();
        return {
          num: e.quoteNumber, estado: e.estado, total: e.total,
          mesAntes, mesDespues, cantMes, zonaAntes, zonaDespues, acum,
          visibleSinFiltro,
          badge: (document.querySelector('.hbadge-colab.is-directo') || {}).textContent || '',
          // El tipo queda guardado en la entrada.
          tipo: e.tipoTrabajo,
        };
      })()`));
      check('El trabajo directo lleva numeración propia D-AAAA-0001',
        /^D-\d{4}-0001$/.test(r.num) && r.tipo === 'directo', `${r.num} · ${r.tipo}`);
      check('Hecho hoy queda realizado, con su total',
        r.estado === 'realizado' && r.total === 80000, `${r.estado} · ${r.total}`);
      check('SÍ suma al total del mes (es venta tuya)',
        r.mesAntes === '$ 400.000' && r.mesDespues === '$ 560.000',
        `${r.mesAntes} → ${r.mesDespues}`);
      check('…y a la cantidad del mes', r.cantMes === '3', r.cantMes);
      check('…y al acumulado del cliente',
        /Total acumulado \$ 560\.000/.test(r.acum), r.acum.slice(0, 150));
      check('…marcado aparte como "Sin presupuesto"',
        /Sin presupuesto 2 · \$ 160\.000/.test(r.acum) && /Presupuestos 1 /.test(r.acum),
        r.acum.slice(0, 180));
      check('NO entra en la conversión de la zona',
        /Conversión: 100%/.test(r.zonaAntes) && /Conversión: 100%/.test(r.zonaDespues)
        && /En esta zona: 1 presupuesto/.test(r.zonaDespues), r.zonaDespues);
      check('…ni en el presupuestado de la zona, que lo cuenta aparte',
        /Presupuestado: \$ 400\.000/.test(r.zonaDespues)
        && /2 trabajos directos en esta zona/.test(r.zonaDespues)
        && /no cuentan en la conversión/.test(r.zonaDespues), r.zonaDespues);
      check('El pin se ve sin prender el filtro de colaboraciones', r.visibleSinFiltro);
      check('La tarjeta lo distingue con su propio badge',
        r.badge === 'Trabajo directo', r.badge);
      await page.close();
    }

    // ── 7: el cliente conocido se completa solo ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        // El cliente del presupuesto quedó en la base con su teléfono/lugar.
        saveClientToDB('Consorcio Rivadavia 2210', '3543 11-2233', 'Rivadavia 2210', '-31.416,-64.183');
        abrirColaboracion(null, 'directo');
        document.getElementById('colab-colega').value = 'Consorcio Rivadavia 2210';
        colabAutoCliente();
        const tel   = document.getElementById('colab-tel').value;
        const lugar = document.getElementById('colab-lugar').value;
        // Lo tipeado a mano NO se pisa.
        document.getElementById('colab-tel').value = '9999';
        colabAutoCliente();
        const telManual = document.getElementById('colab-tel').value;
        // Y el segmentado dice de quién es el trabajo.
        const lbl = document.getElementById('colab-colega-lbl').textContent;
        colabSetTipo('colab');
        const lblColab = document.getElementById('colab-colega-lbl').textContent;
        const activo = (document.querySelector('.colab-tseg.is-active') || {}).textContent;
        colabClose();
        // Al EDITAR, el segmentado se esconde: el tipo no se cambia.
        _altaDirecto(today(), 1);
        abrirColaboracion(getH().find(esTrabajoDirecto).id);
        const segOculto = document.getElementById('colab-tipo-seg').hidden;
        colabClose();
        return { tel, lugar, telManual, lbl, lblColab, activo, segOculto };
      })()`));
      check('El cliente conocido completa solo su teléfono y su lugar',
        r.tel === '3543 11-2233' && r.lugar === '-31.416,-64.183', `${r.tel} · ${r.lugar}`);
      check('…y no pisa lo que el usuario escribió a mano', r.telManual === '9999', r.telManual);
      check('La etiqueta cambia con el tipo (Cliente / Colega)',
        r.lbl === 'Cliente' && r.lblColab === 'Colega' && r.activo === 'Colaboración',
        `${r.lbl} → ${r.lblColab} · activo:${r.activo}`);
      check('Al editar, el tipo no se puede cambiar', r.segOculto === true);
      await page.close();
    }

    // ── 8: backup y datos ajenos ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        _alta(today(), 1);
        const backup = buildBackupObject();
        const traeTarifas = Array.isArray(backup.misServicios) && backup.misServicios.length === 1;
        // Restaurar en un dispositivo "vacío".
        setH([]); setMisServicios([]);
        applyBackupObject(JSON.parse(JSON.stringify(backup)));
        const colabRestaurada = getH().filter(esTrabajoPropio).length;
        const tarifasRestauradas = getMisServicios().length;
        const c = getH().find(esTrabajoPropio);
        // Un archivo ajeno no puede meter basura donde se decide si algo
        // cuenta o no, ni en la tarifa que se interpola en el diálogo.
        const sucio = sanitizeHistory([{ id: 1, quoteNumber: 'x',
          esTrabajoPropio: 'sí', colab: { nombre: 'a', precio: -5, cantidad: 'dos', unidad: 'siglo' } }])[0];
        const tarifaSucia = sanitizeMisServicios([
          { id: 'x") onerror="alert(1)', nombre: 'Trepador', precio: -10, unidad: 'mes' },
          { nombre: '', precio: 1 },
        ]);
        return {
          traeTarifas, colabRestaurada, tarifasRestauradas,
          colabMeta: c && c.colab && c.colab.nombre,
          sucioFlag: sucio.esTrabajoPropio, sucioPrecio: sucio.colab.precio,
          sucioCant: sucio.colab.cantidad, sucioUnidad: sucio.colab.unidad,
          tarifaN: tarifaSucia.length, tarifaId: tarifaSucia[0] && tarifaSucia[0].id,
          tarifaPrecio: tarifaSucia[0] && tarifaSucia[0].precio,
          tarifaUnidad: tarifaSucia[0] && tarifaSucia[0].unidad,
        };
      })()`));
      check('Las tarifas propias viajan en el backup', r.traeTarifas);
      check('Colaboraciones y tarifas vuelven tras un restore',
        r.colabRestaurada === 1 && r.tarifasRestauradas === 1 && /trepador/i.test(r.colabMeta || ''),
        `${r.colabRestaurada} colab · ${r.tarifasRestauradas} tarifas`);
      check('La bandera queda booleana y la tarifa saneada',
        r.sucioFlag === true && r.sucioPrecio === 0 && r.sucioCant === 1 && r.sucioUnidad === 'jornada',
        `${r.sucioFlag} · ${r.sucioPrecio} · ${r.sucioCant} · ${r.sucioUnidad}`);
      check('Un id de tarifa manipulado se reemplaza y la unidad cae al default',
        r.tarifaN === 1 && /^[\w-]+$/.test(r.tarifaId || '') && r.tarifaPrecio === 0
        && r.tarifaUnidad === 'jornada',
        `${r.tarifaN} · ${r.tarifaId} · ${r.tarifaUnidad}`);
      await page.close();
    }

    // ── 9: el documento del trabajo ──
    // "que se pueda generar automáticamente una especie de presupuesto como
    // los que generamos cuando hacemos presupuestos reales". Sale por la misma
    // maquinaria (buildDoc), con un override que vive SOLO lo que dura la
    // construcción. Lo que se blinda: que cada tipo diga lo que es, que NINGUNO
    // invente una vigencia (el snapshot va sin dateExpiry: diría "Vence el —")
    // y que el presupuesto de verdad salga igual que antes.
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        const _texto = (e) => {
          const html = _buildDocHTMLForEntry(e);
          if (!html) return 'SIN HTML';
          const el = document.createElement('div');
          el.innerHTML = html;
          return el.innerText.replace(/\\s+/g, ' ').trim();
        };
        const presupuesto = _texto(getH().find(e => !esTrabajoPropio(e)));
        _altaDirecto(today(), 1);
        const directo = _texto(getH().find(esTrabajoDirecto));
        _alta(today(), 2);
        const colab = _texto(getH().find(esColaboracion));
        // El override no puede sobrevivir a la construcción: si queda puesto,
        // el próximo presupuesto de verdad saldría con el título del trabajo.
        const overrideLimpio = _docTrabajo === null;
        const presupuestoDespues = _texto(getH().find(e => !esTrabajoPropio(e)));
        // Y la tarjeta ofrece las dos salidas.
        renderHistory();
        const tarjeta = document.querySelector('.hitem.is-colab');
        const acciones = tarjeta ? tarjeta.querySelector('.hacts').textContent : '';
        return { presupuesto, directo, colab, overrideLimpio,
                 igualDespues: presupuesto === presupuestoDespues, acciones };
      })()`));
      check('El trabajo directo sale como presupuesto para el cliente',
        /Presupuesto N° D-\d{4}-0001/.test(r.directo) && /Cliente/.test(r.directo)
        && /Poda de dos siempre verdes/.test(r.directo),
        r.directo.slice(0, 80));
      check('La colaboración sale como detalle para el colega',
        /Detalle N° T-\d{4}-0001/.test(r.colab) && /Detalle de jornadas trabajadas/.test(r.colab)
        && /Colega/.test(r.colab) && /2 jornadas/.test(r.colab),
        r.colab.slice(0, 90));
      check('Ningún trabajo inventa una vigencia',
        !/VIGENCIA/.test(r.directo) && !/VIGENCIA/.test(r.colab) && !/Vence el/.test(r.colab));
      check('El detalle del colega no lleva el argumentario de venta',
        !/Cómo Trabajamos/.test(r.colab) && !/Plan de Trabajo/.test(r.colab),
        r.colab.slice(0, 60));
      check('El presupuesto de verdad conserva su vigencia y su título',
        /VIGENCIA/.test(r.presupuesto) && /Presupuesto N°/.test(r.presupuesto));
      check('El override no sobrevive a la construcción',
        r.overrideLimpio === true && r.igualDespues === true,
        `limpio:${r.overrideLimpio} · igual:${r.igualDespues}`);
      check('La tarjeta del trabajo ofrece Ver y Compartir',
        /Ver/.test(r.acciones) && /Compartir/.test(r.acciones), r.acciones.trim().slice(0, 70));
      await page.close();
    }

  } finally {
    await browser.close();
  }

  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
