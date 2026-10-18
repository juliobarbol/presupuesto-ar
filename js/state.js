'use strict';

// ═══════════════════════════════════════
// STATE.JS — Estado global, localStorage, helpers básicos
// ═══════════════════════════════════════

// ─── DEFAULTS ────────────────────────────────
const APP_SCHEMA_VERSION = 2;

// Claves de localStorage centralizadas (antes estaban dispersas como
// literales). Las DBs (especies/servicios/clientes/frases/facturas) tienen
// sus propias constantes más abajo, junto a su lógica.
const LS = {
  STATE:          'pq_s',
  STATE_LEGACY:   'pq_state',
  HISTORY:        'pq_h',
  HISTORY_LEGACY: 'pq_history',
  FOLLOWUP:       'pq_followup',
  ONBOARDED:      'pq_onboarded',
  LAST_BACKUP:    'pq_last_backup',
  GDRIVE_ON:      'pq_gdrive_on',
  GDRIVE_LAST:    'pq_gdrive_last',
  GDRIVE_EMAIL:   'pq_gdrive_email',
  GDRIVE_TOK:     'pq_gdrive_tok',
  GCAL_ON:        'pq_gcal_on',
  GCAL_ID:        'pq_gcal_id',
  GCAL_LAST:      'pq_gcal_last',
  GCAL_N:         'pq_gcal_n',      // cuántos eventos dejó la última sync (diagnóstico, no va al backup)
  GCAL_VIS:       'pq_gcal_vis',    // ya se marcó el calendario como visible en la cuenta (una vez por dispositivo)
  GCAL_EMAIL:     'pq_gcal_email',
  GCAL_TOK:       'pq_gcal_tok',
  PDF_THEME:      'pq_pdf_theme',
  PUSH_DEVICE_ID: 'pq_push_device_id',
  PUSH_ESTADO:    'pq_push_estado', // último resultado del registro en el Worker (diagnóstico del dispositivo, no va al backup)
  PUSH_CTA_NO:    'pq_push_cta_no', // "Ahora no" a la invitación de la campanita (preferencia del dispositivo, no va al backup)
  THEME:          'pq_theme',
  DAY_ALERT_SEEN: 'pq_day_alert_seen',
  NOTES:          'pq_agenda_notes',
  CAL_VIEW:       'pq_cal_view',
  CLIMA:          'pq_clima',
  CLIMA_WARN:     'pq_clima_warn',
  NOTIF_LOG:      'pq_notif_log',
  NOTIF_SEEN:     'pq_notif_seen',
  NOTIF_ORDEN:    'pq_notif_orden', // criterio de orden del panel (preferencia del dispositivo, no va al backup)
  VER_PCT:        'pq_ver_pct',     // último % de actualización usado al armar una versión (preferencia del dispositivo, no va al backup)
  HIST_AVISOS:    'pq_hist_avisos', // avisos del Historial desplegados ('1') o plegados (preferencia del dispositivo, no va al backup)
  MAPA_VISTA:     'pq_mapa_vista',  // última vista del mapa {lat,lng,z} (preferencia del dispositivo, no va al backup)
  ESPACIO_AVISO:  'pq_espacio_aviso', // último día en que se avisó que el espacio se llena (del dispositivo, no va al backup)
  ESTILO_OFERTA:  'pq_estilo_oferta', // ya se ofreció armar un estilo propio a quien tenía el de fábrica (del dispositivo, no va al backup)
  ESTILOS:        'pq_estilos',     // "Mis estilos": estilos guardados con nombre (VA al backup; ver sanitizeEstilos)
};

// Notificaciones push (avisos de seguimiento con la app cerrada). Ambos se
// rellenan a mano tras desplegar push-worker/ (ver docs/push-setup.md). Si
// están vacíos, toda la función queda inerte y la sección no aparece en la UI.
const PUSH_WORKER_URL = 'https://presupuesto-push.juliobarribolbo.workers.dev';
const PUSH_VAPID_KEY  = 'BBlrB43TWc5wHAHPhY0kcMwt4g9f1tBejOZ5W5zWc6OU273X9DCvunkB4Cu9zkdXEWom3IRqPi7fxa9Au0vAWiE';

// ─── JUEGOS DE TEXTOS DEL DOCUMENTO (v244) ───────────────────
// Cuatro redacciones completas de los textos que traía la app de fábrica. El
// problema que resuelven: colegas de la misma zona usan la app, le cotizan a
// los mismos clientes, y con los textos de fábrica los PDF salían con los
// mismos párrafos palabra por palabra — para el cliente, la misma empresa o
// una copia. Por eso:
//   - 'directo', 'tecnico' y 'cercano' son los que ofrece la app: DEF arranca
//     con 'directo' y la máquina de estilo (estiloAzar) sortea entre los tres.
//   - 'original' son los textos de fábrica hasta la v243. Se conservan, pero
//     SOLO se usan si alguien los elige a mano (pedido del dueño): la máquina
//     nunca los sortea (TEXTOS_JUEGOS_AZAR).
// Un texto es "de fábrica" si coincide exacto con el de algún juego
// (textoEsDeFabrica): eso es lo único que la máquina se permite reemplazar.
// Lo que el usuario escribió no se toca nunca.
const TEXTOS_CAMPOS = ['docTitle','docTitleEst','docDisclaimer','docDisclaimerSvc',
  'workPlanTitle','workPlan','docCriteriaTitle','docCriteriaIntro','docCriteria','docGreeting'];
