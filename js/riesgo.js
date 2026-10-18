'use strict';

// ─── CÁLCULO DEL NIVEL DE RIESGO ─────────────────────────────────────────────
// Dos pasos, como la ISA: (1) probabilidad de falla × probabilidad de impacto
// → probabilidad combinada; (2) probabilidad combinada × consecuencias → nivel.
//
// MATRIZ ISA (riskData.metodo 'isa2', v243): matrices 1 y 2 del manual de buenas
// prácticas de la ISA "Tree Risk Assessment", 2ª ed. El paso 1 funciona como una
// multiplicación: para que haya daño la parte tiene que fallar Y tiene que haber
// alguien o algo abajo, así que si una de las dos es poco probable el resultado
// es improbable. Una falla improbable da SIEMPRE riesgo bajo.
//
// MATRIZ v1 (informes anteriores a la v243): era propia, con 3 niveles de
// impacto y "catastróficas", y daba más riesgo que la ISA en 26 de las 48
// combinaciones comparables (nunca menos). Se conserva SOLO para que un informe
// ya entregado no cambie de nivel al reabrirlo; el editor ofrece pasarlo a la
// ISA (riskPasarAIsa). Ver test/riesgo-isa.test.cjs.
const RISK_MATRIX_ISA = {
  combinada: {
    improbable: { muybaja:'improbable', baja:'improbable', media:'improbable', alta:'improbable' },
    posible:    { muybaja:'improbable', baja:'improbable', media:'improbable', alta:'algo'       },
    probable:   { muybaja:'improbable', baja:'improbable', media:'algo',       alta:'probable'   },
    inminente:  { muybaja:'improbable', baja:'algo',       media:'probable',   alta:'muy'        },
  },
  riesgo: {
    improbable: { insignificantes:'bajo', menores:'bajo',     significativas:'bajo',     severas:'bajo'     },
    algo:       { insignificantes:'bajo', menores:'bajo',     significativas:'moderado', severas:'moderado' },
    probable:   { insignificantes:'bajo', menores:'moderado', significativas:'alto',     severas:'alto'     },
    muy:        { insignificantes:'bajo', menores:'moderado', significativas:'alto',     severas:'extremo'  },
  },
};
const RISK_MATRIX = {
  // v1 — [failureProbability][impactProbability] → damageProbability
  damageProbability: {
    improbable: { baja:'baja', media:'baja',   alta:'media'  },
    posible:    { baja:'baja', media:'media',  alta:'media'  },
    probable:   { baja:'media',media:'media',  alta:'alta'   },
    inminente:  { baja:'media',media:'alta',   alta:'alta'   },
  },
  // v1 — [damageProbability][consequences] → riskLevel
  riskLevel: {
    baja:  { insignificantes:'bajo',  menores:'bajo',     significativas:'bajo',     severas:'moderado',  catastroficas:'alto'   },
    media: { insignificantes:'bajo',  menores:'moderado', significativas:'moderado', severas:'alto',      catastroficas:'alto'   },
    alta:  { insignificantes:'moderado',menores:'alto',   significativas:'alto',     severas:'extremo',   catastroficas:'extremo'},
  }
};

// Qué matriz usa un riskData. Sin `metodo` (informe anterior a la v243): si ya
// tenía la evaluación cargada es 'v1' (se calculó y se entregó con esa); si no,
// todavía no se evaluó nada y arranca con la ISA.
function riskMetodo(rd) {
  if (!rd || typeof rd !== 'object') return 'isa2';
  if (rd.metodo === 'isa2' || rd.metodo === 'v1') return rd.metodo;
  return (rd.failureProbability || rd.impactProbability || rd.consequences) ? 'v1' : 'isa2';
}

// Probabilidad combinada de la ISA (paso 1), o null si falta un dato.
function riskCombinada(fp, ip) {
  return (RISK_MATRIX_ISA.combinada[fp] || {})[ip] || null;
}