const TEXTOS_JUEGOS = {
  directo: { label:'Directo', t:{
    docTitle:         'Presupuesto de Poda y Extracción de Árboles',
    docTitleEst:      'Presupuesto Estimativo de Poda y Extracción',
    docDisclaimer:    'Este valor se calculó a partir de las fotos y videos que nos enviaste. Puede ajustarse cuando veamos el lugar, porque hay detalles que solo se aprecian en persona.',
    docDisclaimerSvc: 'Los servicios de terceros (camión, volquete, chipeadora) están cotizados a valores de hoy. Si la fecha del trabajo se demora, se vuelven a consultar antes de empezar.',
    workPlanTitle:    'Qué incluye el trabajo',
    workPlan:         'Personal con experiencia en trabajo en altura y técnicas de trepa.\nEquipo de seguridad completo: arnés, cuerdas, casco y protección.\nCortes hechos a conciencia, respetando la forma y la sanidad del árbol.\nRetiro de ramas, troncos y restos: el lugar queda limpio.\nCuidado de techos, cercos, cables y plantas cercanas durante el trabajo.',
    docCriteriaTitle: 'Qué tenemos en cuenta para cotizar',
    docCriteriaIntro: 'El precio de cada trabajo depende de las condiciones del lugar y del árbol. Estos son los puntos que evaluamos:',
    docCriteria:      'Acceso | Si se puede trepar, si hace falta hidroelevador y cuánto espacio hay para maniobrar.\nCantidad de material | Cuánta rama y madera sale y cómo se baja sin dañar nada.\nEntorno | Casas, techos, cables o veredas cerca obligan a bajar todo con cuerdas y por partes.\nEl árbol | Su especie, su estado sanitario y si tiene ramas secas o partes debilitadas.',
    docGreeting:      'Quedo a disposición para cualquier consulta.',
  }},
  tecnico: { label:'Técnico', t:{
    docTitle:         'Propuesta de Trabajo de Arboricultura',
    docTitleEst:      'Propuesta Estimativa de Trabajo de Arboricultura',
    docDisclaimer:    'Cotización preliminar elaborada sobre material fotográfico. El importe definitivo se confirmará tras el relevamiento en el lugar, donde se evalúan aspectos no visibles en imágenes.',
    docDisclaimerSvc: 'Los servicios complementarios (transporte, contenedores) se cotizan con valores vigentes a la fecha de emisión y podrán actualizarse si el inicio de los trabajos se posterga.',
    workPlanTitle:    'Alcance del servicio',
    workPlan:         'Ejecución a cargo de operarios especializados en trabajo en altura.\nPoda según buenas prácticas de arboricultura, con cortes limpios en el cuello de la rama.\nDescenso controlado de ramas y troncos mediante sistemas de cuerdas.\nRetiro y disposición de residuos verdes al finalizar la jornada.\nSeñalización y resguardo del área de trabajo.',
    docCriteriaTitle: 'Criterios de evaluación',
    docCriteriaIntro: 'La cotización surge del relevamiento de cada caso. Se consideran los siguientes factores:',
    docCriteria:      'Accesibilidad | Condiciones de ingreso del personal y del equipo al ejemplar.\nVolumen de biomasa | Cantidad de material a extraer, trozar y retirar.\nBlancos y obstáculos | Construcciones, tendidos eléctricos y tránsito en la zona de caída.\nCondición del ejemplar | Especie, vitalidad y defectos estructurales observados.',
    docGreeting:      'Atentamente,',
  }},
  cercano: { label:'Cercano', t:{
    docTitle:         'Presupuesto para tus árboles',
    docTitleEst:      'Presupuesto estimado para tus árboles',
    docDisclaimer:    'Te paso un valor aproximado según las fotos que me mandaste. Cuando vaya a ver los árboles te lo confirmo, porque hay cosas que solo se ven en el lugar.',
    docDisclaimerSvc: 'Lo que cobran otros (camión, volquete) está consultado hoy. Si el trabajo se hace más adelante, lo vuelvo a consultar antes de empezar.',
    workPlanTitle:    'Así lo hacemos',
    workPlan:         'Trabajamos con equipo propio y gente que sabe trepar.\nUsamos arnés, cuerdas y todos los elementos de seguridad.\nCortamos pensando en que el árbol siga sano y lindo.\nNos llevamos todo: ramas, troncos y hojas.\nCuidamos tu casa, tus plantas y lo que haya alrededor.',
    docCriteriaTitle: 'Por qué cada trabajo cuesta distinto',
    docCriteriaIntro: 'No hay dos árboles iguales. Para darte un precio justo miramos:',
    docCriteria:      'Cómo se llega | Si hay lugar para trabajar cómodo o hay que ingeniárselas.\nCuánto hay que bajar | La cantidad de ramas y madera que hay que sacar y llevarse.\nQué hay abajo | Techos, cables, autos o plantas que hay que cuidar.\nQué árbol es | Cada especie y cada estado piden una forma distinta de trabajar.',
    docGreeting:      '¡Gracias por la consulta!',
  }},
  original: { label:'Original', t:{
    docTitle:         'Presupuesto de Servicio de Poda en Altura y Extracción de Árboles',
    docTitleEst:      'Presupuesto Estimativo de Servicio de Poda y Extracción de Árboles',
    docDisclaimer:    'Este presupuesto es estimativo y se basa en las fotos y/o videos enviados. El valor final puede ajustarse luego de una inspección presencial, ya que hay aspectos que solo pueden evaluarse en el lugar.',
    docDisclaimerSvc: 'Los costos de servicios adicionales (camión, volquetes, etc.) son valores consultados con los proveedores al momento de la emisión de este presupuesto. En caso de demorar la confirmación de fecha, dichos valores serán consultados nuevamente antes de iniciar el trabajo.',
    workPlanTitle:    'Plan de Trabajo',
    workPlan:         'Trabajo realizado por personal capacitado en trepa y poda en altura.\nEquipo y herramientas profesionales (cuerdas, arnés, motosierra).\nCortes técnicos que cuidan la salud y la estructura del árbol.\nLimpieza y retiro ordenado de todo el material generado.\nMedidas de seguridad para personas, propiedad e instalaciones.',
    docCriteriaTitle: 'Cómo Trabajamos',
    docCriteriaIntro: 'Cada trabajo es evaluado en función de sus condiciones reales. El costo refleja la complejidad técnica de cada situación:',
    docCriteria:      'Altura y Acceso | Evaluamos las condiciones de ingreso al árbol y la zona de trabajo antes de operar.\nVolumen de Material | Planificamos el retiro ordenado para no comprometer el espacio ni la propiedad.\nRiesgos Presentes | Identificamos proximidad a edificaciones, cercos o instalaciones y aplicamos las medidas de seguridad correspondientes.\nEstado y Especie del Árbol | La especie y condición sanitaria del ejemplar determinan la técnica y el tiempo necesario.',
    docGreeting:      'Saludos,',
  }},
};
const TEXTOS_JUEGOS_AZAR = ['directo','tecnico','cercano'];