function calcRiskLevel(fp, ip, cons, metodo) {
  if (!fp || !ip || !cons) return null;
  if (metodo === 'v1') {
    const dp = RISK_MATRIX.damageProbability[fp]?.[ip];
    if (!dp) return null;
    return RISK_MATRIX.riskLevel[dp]?.[cons] || null;
  }
  const comb = riskCombinada(fp, ip);
  return comb ? ((RISK_MATRIX_ISA.riesgo[comb] || {})[cons] || null) : null;
}

// Todo lo que se deriva de la evaluación, en un solo lugar (editor, estado de
// la ficha y documento leen de acá). El residual es el riesgo que queda después
// del trabajo propuesto: falla obligatoria; impacto y consecuencias vacíos =
// iguales que ahora (podar baja la falla; mover el blanco baja el impacto).
function riskEval(rd) {
  rd = rd || {};
  const metodo = riskMetodo(rd);
  const nivel = calcRiskLevel(rd.failureProbability, rd.impactProbability, rd.consequences, metodo);
  const out = { metodo, nivel, combinada: null, residual: null, resCombinada: null };
  if (metodo !== 'isa2') return out;
  out.combinada = riskCombinada(rd.failureProbability, rd.impactProbability);
  if (rd.resFailure) {
    const ip = rd.resImpact || rd.impactProbability;
    const co = rd.resConsequences || rd.consequences;
    out.residual = calcRiskLevel(rd.resFailure, ip, co, 'isa2');
    out.resCombinada = riskCombinada(rd.resFailure, ip);
  }
  return out;
}

// Labels para el documento (sirven a las dos matrices: las claves nuevas
// —muybaja, combinada— no chocan con las viejas).
const RISK_LABELS = {
  failureProbability: { improbable:'Improbable', posible:'Posible', probable:'Probable', inminente:'Inminente' },
  impactProbability:  { muybaja:'Muy baja', baja:'Baja', media:'Media', alta:'Alta' },
  consequences:       { insignificantes:'Insignificantes', menores:'Menores', significativas:'Significativas', severas:'Severas', catastroficas:'Catastróficas' },
  combinada:          { improbable:'Improbable', algo:'Algo probable', probable:'Probable', muy:'Muy probable' },
  windExposure:       { bajo:'Bajo', moderado:'Moderado', alto:'Alto' },
  inclination:        { ninguna:'Ninguna', leve:'Leve', moderada:'Moderada', severa:'Severa' },
  soilCondition:      { normal:'Normal', compactado:'Compactado', saturado:'Saturado/Anegado', erosionado:'Erosionado' },
  vitalidad:          { buena:'Buena', regular:'Regular', pobre:'Pobre', muerto:'Árbol muerto' },
  nivel:              { '1':'Nivel 1 — Limitada', '2':'Nivel 2 — Básica', '3':'Nivel 3 — Avanzada' },
  riskLevel:          { bajo:'BAJO', moderado:'MODERADO', alto:'ALTO', extremo:'EXTREMO' },
};

const RISK_COLORS = { bajo:'#16a34a', moderado:'#d97706', alto:'#dc2626', extremo:'#7c3aed' };