const DEF = {
  _schemaVersion: APP_SCHEMA_VERSION,
  quoteNumber:'', dateIssue:'', dateExpiry:'',
  clientName:'', clientContact:'', workAddress:'', workMapLink:'', workDuration:'',
  currency:'ARS', discount:0, surcharge:0, items:[],
  paymentConditions:'', observations:'',
  // Anotación interna del presupuesto: recordatorio privado para quien edita
  // (cómo calcular costos, acceso, materiales, etc.). NUNCA se muestra en el
  // PDF/documento que ve el cliente. Viaja en el snapshot del historial y en
  // el backup como parte de S. A nivel ítem, cada objeto puede llevar su
  // propio `intNote` (ver renderItems).
  intNote:'',
  // ── Disposición de la leña / residuos ──────────────────────────────
  // Dónde se acordó con el cliente dejar la leña, el chipeado y los restos
  // del trabajo. Se acuerda en el lugar, mirando el terreno, y para cuando
  // se ejecuta el trabajo (a veces semanas después, a veces con otro del
  // equipo) nadie se acuerda de cuál era el rincón exacto: por eso además
  // del texto se pueden adjuntar FOTOS del lugar señalado.
  // Es dato del PRESUPUESTO (cambia en cada trabajo) → NO va en
  // CFG_GLOBAL_FIELDS. Las fotos son refs 'p_...' a IndexedDB, igual que
  // las de los ítems (ver js/photos.js).
  dispoNota:'', dispoPhotos:[],
  // ¿Sale en el documento del cliente? Por defecto sí: lo acordado por
  // escrito es lo que evita la discusión de después. Se puede apagar cuando
  // la foto es solo un recordatorio para uno.
  dispoEnDoc:true,
  // ── Versión de un presupuesto anterior ─────────────────────────────
  // Cuando un presupuesto vence y el cliente vuelve, se arma una SEGUNDA
  // VERSIÓN con los precios al día (ver nuevaVersionQuote). Estos campos
  // dejan constancia de a cuál actualiza. Son del PRESUPUESTO, no config
  // global → NO van en CFG_GLOBAL_FIELDS, y se resetean en resetToNewQuote /
  // migrateState (si no, el próximo presupuesto en blanco heredaría la
  // referencia y el PDF diría que actualiza a uno que no tiene nada que ver).
  //   versionN = 0 ó 1 → es un presupuesto original, no una versión.
  versionN:0, versionDeNum:'', versionDeFecha:'',
  // ¿Sale en el PDF la línea "Actualiza el presupuesto N° X del DD/MM"? Por
  // defecto sí: le ahorra al cliente la duda de si son dos trabajos distintos.
  versionEnDoc:true,
  // Scenarios A/B mode — permite presupuestar dos alternativas paralelas
  // sobre el mismo conjunto (ej: extraer todo vs podar todo). Cuando está
  // apagado, todo funciona normal con S.items. Cuando está prendido, B
  // suma como bloque separado y el PDF muestra dos totales (uno por
  // escenario).
  scenariosEnabled: false,
  // Rubro (v241): 'arbolado' (lo de siempre) o 'jardineria' (cercos, terrenos,
  // césped). Dato DEL PRESUPUESTO —dos presupuestos del mismo día pueden ser de
  // rubros distintos—, así que NO va en CFG_GLOBAL_FIELDS y viaja en el
  // snapshot. En jardinería el documento usa docTitleJard/docTitleEstJard y no
  // lleva "Plan de trabajo" ni "Cómo Trabajamos" (pedido del usuario). El modo
  // riesgo lo ignora: el informe ISA es siempre de un árbol.
  rubro: 'arbolado',
  scenarioLabelA: 'Opción A — Extracción',
  scenarioLabelB: 'Opción B — Poda',
  itemsB: [],
  showCriteria:true, showSigOwner:true, showSigClient:false,
  showWorkPlan:true,
  logo:'',
  coName:'',
  coOwner:'',
  coSubtitle:'Poda en Altura y Extracción de Árboles',
  coCuit:'', coWhatsapp:'', coCity:'', coEmail:'',
  // Datos de cobro (Empresa → Mi negocio). Son del NEGOCIO, no del
  // presupuesto: van en CFG_GLOBAL_FIELDS y alimentan la sección "Cómo pagar"
  // del documento y las variables de cobro de las plantillas de WhatsApp. Sin
  // alias NI CBU la sección no se dibuja y todo queda como antes.
  // El CUIT no se repite acá: ya está en coCuit (sale en el encabezado del
  // documento) y las plantillas lo toman de ahí con {cuit}.
  coAliasPago:'', coAliasTitular:'', coCbu:'', coBanco:'',
  coTechNotes:'', coFooter:'',
  showTechNotes:true, showFooter:true,
  accentColor:'#064e3b', pdfTheme:'clasico', pdfCompact:false, pdfFont:'auto', customColors:[],
  // Estilo propio (v244): color de DETALLE (líneas, viñetas, bordes; '' = igual
  // al principal) y monograma con las iniciales del negocio para quien no tiene
  // logo ('ninguno' o una forma de PDF_MONOS). Config del negocio: van en
  // CFG_GLOBAL_FIELDS. Ver estiloAzar.
  accentColor2:'', pdfMono:'ninguno',
  // Estilo propio, Etapa 2 (v245): elementos del documento que se combinan con
  // cualquier tema. 'auto' = lo que trae el diseño elegido (como siempre).
  // Listas blancas PDF_ENCABEZADOS/PDF_TITULOS/PDF_TABLAS/PDF_TOTALES/PDF_PIES.
  // coEslogan es la frase propia que sale en el pie "Con eslogan".
  pdfEncabezado:'auto', pdfTitulos:'auto', pdfTabla:'auto', pdfTotal:'auto', pdfPie:'auto', coEslogan:'',
  // Fondo del documento (v246): 'auto' = liso, como siempre. Ver _fondoURL.
  pdfFondo:'auto',
  // Recuadros translúcidos (v249): dejan ver un poco el fondo. Ver _docTranslucido.
  pdfTransl:false, pushEnabled:false, validityDays:30, showExpiry:true,
  numPrefix:'2026-', numNext:1,
  // Estimative mode
  isEstimative: false,
  estItems: [],
  estObservations: '',
  // Risk mode
  isRisk: false,
  riskData: {
    // Con qué matriz se calcula el nivel (ver RISK_MATRIX_ISA / riskMetodo):
    // 'isa2' = la de la ISA (manual de buenas prácticas, 2ª ed.); 'v1' = la
    // matriz propia anterior a la v243, que inflaba el nivel. Un informe ya
    // entregado conserva la suya: no puede cambiarle el resultado al reabrirlo.
    metodo: 'isa2',
    // Árbol evaluado
    species: '',
    height: '',
    dap: '',
    location: '',
    vitalidad: '',         // 'buena'|'regular'|'pobre'|'muerto'
    // Alcance de la inspección (v243)
    nivel: '',             // '1'|'2'|'3' — niveles de evaluación de la ISA
    tecnicas: [],          // claves de RISK_TECNICAS
    plazo: '12',           // meses que cubre la evaluación (RISK_PLAZOS)
    // Defectos (array de { type, location, desc, altura, orient, photos })
    defects: [],
    // Factores ambientales
    windExposure: '',      // 'bajo'|'moderado'|'alto'
    inclination: '',       // 'ninguna'|'leve'|'moderada'|'severa'
    soilCondition: '',     // 'normal'|'compactado'|'saturado'|'erosionado'
    priorInterventions: '',
    target: '',            // qué hay en la zona de caída (blancos)
    // Evaluación
    failureProbability: '', // 'improbable'|'posible'|'probable'|'inminente'
    impactProbability:  '', // isa2: 'muybaja'|'baja'|'media'|'alta' · v1: 'baja'|'media'|'alta'
    consequences:       '', // 'insignificantes'|'menores'|'significativas'|'severas' (+ 'catastroficas' en v1)
    // Mitigación y riesgo residual (lo que queda después del trabajo propuesto;
    // impacto y consecuencias vacíos = iguales que ahora)
    mitigationGoals: '',
    resFailure: '', resImpact: '', resConsequences: '',
    reinsp: '',            // meses hasta la próxima inspección (RISK_REINSP)
    // Observaciones y limitaciones de ESTA inspección (el descargo general es
    // config del negocio: S.docRiskLimits)
    riskObservations: '',
    limitaciones: '',
  },
  // Textos editables del documento
  docTitle: TEXTOS_JUEGOS.directo.t.docTitle,
  docTitleEst: TEXTOS_JUEGOS.directo.t.docTitleEst,
  docTitleRisk:    'Informe Técnico de Riesgo Arbóreo y Propuesta de Trabajo',
  // Informe de riesgo (v243). Config del negocio: quién evalúa (experiencia,
  // cursos — sin credencial TRAQ el informe NO la nombra) y el descargo
  // general que sale en todos los informes. Las limitaciones puntuales de cada
  // inspección van en riskData.limitaciones.
  coEvaluador:     '',
  docRiskLimits:   'Esta evaluación refleja las condiciones del árbol visibles y accesibles en la fecha de la inspección, con las técnicas indicadas. Es una opinión técnica: no hay forma de garantizar que un árbol, o una parte de él, no vaya a fallar, sobre todo ante tormentas o vientos excepcionales. El nivel de riesgo vale para el plazo indicado; las condiciones pueden cambiar antes por el clima, obras cerca de las raíces, podas o el avance de los defectos. Ante cambios visibles en el árbol corresponde una nueva evaluación.',
  // Títulos de los presupuestos de JARDINERÍA (v241). Config del negocio,
  // como los de arriba; el rubro de cada presupuesto (S.rubro) elige cuál sale.
  docTitleJard:    'Presupuesto de Servicio de Jardinería',
  docTitleEstJard: 'Presupuesto Estimativo de Servicio de Jardinería',
  docEstBanner:    'Presupuesto Estimativo — Basado en fotos y/o videos',
  docDisclaimer: TEXTOS_JUEGOS.directo.t.docDisclaimer,
  docDisclaimerSvc: TEXTOS_JUEGOS.directo.t.docDisclaimerSvc,
  // Formato "Subtítulo | descripción" por línea (el subtítulo es opcional).
  // Alimenta la grilla "Cómo Trabajamos" del presupuesto normal y los factores
  // del estimativo. Ver parseCriteria().
  docCriteria: TEXTOS_JUEGOS.directo.t.docCriteria,
  docGreeting: TEXTOS_JUEGOS.directo.t.docGreeting,
  docCriteriaTitle: TEXTOS_JUEGOS.directo.t.docCriteriaTitle,
  docCriteriaIntro: TEXTOS_JUEGOS.directo.t.docCriteriaIntro,
  // Sección "Plan de Trabajo / Lo que incluye": va antes del precio y encuadra
  // el importe como valor (qué recibe el cliente) en lugar de un gasto. Bullets
  // editables, uno por línea. Sugeridos por defecto, el usuario ajusta/borra.
  workPlanTitle: TEXTOS_JUEGOS.directo.t.workPlanTitle,
  workPlan: TEXTOS_JUEGOS.directo.t.workPlan,
  // Override del plan de trabajo SOLO para el presupuesto actual (no toca el
  // default global de arriba). Se activa con un toggle en el Editor. Útil para
  // detallar cosas exclusivas de ese trabajo. Se resetea en cada presupuesto
  // nuevo y viaja en el snapshot del historial.
  workPlanOverride:     false,
  workPlanCustom:       '',
  workPlanCustomTitle:  '',
  docDiscountLabel:  'Bonificación por trabajos combinados',
  docDiscountNote:   'Al realizar los trabajos en la misma jornada se optimizan los tiempos de montaje y logística, beneficio que trasladamos al cliente.',
  // Orden de las secciones del cuerpo del presupuesto normal (editable desde
  // Empresa → Textos del PDF). El encabezado/cliente quedan arriba y las
  // fotos/firmas/pie quedan al final; solo estas secciones intermedias se
  // reordenan. Ver DOC_SECTIONS / sanitizeSectionOrder / buildDoc.
  docSectionOrder: ['duration','details','total','plan','criteria','observations','payment','validity','notes'],
  // Vista del EDITOR (preferencia del usuario, no dato del presupuesto):
  //   'clasica' → la pantalla de siempre, todo desplegado en una lista.
  //   'fichas'  → secciones plegables con número, estado y barra de progreso.
  //   'consola' → tres etapas (pendiente, Fase 1b: hoy cae a 'clasica').
  // Es configuración: va en CFG_GLOBAL_FIELDS para que abrir un presupuesto
  // viejo del historial no te cambie la vista. Lista blanca: EDITOR_VIEWS
  // (js/sanitize.js). Ver docs/rediseno-editor.md (invariantes I4 e I5).
  vistaEditor: 'clasica',
};

// ─── CONFIGURACIÓN GLOBAL vs. DATOS DEL PRESUPUESTO ──────────
// Estos campos de S son CONFIGURACIÓN DEL NEGOCIO, no datos de un presupuesto
// puntual: quién sos, cómo se ve tu documento y los textos que reusás siempre.
// Viven en S (y por lo tanto viajan dentro de cada snapshot del historial),
// pero NO deben restaurarse al abrir un presupuesto viejo: son "cómo sos hoy",
// no "cómo eras cuando hiciste ese presupuesto".
//
// Sin esto, abrir un presupuesto de hace meses pisaba silenciosamente el nombre
// de la empresa, el subtítulo, el CUIT, los textos del PDF y el color con los
// valores de entonces — y el autoguardado los dejaba asentados. Desde afuera se
// veía como "cada tanto se me resetean solos". Además, imprimir un presupuesto
// viejo salía con los datos viejos, justo cuando se lo estabas por mandar al
// cliente.
//
// Cada vez que se agregue un campo a DEF hay que decidir de qué lado cae. La
// pregunta es: ¿tendría sentido que este valor sea distinto en dos presupuestos
// del mismo día? Si la respuesta es no, va acá.
const CFG_GLOBAL_FIELDS = [
  // Identidad y contacto de la empresa
  'coName','coOwner','coSubtitle','coCuit','coWhatsapp','coCity','coEmail',
  'coAliasPago','coAliasTitular','coCbu','coBanco','coTechNotes','coFooter','logo',
  // Diseño del documento y de la app
  'accentColor','accentColor2','pdfMono','customColors','pdfTheme','pdfCompact','pdfFont','themeMode',
  'pdfEncabezado','pdfTitulos','pdfTabla','pdfTotal','pdfPie','coEslogan','pdfFondo','pdfTransl',
  'vistaEditor',
  // Textos editables del PDF (Empresa → Textos del PDF)
  'docTitle','docTitleEst','docTitleRisk','docEstBanner','docDisclaimer',
  'coEvaluador','docRiskLimits',
  'docTitleJard','docTitleEstJard',
  'docDisclaimerSvc','docCriteria','docGreeting','docCriteriaTitle',
  'docCriteriaIntro','workPlanTitle','workPlan','docDiscountLabel',
  'docDiscountNote','docSectionOrder',
  // Numeración y preferencias del dispositivo
  'numPrefix','numNext','pushEnabled',
];
// OJO: workPlanOverride / workPlanCustom / workPlanCustomTitle NO van acá — son
// el override del plan de trabajo para UN presupuesto puntual (ver DEF).

// Un snapshot del historial guarda el PRESUPUESTO, no la configuración: como
// assignSnapshot nunca la restaura, copiarla en cada entrada era peso muerto
// (~70 % de un snapshot típico: los textos del PDF, el diseño, los datos de
// cobro) contra el tope de ~5 MB de localStorage, y viajaba en cada backup.
// Muta y devuelve el mismo objeto.
function snapshotSinConfig(snap) {
  if (snap && typeof snap === 'object') CFG_GLOBAL_FIELDS.forEach(k => { delete snap[k]; });
  return snap;
}

// Vuelca el snapshot de un presupuesto sobre `target` (normalmente S) SIN pisar
// la configuración global. Es el único lugar donde se decide eso: antes cada
// camino que abría un presupuesto guardado tenía su propia lista de campos a
// preservar —loadFromHistory salvaba 5, impIndividual solo 1, la vista previa
// otros 3— y cada campo nuevo se arreglaba de a uno, cuando alguien lo notaba.
function assignSnapshot(target, snap) {
  const keep = {};
  CFG_GLOBAL_FIELDS.forEach(k => { if (target[k] !== undefined) keep[k] = target[k]; });
  // El orden importa: primero el snapshot, después la config global encima.
  Object.assign(target, snap, keep);
  return target;
}

// Secciones reordenables del cuerpo del presupuesto normal. El orden lo define
// S.docSectionOrder; este array es la lista canónica (ids + etiqueta para la UI)
// y el orden "de fábrica" si falta la preferencia del usuario.
const DOC_SECTIONS = [
  { id:'duration',     label:'Tiempo estimado de trabajo' },
  { id:'details',      label:'Detalles del trabajo (tabla)' },
  { id:'total',        label:'Total del trabajo' },
  { id:'plan',         label:'Plan de trabajo (lo que incluye)' },
  { id:'criteria',     label:'Cómo trabajamos (criterios)' },
  { id:'observations', label:'Observaciones' },
  { id:'payment',      label:'Condiciones de pago' },
  { id:'pago',         label:'Cómo pagar (alias / CBU)' },
  { id:'validity',     label:'Vigencia' },
  { id:'notes',        label:'Notas adicionales' },
];