// Opciones de los desplegables de la evaluación, según la matriz. Las de la ISA
// llevan su definición (la falla se juzga dentro del plazo y con el clima
// habitual; el impacto, por cuánto se ocupa la zona de caída). Las v1 son las
// de antes, tal cual, para poder reabrir un informe viejo sin cambiarle nada.
const RISK_OPTS = {
  isa2: {
    failureProbability: [
      ['improbable', 'Improbable — No se espera que falle con el clima habitual, ni siquiera con muchas tormentas'],
      ['posible',    'Posible — Podría fallar, pero es poco probable con el clima habitual'],
      ['probable',   'Probable — Se espera que falle con el clima habitual dentro del plazo'],
      ['inminente',  'Inminente — La falla ya empezó o es muy probable en lo inmediato'],
    ],
    impactProbability: [
      ['muybaja', 'Muy baja — Zona casi nunca ocupada, o blanco protegido'],
      ['baja',    'Baja — Ocupación ocasional'],
      ['media',   'Media — Ocupación frecuente'],
      ['alta',    'Alta — Ocupación constante (vivienda, paso continuo, auto estacionado)'],
    ],
    consequences: [
      ['insignificantes', 'Insignificantes — Daño material menor, sin lesiones'],
      ['menores',         'Menores — Daño reparable o lesiones leves'],
      ['significativas',  'Significativas — Daño importante o lesiones que requieren atención médica'],
      ['severas',         'Severas — Lesiones graves o muerte, o daño grave a una vivienda'],
    ],
  },
  v1: {
    failureProbability: [
      ['improbable', 'Improbable — No hay indicadores de falla'],
      ['posible',    'Posible — Defectos presentes pero estables'],
      ['probable',   'Probable — Defectos activos, deterioro visible'],
      ['inminente',  'Inminente — Falla esperada sin intervención'],
    ],
    impactProbability: [
      ['baja',  'Baja — Zona raramente ocupada'],
      ['media', 'Media — Zona con uso ocasional'],
      ['alta',  'Alta — Zona de uso frecuente o permanente'],
    ],
    consequences: [
      ['insignificantes', 'Insignificantes — Daño mínimo'],
      ['menores',         'Menores — Lesiones leves o daños menores'],
      ['significativas',  'Significativas — Lesiones moderadas o daños mayores'],
      ['severas',         'Severas — Lesiones graves o pérdida de bienes'],
      ['catastroficas',   'Catastróficas — Muerte o pérdida total'],
    ],
  },
};

// Qué significa cada nivel, en palabras para el cliente. Son textos NUESTROS
// (la ISA da los niveles para priorizar, no estas frases): por eso el documento
// los presenta como recomendación y no como parte del método.
const RISK_SIGNIFICA = {
  bajo:     'Riesgo aceptable. No hace falta intervenir por seguridad; alcanza con el control periódico.',
  moderado: 'Conviene reducirlo con un trabajo planificado. No es urgente.',
  alto:     'Conviene reducirlo pronto con el trabajo propuesto.',
  extremo:  'Requiere acción inmediata: restringir el paso debajo del árbol y mitigar cuanto antes.',
};

// Alcance de la inspección. "Inspección aérea con trepa" es lo que lleva una
// evaluación al Nivel 3 (avanzada) de la ISA.
const RISK_TECNICAS = [
  ['suelo',       'Inspección visual 360° desde el suelo'],
  ['binoculares', 'Binoculares'],
  ['aerea',       'Inspección aérea con trepa'],
  ['mazo',        'Sondeo con mazo'],
  ['sonda',       'Sondeo de cavidades con varilla'],
  ['cuello',      'Revisión del cuello de raíz'],
];
const RISK_PLAZOS = ['6','12','24','36'];
const RISK_REINSP = ['3','6','12','24','36'];
const RISK_ORIENT = ['N','NE','E','SE','S','SO','O','NO'];

// Tipos de defecto, en el orden del desplegable. 'inclinacion' ya no se ofrece
// (la inclinación es un dato del árbol, no un defecto suelto) pero se sigue
// mostrando en los informes que la tienen.
const RISK_DEFECT_TYPES = [
  ['caries',      'Caries / Pudrición'],
  ['crack',       'Grieta / Crack'],
  ['inclusion',   'Inclusión de corteza'],
  ['codomin',     'Horqueta codominante'],
  ['desmoche',    'Rebrotes de desmoche (anclaje débil)'],
  ['colgada',     'Rama colgada o suelta'],
  ['muerto',      'Madera muerta / Ramas secas'],
  ['hongos',      'Cuerpos fructíferos (hongos)'],
  ['herida',      'Herida / Cicatriz abierta'],
  ['raiz',        'Daño en raíces'],
  ['placa',       'Levantamiento de la placa radicular'],
  ['inclinacion', 'Inclinación pronunciada'],
  ['otro',        'Otro'],
];
const RISK_DEFECT_OCULTOS = ['inclinacion'];
const RISK_DEFECT_LOC = [
  ['base',     'Base / Raíces'],
  ['fuste',    'Fuste'],
  ['copa',     'Copa'],
  ['multiple', 'Múltiples zonas'],
];
function _riskOptLabel(list, v) { const o = list.find(x => x[0] === v); return o ? o[1] : (v || ''); }