// Devuelve un orden válido: filtra ids desconocidos/duplicados y agrega las
// secciones que falten JUNTO a su vecino canónico (la sección anterior en
// DOC_SECTIONS), no al final. Así, si se suma una sección nueva (ej. el total
// separado), aparece donde corresponde para quien ya tenía un orden guardado,
// y nunca se pierde una sección aunque el orden venga viejo o corrupto.
function sanitizeSectionOrder(order){
  const ids = DOC_SECTIONS.map(s => s.id);
  const seen = new Set();
  const out = [];
  (Array.isArray(order) ? order : []).forEach(id => {
    if (ids.includes(id) && !seen.has(id)) { out.push(id); seen.add(id); }
  });
  DOC_SECTIONS.forEach((sec, idx) => {
    if (seen.has(sec.id)) return;
    let insertAt = -1;
    // Vecino canónico ANTERIOR ya colocado → insertar justo después.
    for (let k = idx - 1; k >= 0; k--) {
      const p = out.indexOf(DOC_SECTIONS[k].id);
      if (p >= 0) { insertAt = p + 1; break; }
    }
    // Si no hay anterior (ej. una sección nueva que va primera), buscar el
    // SIGUIENTE vecino canónico ya colocado e insertar justo antes; si tampoco
    // hay, recién entonces al final.
    if (insertAt < 0) {
      for (let k = idx + 1; k < DOC_SECTIONS.length; k++) {
        const p = out.indexOf(DOC_SECTIONS[k].id);
        if (p >= 0) { insertAt = p; break; }
      }
    }
    if (insertAt < 0) insertAt = out.length;
    out.splice(insertAt, 0, sec.id);
    seen.add(sec.id);
  });
  return out;
}

// ─── ESTADOS COMERCIALES DEL PRESUPUESTO ─────────────────────
// El estado vive a nivel del entry del historial (no del snapshot),
// porque es metadata comercial que se ve y filtra en la lista sin
// necesidad de cargar el presupuesto. Default: 'borrador'.
//   por_ver   → hay que ir a ver el árbol antes de presupuestar (relevamiento)
//   borrador  → recién creado, sin enviar
//   enviado   → entregado al cliente (se ofrece marcar al generar PDF)
//   aceptado  → el cliente lo aprobó
//   realizado → trabajo hecho (incluye cobrado)
//   evolucion → hay que volver al sitio a controlar la evolución del árbol
//   perdido   → no prosperó
const ESTADOS = ['por_ver', 'borrador', 'enviado', 'aceptado', 'realizado', 'evolucion', 'perdido'];
const ESTADO_LABELS = {
  por_ver:   'Ir a ver',
  borrador:  'Borrador',
  enviado:   'Enviado',
  aceptado:  'Aceptado',
  realizado: 'Realizado',
  evolucion: 'Control en sitio',
  perdido:   'Perdido',
};
const ESTADO_COLORS = {
  // [texto, fondo]
  por_ver:   ['#155e63', '#cffafe'],
  borrador:  ['#475569', '#e2e8f0'],
  enviado:   ['#1e40af', '#dbeafe'],
  aceptado:  ['#92400e', '#fef3c7'],
  realizado: ['#065f46', '#d1fae5'],
  evolucion: ['#6b21a8', '#f3e8ff'],
  perdido:   ['#991b1b', '#fee2e2'],
};
// Estados que implican una visita pendiente al lugar (para "pendientes cerca
// mío" en el mapa): ir a ver el árbol, trabajo aceptado por hacer, o control
// de evolución posterior.
const PENDIENTES_CAMPO = ['por_ver', 'aceptado', 'evolucion'];
function estadoLabel(e) { return ESTADO_LABELS[e] || ESTADO_LABELS.borrador; }

let S = Object.assign({}, DEF);
let saveTimer = null;
let dragSrc = null;
let noSync = false; // supprime syncFromUI durante restoreUI
// Escenario activo en el editor cuando scenariosEnabled está prendido.
// 'A' = se edita S.items / 'B' = se edita S.itemsB. Runtime only, no se
// persiste — siempre arranca en 'A' al cargar la app.
let activeScenario = 'A';

// ─── HELPERS BÁSICOS ─────────────────────────
// Devuelve una fecha como 'YYYY-MM-DD' usando los componentes LOCALES
// (no UTC). Usar toISOString() acá causaba un desfase de ±1 día en
// Argentina (UTC-3): después de las 21 hs la fecha saltaba al día siguiente.
function toLocalISODate(d){ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
function today() { return toLocalISODate(new Date()); }
function sv(id,v){ const e=document.getElementById(id); if(e) e.value=v??''; }
function sc(id,v){ const e=document.getElementById(id); if(e) e.checked=!!v; }
function gv(id){ const e=document.getElementById(id); return e?e.value:''; }
function gc(id){ const e=document.getElementById(id); return e?e.checked:false; }
function esc(s){ if(s==null)return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
// Color semántico por icono (familia → token de color, ver CSS .ic-c-*).
// Mantener en sync con las clases aplicadas al markup estático.
// Solo acentos: lo no listado queda NEUTRO (slate) por defecto vía CSS .ic.
//   verde = positivo (guardar/ok/agregar/WhatsApp) · ámbar = plata/aviso/favorito
//   rojo  = destructivo (borrar/cerrar)
const IC_COLOR = {
  save:'green', check:'green', plus:'green', message:'green', phone:'green',
  money:'amber', fuel:'amber', bell:'amber', bulb:'amber', zap:'amber', star:'amber',
  trash:'red', x:'red'
};
// Icono de línea (Lucide) embebido. Devuelve el SVG que referencia un <symbol>
// del sprite (ver tope del <body>). Reemplaza a los emojis. `name` debe ser un
// id sin el prefijo "i-" (p. ej. icon('trash')). `cls` agrega clases extra
// (p. ej. 'ic-fill' para rellenar). El color semántico se agrega solo. Pensado
// para interpolar en innerHTML.
function icon(name, cls){ const col=IC_COLOR[name]; const c='ic'+(cls?' '+cls:'')+(col?' ic-c-'+col:''); return `<svg class="${c}" aria-hidden="true"><use href="#i-${name}"></use></svg>`; }

// Devuelve el src SOLO si es un dataURL de imagen (data:image/...). Cualquier
// otra cosa —p. ej. un valor manipulado en un backup importado de otro colega—
// se descarta, evitando que un src="..." se rompa e inyecte HTML. Los logos y
// fotos legítimos siempre son data:image/ (FileReader/canvas.toDataURL).
function safeImgSrc(s){ return (typeof s === 'string' && /^data:image\//i.test(s)) ? s : ''; }
// Devuelve un color hex válido (#rgb o #rrggbb) o el verde de marca por
// defecto. El color de marca se interpola en style="color:${color}" dentro
// del HTML del documento; un accentColor manipulado en un import podría
// romper el atributo e inyectar HTML. El color picker siempre da #rrggbb.
function safeColor(c){ return (typeof c === 'string' && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c)) ? c : '#064e3b'; }
function fmtD(iso){ if(!iso)return '—'; const p=String(iso).split('-'); if(p.length!==3||!p[0]||!p[1]||!p[2])return '—'; const[y,m,d]=p; return `${d}/${m}/${y}`; }
function sym(c){ return {ARS:'$',USD:'U$D',EUR:'€'}[c]||c; }
function moneyToCents(v) {
  if (v === '' || v == null) return 0;
  const raw = String(v).trim();
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
function centsToMoney(cents) { return (Number.isFinite(cents) ? cents : 0) / 100; }
function roundMoney(v) { return centsToMoney(moneyToCents(v)); }
// Formato de dinero para la PANTALLA (barra de totales, historial, mapa,
// mensajes de WhatsApp). SIN centavos, igual que el documento del cliente.
//
// El oficio no maneja centavos: los precios son siempre pesos redondos. Con
// montos de cientos de miles, el ",00" no aporta ninguna información y encima
// compite visualmente con los separadores de miles — "$ 840.000,00" hace
// tropezar la lectura justo en el número más importante de la pantalla.
//
// OJO: esto es solo presentación. Internamente se sigue calculando TODO en
// centavos (moneyToCents/centsToMoney/itemTotalCents), que es lo que evita los
// errores de punto flotante. No cambiar eso.
function fmtM(v,c){ return sym(c)+' '+roundMoney(v).toLocaleString('es-AR',{maximumFractionDigits:0}); }
// Formato de dinero para el DOCUMENTO del cliente (PDF/vista previa). Hoy es
// idéntico a fmtM; se mantiene separado porque el criterio de cada uno es
// independiente (lo que ve el cliente vs. lo que ve el podador) y ya se los
// distingue en ~40 llamadas.
// Sin centavos: en Argentina, con inflación alta y montos de cientos de miles,
// un total tipo "$284.999,76" se lee como generado por máquina y resta
// confianza; "$285.000" es la norma. Además, más dígitos inflan la magnitud
// percibida (Coulter, Choi & Monroe 2012).
// El símbolo $ se deja a tamaño normal y claro a propósito: la idea de
// achicarlo/superíndice (estudio de menús Cornell 2009) no está replicada y en
// un presupuesto, donde el cliente necesita entender que es plata, achicarlo
// puede leerse como evasivo.
function fmtMDoc(v,c){ return sym(c)+' '+roundMoney(v).toLocaleString('es-AR',{maximumFractionDigits:0}); }

// ─── LOCAL STORAGE ────────────────────────────
function loadLS() {
  try {
    let raw = localStorage.getItem(LS.STATE) || localStorage.getItem(LS.STATE_LEGACY);
    if (raw) Object.assign(S, migrateState(JSON.parse(raw)));
    if (!Array.isArray(S.itemsB)) S.itemsB = [];
    normalizeRiskData();
  } catch(e){}
}

function migrateState(raw) {
  const next = raw && typeof raw === 'object' ? raw : {};
  if (!next._schemaVersion) next._schemaVersion = 1;
  if (next._schemaVersion < 2) {
    next.items = Array.isArray(next.items) ? next.items : [];
    next.itemsB = Array.isArray(next.itemsB) ? next.itemsB : [];
    next.estItems = Array.isArray(next.estItems) ? next.estItems : [];
  }
  // Migración de "criterios de costeo" al formato editable "Subtítulo |
  // descripción". Antes la grilla "Cómo Trabajamos" del presupuesto normal era
  // texto fijo en el código y este campo (texto plano) se ignoraba ahí. Si el
  // usuario nunca lo tocó (coincide exacto con el viejo default), lo llevamos
  // al nuevo default para que conserve el look con subtítulos. Si lo
  // personalizó, se respeta tal cual (parseCriteria maneja líneas sin "|").
  const OLD_CRITERIA_DEFAULT = 'La altura del árbol y el acceso al sitio.\nEl volumen de material a extraer: ramas, troncos y restos vegetales.\nLa proximidad a estructuras sensibles: edificaciones, tendido eléctrico u otras instalaciones.\nLa especie, el estado fitosanitario y la complejidad estructural del árbol.';
  // Ese usuario tenía los textos de fábrica de entonces: va al juego 'original'
  // (el de su época), no al default actual, que es de otra redacción.
  if (next.docCriteria === OLD_CRITERIA_DEFAULT) next.docCriteria = TEXTOS_JUEGOS.original.t.docCriteria;
  // Campos POR PRESUPUESTO agregados después del lanzamiento: si el snapshot
  // es anterior a que existieran, van al default. Sin esto, Object.assign(S,
  // snapshot) deja el valor del presupuesto abierto antes (p.ej. la ubicación
  // exacta "persistía" y el próximo autoguardado la asentaba en el
  // presupuesto equivocado).
  if (typeof next.workDuration !== 'string') next.workDuration = '';
  if (typeof next.workMapLink  !== 'string') next.workMapLink  = '';
  if (typeof next.workPlanOverride    !== 'boolean') next.workPlanOverride = false;
  if (typeof next.workPlanCustom      !== 'string')  next.workPlanCustom = '';
  if (typeof next.workPlanCustomTitle !== 'string')  next.workPlanCustomTitle = '';
  if (typeof next.scenariosEnabled !== 'boolean') next.scenariosEnabled = false;
  // Rubro: un snapshot anterior a la v241 es de arbolado (no existía otro). Sin
  // esto heredaría el rubro del presupuesto abierto y saldría con otro título.
  if (next.rubro !== 'jardineria') next.rubro = 'arbolado';
  if (typeof next.scenarioLabelA   !== 'string')  next.scenarioLabelA = DEF.scenarioLabelA;
  if (typeof next.scenarioLabelB   !== 'string')  next.scenarioLabelB = DEF.scenarioLabelB;
  // Disposición de la leña/residuos: sin esto, abrir un presupuesto anterior a
  // la función se quedaba con el lugar acordado del presupuesto que estaba
  // abierto — y la foto de otro patio terminaba en su PDF.
  if (typeof next.dispoNota !== 'string')   next.dispoNota = '';
  if (!Array.isArray(next.dispoPhotos))     next.dispoPhotos = [];
  if (typeof next.dispoEnDoc !== 'boolean') next.dispoEnDoc = true;
  // Referencia a la versión anterior: mismo motivo que la disposición. Un
  // snapshot de antes de la función no puede quedarse con la referencia del
  // presupuesto que estaba abierto — su PDF diría que actualiza a otro.
  if (typeof next.versionN       !== 'number')  next.versionN = 0;
  if (typeof next.versionDeNum   !== 'string')  next.versionDeNum = '';
  if (typeof next.versionDeFecha !== 'string')  next.versionDeFecha = '';
  if (typeof next.versionEnDoc   !== 'boolean') next.versionEnDoc = true;
  if (typeof next.isEstimative !== 'boolean') next.isEstimative = false;
  if (typeof next.isRisk       !== 'boolean') next.isRisk = false;
  if (!next.riskData || typeof next.riskData !== 'object') {
    next.riskData = JSON.parse(JSON.stringify(DEF.riskData));
  }
  next._schemaVersion = APP_SCHEMA_VERSION;
  return next;
}

// Asegura que S.riskData tenga TODAS las claves del default, incluso si
// el snapshot cargado viene de una versión antigua o un import externo.
// Se llama en loadLS, loadFromHistory, impIndividual, impBackup — cualquier
// flujo que pueda traer un riskData incompleto.
function normalizeRiskData() {
  if (!S.riskData || typeof S.riskData !== 'object') {
    S.riskData = JSON.parse(JSON.stringify(DEF.riskData));
    return;
  }
  // La matriz se decide ANTES del merge: DEF trae metodo:'isa2' y, mezclado
  // primero, convertiría un informe viejo ya evaluado en uno ISA y le cambiaría
  // el nivel que se le entregó al cliente.
  const metodo = riskMetodo(S.riskData);
  // Merge no destructivo: las claves existentes ganan, las que faltan
  // vienen del default.
  S.riskData = Object.assign({}, DEF.riskData, S.riskData, { metodo });
  if (!Array.isArray(S.riskData.defects)) S.riskData.defects = [];
  if (!Array.isArray(S.riskData.tecnicas)) S.riskData.tecnicas = [];
}

function saveLS() {
  S._schemaVersion = APP_SCHEMA_VERSION;
  // Serializar dentro de un try: si S tuviera una referencia circular,
  // JSON.stringify lanzaría y la excepción cortaría el guardado antes de
  // actualizar el indicador (lo dejaría colgado en "Guardando…"). Mejor
  // fallar acá devolviendo false que romper el flujo.
  let payload;
  try { payload = JSON.stringify(S); }
  catch (e) { console.error('saveLS: no se pudo serializar S', e); return false; }
  return safeSetLS(LS.STATE, payload);
}

// Wrapper seguro para escrituras a localStorage. Atrapa QuotaExceededError
// (común en móviles con poco espacio + historial largo + logos grandes)
// y avisa al usuario con un toast en vez de romper el flujo.
// Devuelve true si la escritura fue exitosa, false si falló.
// `opts.backup === false` → escribe sin disparar la copia a Drive. Es para
// CACHES y estado interno (el pronóstico del clima, por ejemplo): datos que la
// app puede volver a generar sola y que NO son del usuario. Sin esta salida, un
// refresco de clima programaba la subida del backup ENTERO —con todas las fotos
// en base64, 15 a 60 MB con un historial real— sobre datos móviles y en el
// campo, para re-subir exactamente lo mismo que ya estaba.
// Regla: si el usuario lo escribió o lo configuró, va con backup (el default).
function safeSetLS(key, value, opts) {
  try {
    localStorage.setItem(key, value);
    // Cualquier escritura de DATOS dispara (con retardo) la copia a Drive, si
    // está conectada. Centralizado acá para no olvidar ningún caso.
    if (!(opts && opts.backup === false) &&
        typeof scheduleGdriveBackup === 'function') scheduleGdriveBackup();
    return true;
  } catch(e) {
    // Distinguimos "almacenamiento lleno" (QuotaExceededError) de cualquier
    // otro fallo, para no mostrar un mensaje engañoso cuando la causa es otra.
    const isQuota = e && (e.name === 'QuotaExceededError' ||
                          e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
                          e.code === 22 || e.code === 1014);
    // Solo intentamos mostrar toast si la UI ya está montada
    try {
      if (typeof toast === 'function') {
        toast(isQuota
          ? '⚠️ No se pudo guardar: almacenamiento lleno. Exportá un backup y liberá historial.'
          : '⚠️ No se pudieron guardar los cambios. Hacé un backup por las dudas.', 'err', 6000);
      }
    } catch(_) {}
    console.error('safeSetLS falló para key=' + key, e);
    return false;
  }
}

// Estado del autoguardado. _lastSaveAt guarda el timestamp del último
// save exitoso para mostrar "hace X seg/min" actualizándose en vivo.
let _lastSaveAt = null;
let _saveStatusInterval = null;

function sched() {
  const el = document.getElementById('save-status');
  if (el) {
    el.textContent = '● Guardando…';
    el.className = 'save-status saving';
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveLS();
    _lastSaveAt = Date.now();
    _renderSaveStatus();
    // Refrescar el tiempo relativo cada 30s (sin sobrecargar)
    if (!_saveStatusInterval) {
      _saveStatusInterval = setInterval(_renderSaveStatus, 30000);
    }
  }, 700);
  updateTotalsBar();
  // Shell del editor (Fase 1): sched() es el punto por el que pasa cualquier
  // cambio del presupuesto, así que los estados de las fichas se refrescan acá.
  if (typeof editorShellSync === 'function') editorShellSync();
}

// Renderiza el badge de estado de guardado con tiempo relativo.
function _renderSaveStatus() {
  const el = document.getElementById('save-status');
  if (!el) return;
  // Sin nada guardado todavía el cartelito está vacío, pero el estado de la
  // red igual tiene que verse (es lo que explica una app que "no carga").
  if (!_lastSaveAt) {
    const n0 = (typeof netEtiqueta === 'function') ? netEtiqueta() : '';
    el.textContent = n0;
    el.className = 'save-status' + (n0 ? ' net-mala' : '');
    el.onclick = n0 ? (() => { try { netExplicar(); } catch (_) {} }) : null;
    el.style.cursor = n0 ? 'pointer' : '';
    return;
  }
  const secs = Math.round((Date.now() - _lastSaveAt) / 1000);
  let txt;
  if (secs < 5)       txt = '✓ Guardado';
  else if (secs < 60) txt = `✓ Guardado · hace ${secs}s`;
  else if (secs < 3600) {
    const m = Math.round(secs / 60);
    txt = `✓ Guardado · hace ${m} min`;
  } else {
    const h = Math.floor(secs / 3600);
    txt = `✓ Guardado · hace ${h}h`;
  }
  // Estado de la red pegado al guardado: si la conexión está mal, es lo más
  // útil que puede decir ese rincón del topbar (y explica por qué la app dejó
  // de pedir cosas). Tocarlo abre la explicación + "Reintentar".
  const neti = (typeof netEtiqueta === 'function') ? netEtiqueta() : '';
  // Con la red mal se recorta el "hace X min" del guardado: en el topbar de un
  // celular no entran las dos cosas, y el estado de la conexión es lo que
  // explica por qué la app no está trayendo nada.
  el.textContent = neti ? `✓ Guardado · ${neti}` : txt;
  el.className = 'save-status saved' + (neti ? ' net-mala' : '');
  el.onclick = neti ? (() => { try { netExplicar(); } catch (_) {} }) : null;
  el.style.cursor = neti ? 'pointer' : '';
  el.title = neti ? 'Tocá para ver el estado de la conexión' : '';
}

// ─── TOAST ───────────────────────────────────
function toast(msg, type='ok', dur=3000) {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  c.appendChild(el);
  requestAnimationFrame(()=>{ requestAnimationFrame(()=>el.classList.add('show')); });
  setTimeout(()=>{
    el.classList.remove('show');
    setTimeout(()=>el.remove(), 300);
  }, dur);
}

// Toast con botones. `acciones` = [{ label, fn }]: cada botón corre su fn y
// cierra el aviso. El texto va por textContent (nunca innerHTML).
function toastAccion(msg, acciones, dur = 8000, type = 'info') {
  const c = document.getElementById('toast-container');
  if (!c) return null;
  const el = document.createElement('div');
  el.className = `toast toast-${type} toast-action`;
  const sp = document.createElement('span');
  sp.textContent = msg;
  el.appendChild(sp);
  const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); };
  (acciones || []).forEach(a => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-btn';
    b.textContent = a.label;
    b.onclick = () => { close(); try { a.fn(); } catch (e) { console.error(e); } };
    el.appendChild(b);
  });
  c.appendChild(el);
  requestAnimationFrame(() => { requestAnimationFrame(() => el.classList.add('show')); });
  setTimeout(close, dur);
  return el;
}

// ─── COLA DE AVISOS ──────────────────────────
// Los avisos que la app dispara SOLA (no responden a un toque: recontactos y
// backup al abrir, el del clima cuando llega el pronóstico) salen DE A UNO.
// Antes se apilaban dos o tres al abrir la app, tapaban la barra de abajo y
// encima del aviso del día ("Hoy tenés N podas"). `fn` arma el aviso y lo
// devuelve (o nada, si al final no hay qué avisar); el próximo sale cuando ese
// se cierra, y su tiempo corre recién desde que se ve. Lo que responde a un
// toque del usuario (Deshacer, Datos de pago…) NO pasa por acá: sale ya.
const _colaAvisos = [];
let _avisoActivo = null;
function colaAviso(fn) {
  _colaAvisos.push(fn);
  _colaSeguir();
}
function _colaSeguir() {
  if (_avisoActivo && document.body.contains(_avisoActivo)) return;
  _avisoActivo = null;
  if (!_colaAvisos.length) return;
  // Con el aviso del día o la bienvenida abiertos, esperar a que se cierren.
  if (document.querySelector('#day-alert-overlay.open, #moverlay.open')) { setTimeout(_colaSeguir, 800); return; }
  while (_colaAvisos.length && !_avisoActivo) {
    let el = null;
    try { el = _colaAvisos.shift()(); } catch (e) { console.error('colaAviso', e); }
    if (el && el.nodeType === 1 && el.parentNode) _avisoActivo = el;
  }
  if (!_avisoActivo) return;
  const el = _avisoActivo;
  const mo = new MutationObserver(() => {
    if (document.body.contains(el)) return;
    mo.disconnect();
    if (_avisoActivo === el) _avisoActivo = null;
    setTimeout(_colaSeguir, 400);
  });
  mo.observe(el.parentNode, { childList: true });
}

// ─── CONFIRM DIALOG ──────────────────────────
// Estado del diálogo activo (si hay uno abierto). Evita leaks cuando
// confirmDlg se llama varias veces antes de resolverse.
let _confirmActive = null;

function confirmDlg(title, msg, okLabel='Confirmar', okClass='btn-d') {
  return new Promise(resolve => {
    const ov  = document.getElementById('confirm-overlay');
    const ti  = document.getElementById('confirm-title');
    const pm  = document.getElementById('confirm-msg');
    const okB = document.getElementById('confirm-ok');
    const caB = document.getElementById('confirm-cancel');
    if (!ov) { resolve(window.confirm(msg)); return; }

    // Si ya hay un diálogo activo, resolverlo como cancelado primero
    // así no queda colgado el Promise anterior.
    if (_confirmActive) {
      try { _confirmActive(false); } catch(_){}
      _confirmActive = null;
    }

    ti.textContent = title;
    pm.textContent = msg;
    okB.textContent = okLabel;
    okB.className = `btn ${okClass}`;
    ov.classList.add('open');

    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      ov.classList.remove('open');
      // Limpiar listeners para no acumularlos en sucesivas llamadas
      okB.onclick = null;
      caB.onclick = null;
      ov.onclick  = null;
      document.removeEventListener('keydown', onKey);
      _confirmActive = null;
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') finish(false);
      else if (e.key === 'Enter') finish(true);
    };

    okB.onclick = () => finish(true);
    caB.onclick = () => finish(false);
    // Click fuera del modal cierra como cancelar
    ov.onclick  = (e) => { if (e.target === ov) finish(false); };
    document.addEventListener('keydown', onKey);

    _confirmActive = finish;
  });
}

// ─── TOTALS ──────────────────────────────────
// Si se pasa un array, calcula sobre él. Sin argumento, usa el escenario
// activo en el editor (S.items o S.itemsB según corresponda).
function calcTotals(arr) {
  const items = arr || (typeof activeItemsArr === 'function' ? activeItemsArr() : S.items);
  let subCents = 0;
  items.forEach(i => {
    if (i.type === 'tree' || i.type === 'service') {
      subCents += (typeof itemTotalCents === 'function') ? itemTotalCents(i) : moneyToCents(itemTotal(i));
    }
  });
  const discount = Math.min(100, Math.max(0, parseFloat(S.discount) || 0));
  const discCents = Math.round(subCents * discount / 100);
  return {
    subtotal: centsToMoney(subCents),
    discAmt: centsToMoney(discCents),
    total: centsToMoney(subCents - discCents)
  };
}

// Totales del presupuesto ESTIMATIVO. ÚNICA fuente de verdad: la usan la barra
// de totales, el documento/PDF y lo que se asienta en el historial.
//
// Antes cada uno lo calculaba a su manera y no coincidían: el historial sumaba
// `parseFloat(i.price)` de todos los ítems, ignorando la CANTIDAD de los
// servicios. Un estimativo con "Volquete $120.000 × 3" mostraba $710.000 en el
// PDF que recibía el cliente y guardaba $470.000 en el historial — que es el
// número que pre-carga el monto de la factura y suma al tope de monotributo.
//
// Reglas del modo estimativo: los TRABAJOS van a precio plano (no llevan
// cantidad), los SERVICIOS son precio × cantidad, y las notas no suman.
// Todo en centavos, como el resto de la app.
function calcEstTotals(arr) {
  const items = Array.isArray(arr) ? arr : (S.estItems || []);
  let workCents = 0, svcCents = 0;
  items.forEach(i => {
    if (!i) return;
    if (i.type === 'work')         workCents += Math.max(0, moneyToCents(i.price));
    else if (i.type === 'service') svcCents  += itemTotalCents(i);
  });
  return {
    work:  centsToMoney(workCents),   // subtotal de trabajos estimados
    svc:   centsToMoney(svcCents),    // subtotal de servicios / costos fijos
    total: centsToMoney(workCents + svcCents),
  };
}

// Pinta la barra fija de totales (#sticky-totals). Desde la Fase 2 es el ÚNICO
// lugar donde se muestran los totales en el editor: el #totals-bar inline que
// repetía las mismas cifras se sacó.
function updateTotalsBar() {
  const cur = S.currency || 'ARS';

  // Helpers para setear texto / visibilidad si el elemento existe
  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const showRow = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  const cnt = arr => { const n = (arr || []).length; return n + (n === 1 ? ' ítem' : ' ítems'); };

  // Columna de apoyo del modo normal/riesgo. Cada renglón aparece SOLO si
  // aporta algo: sin descuento ni recargo, el subtotal es el total y repetirlo
  // es ruido al lado de una cifra de 28px.
  const sideNormal = (subtotal, discAmt) => {
    const sur = Number(S.surcharge) || 0;
    setTxt('st-sub',  fmtM(subtotal, cur));
    setTxt('st-disc', '− ' + fmtM(discAmt, cur));
    setTxt('st-surcharge', '+' + sur + '%');
    showRow('st-sub-row', discAmt > 0 || sur > 0);
    showRow('st-disc-row', discAmt > 0);
    showRow('st-surcharge-row', sur > 0);
  };

  if (S.isRisk) {
    // Modo riesgo usa los mismos ítems normales
    const {subtotal, discAmt, total} = calcTotals(S.items);
    setTxt('st-total', fmtM(total, cur));
    setTxt('st-count', cnt(S.items));
    sideNormal(subtotal, discAmt);
    _stickyShowVariant('normal');
  } else if (S.isEstimative) {
    const estTotal = calcEstTotals(S.estItems).total;
    setTxt('st-est-val',   fmtM(estTotal, cur));
    setTxt('st-est-count', cnt(S.estItems));
    _stickyShowVariant('est');
  } else if (S.scenariosEnabled) {
    // Modo A/B: los DOS totales en simultáneo, resaltando el que se está
    // editando. Acá no va la columna de apoyo — con dos cifras no entra, y lo
    // que importa es comparar A contra B.
    const totalA = calcTotals(S.items || []).total;
    const totalB = calcTotals(S.itemsB || []).total;
    setTxt('st-a', fmtM(totalA, cur));
    setTxt('st-b', fmtM(totalB, cur));
    const stA = document.getElementById('st-a');
    const stB = document.getElementById('st-b');
    if (stA && stB) {
      stA.style.opacity = (activeScenario === 'A') ? '1' : '.55';
      stB.style.opacity = (activeScenario === 'B') ? '1' : '.55';
    }
    _stickyShowVariant('ab');
  } else {
    const {subtotal, discAmt, total} = calcTotals();
    setTxt('st-total', fmtM(total, cur));
    setTxt('st-count', cnt(activeItemsArr()));
    sideNormal(subtotal, discAmt);
    _stickyShowVariant('normal');
  }
}

// Muestra la variante correcta del sticky (normal | est | ab) y oculta
// las otras. La visibilidad del contenedor entero se controla aparte
// desde switchTab() en ui.js (solo se muestra en el Editor).
function _stickyShowVariant(which) {
  const map = {normal:'st-normal', est:'st-est', ab:'st-ab'};
  Object.entries(map).forEach(([k,id]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = (k === which) ? 'flex' : 'none';
  });
}
