'use strict';
// ════════════════════════════════════════════════════════════════
// AYUDA (v261) — Configuración → Ayuda
// ════════════════════════════════════════════════════════════════
// Un índice de lo que hace cada pestaña, con buscador y "Llevame ahí".
// Existe para que un colega que recibe la app aprenda a usarla sin que
// nadie se la explique: busca con sus palabras ("botón de enviados",
// "pestaña historial", "cómo mando el PDF") y llega al artículo y, de
// ahí, al lugar de la pantalla del que habla, que destella.
//
// El contenido es estático y vive acá (anda sin señal). Formato de cada
// artículo:
//   id   identificador [a-z0-9-] (va en onclick; lo valida el test)
//   g    grupo (AYUDA_GRUPOS)
//   t    título
//   kw   palabras con las que la gente lo busca (sinónimos, plurales…)
//   txt  párrafos: string = párrafo; { ul:[…] } o { ol:[…] } = lista.
//        **así** = negrita. Se escapa con esc() antes de darle formato.
//   ir   destino de "Llevame ahí" (ver ayudaIr):
//        { tab, sub?, sec?, cs?, avisos?, sel:[…], nota? }
//        sel es una lista: gana el primero que esté a la vista; si no es
//        el primero y hay `nota`, se avisa por qué (p. ej. otro modo).
//   rel  ids de artículos relacionados ("Ver también")
//
// Si una feature cambia, su artículo se actualiza en el mismo cambio
// (skill nueva-feature). test/ayuda.test.cjs falla si un destino o un
// relacionado apunta a algo que ya no existe.

const AYUDA_GRUPOS = [
  { k:'inicio',      t:'Primeros pasos' },
  { k:'editor',      t:'Editor' },
  { k:'historial',   t:'Historial' },
  { k:'agenda',      t:'Agenda' },
  { k:'mapa',        t:'Mapa' },
  { k:'facturacion', t:'Facturación' },
  { k:'config',      t:'Configuración' },
  { k:'glosario',    t:'Glosario' },
];

const AYUDA = [
  // ── PRIMEROS PASOS ────────────────────────────────────────────
  { id:'que-es', g:'inicio', t:'Qué es la app y dónde quedan tus datos',
    kw:'datos privacidad cuenta login usuario contraseña offline sin internet sin señal guardar seguridad',
    txt:[
      'Presupuestos AR sirve para armar presupuestos de poda y extracción desde el celular, mandarlos por WhatsApp y seguirlos hasta que se cobran, con agenda, mapa, facturas y recibos.',
      'No hay cuenta ni login. Todo lo que cargás (presupuestos, clientes, fotos, notas) queda guardado **en este teléfono**, y la app anda sin señal.',
      'La contracara: si perdés o cambiás el teléfono, tus datos no están en ningún otro lado, salvo que tengas una copia. Por eso conviene conectar Google Drive o exportar un backup cada tanto.',
    ],
    ir:{ tab:'empresa', sub:'datos', sel:['#backup-file-section'] },
    rel:['backup'] },

  { id:'negocio', g:'inicio', t:'Configurar tu negocio',
    kw:'logo empresa nombre titular cuit monotributo whatsapp telefono email mail ciudad alias cbu cvu banco billetera datos de pago cobrar mis datos',
    txt:[
      'Entrá a Configuración (el engranaje ⚙ de arriba) → **Negocio**. Lo que cargues ahí sale en todos tus presupuestos:',
      { ul:[
        '**Logo** (PNG, JPG o SVG).',
        'Nombre de la empresa, titular, especialidad, CUIT, WhatsApp, ciudad y email.',
        '**Datos para cobrar**: alias, CBU/CVU, banco y titular de la cuenta. Salen en la sección "Cómo pagar" del documento y en el mensaje de cobro. Lo que dejes vacío no aparece.',
      ] },
      'Es lo primero que conviene completar: un presupuesto sin tu nombre ni tu teléfono no le sirve al cliente.',
    ],
    ir:{ tab:'empresa', sub:'negocio', sel:['#co-name'] },
    rel:['estilo'] },

  { id:'primer-presupuesto', g:'inicio', t:'Tu primer presupuesto, de punta a punta',
    kw:'empezar comenzar arrancar nuevo crear hacer presupuesto como hago tutorial guardar pasos',
    txt:[
      { ol:[
        'Tocá **+ Nuevo**, arriba. El presupuesto que tenías abierto queda guardado solo.',
        'En el Editor, elegí el modo (Normal, Estimativo o Riesgo) y cargá el cliente y el lugar.',
        'Sumá los trabajos con **+ Árbol / Trabajo**: especie, qué vas a hacer y el precio.',
        'Mirá cómo queda con el ojo 👁 de la barra de abajo.',
        'Mandalo con **WhatsApp** o descargalo con **Imprimir / PDF**. La app te ofrece marcarlo como Enviado.',
        'Cuando el cliente conteste, en el Historial marcalo como **Aceptado** o **Perdido**.',
      ] },
      'No hay botón de guardar: todo se guarda solo mientras escribís.',
    ],
    ir:{ tab:'editor', sel:['#btn-nuevo'] },
    rel:['modos', 'trabajos', 'enviar', 'estados'] },

  { id:'pestanas', g:'inicio', t:'Las pestañas y los botones de arriba',
    kw:'pestañas menu secciones barra campanita notificaciones engranaje configuracion deshacer pendientes inicio pantallas',
    txt:[
      { ul:[
        '**Editor**: donde armás el presupuesto que tenés abierto.',
        '**Historial**: todos los presupuestos y trabajos guardados, con su estado y sus avisos.',
        '**Agenda**: trabajos, visitas y recordatorios en un calendario.',
        '**Mapa**: tus presupuestos ubicados, con cifras por zona y rutas.',
        '**Facturación**: las facturas emitidas y cuánto te queda del tope del monotributo.',
      ] },
      'Arriba están **+ Nuevo** (presupuesto en blanco), la **campanita** 🔔 y el **engranaje** ⚙ (Configuración, donde está esta Ayuda).',
      'La campanita junta lo pendiente de hoy y lo atrasado (trabajos, visitas, recontactos, seguimientos, vencidos y clima) y lo último que hiciste, con **Deshacer** cuando se puede volver atrás. El número rojo cuenta solo lo nuevo que todavía no viste.',
    ],
    ir:{ tab:'editor', sel:['#tabs'] } },

  { id:'instalar', g:'inicio', t:'Instalar la app en el celular',
    kw:'instalar icono acceso directo pantalla de inicio descargar app actualizar actualizacion version nueva',
    txt:[
      'Abrí la app en Chrome (Android) o Safari (iPhone) y, en el menú del navegador, elegí **Instalar app** o **Agregar a pantalla de inicio**. Queda con su ícono y se abre a pantalla completa, como cualquier app.',
      'Las actualizaciones llegan solas: la próxima vez que abrís la app con señal se baja la versión nueva y se recarga. Tus datos no se tocan.',
    ] },

  // ── EDITOR ────────────────────────────────────────────────────
  { id:'modos', g:'editor', t:'Los tres modos: Normal, Estimativo y Riesgo',
    kw:'modo modos tipo normal estimativo riesgo fotos referencial isa informe evaluacion precio cerrado',
    txt:[
      { ul:[
        '**Normal**: precios cerrados por trabajo. Es el presupuesto de siempre, después de ver el árbol.',
        '**Estimativo**: basado en las fotos que te mandó el cliente. Es un valor de referencia, y el documento avisa que se confirma al ver el lugar.',
        '**Riesgo**: suma un informe de evaluación del árbol basado en la metodología de la ISA (defectos, blancos, probabilidades y nivel de riesgo).',
      ] },
      'El modo se elige arriba de todo en el Editor. Cambia qué secciones ves y cómo sale el documento.',
    ],
    ir:{ tab:'editor', sel:['#mode-switch'] },
    rel:['riesgo', 'g-estimativo'] },

  { id:'vistas-editor', g:'editor', t:'Vistas del editor: Clásica, Fichas y Etapas',
    kw:'vista vistas editor clasica fichas etapas pantalla ordenar secciones progreso largo scroll',
    txt:[
      { ul:[
        '**Clásica**: todo desplegado en una sola lista.',
        '**Fichas**: cada sección se pliega y queda una abierta por vez, con una barra que dice qué te falta.',
        '**Etapas**: el presupuesto partido en pantallas: Datos, Trabajos, Informe (solo en Riesgo) y Cierre.',
      ] },
      'Es solo cómo lo ves: el presupuesto es el mismo. Se cambia en Configuración → Estilo → **Vista del editor**.',
    ],
    ir:{ tab:'empresa', sub:'estilo', sel:['#vista-editor-mode'] } },

  { id:'cliente', g:'editor', t:'Datos del cliente y del trabajo',
    kw:'cliente clientes nombre telefono contacto direccion lugar domicilio ubicacion coordenadas rubro jardineria arbolado numero fecha emision vencimiento moneda dolares tiempo estimado',
    txt:[
      '**Identificación**: número, fecha de emisión, vencimiento y moneda. Se completa sola; tocá **Cambiar** si necesitás otra cosa.',
      '**Cliente y lugar**: nombre, teléfono y dirección. Los clientes que ya cargaste se autocompletan. Con **Mi ubicación** guardás las coordenadas de donde estás parado, y así el presupuesto aparece en el Mapa.',
      'El **rubro** (Arbolado o Jardinería) cambia el título del documento y la columna de trabajos. También podés cargar el **tiempo estimado** del trabajo.',
    ],
    ir:{ tab:'editor', sec:['cliente'], sel:['#esec-cliente'] },
    rel:['mapa'] },

  { id:'trabajos', g:'editor', t:'Cargar trabajos: árboles, servicios y notas',
    kw:'item items arbol arboles trabajo trabajos agregar sumar especie precio sugerido ultimo precio servicio servicios camion volquete grua nota tarea lista',
    txt:[
      { ul:[
        '**+ Árbol / Trabajo**: cada árbol o tarea, con especie, qué se hace y precio. Si ya cobraste esa especie, debajo del precio te sugiere el último valor, con **Usar**.',
        '**+ Servicio**: costos aparte, como camión, volquete o grúa. Los que usás seguido aparecen como botones rápidos.',
        '**+ Nota**: un texto suelto en la lista, sin precio.',
      ] },
      'En el modo Estimativo la sección se llama **Trabajos estimados** y funciona igual.',
    ],
    ir:{ tab:'editor', sec:['items', 'est-items'], sel:['.add-tree', '#esec-est-items'] },
    rel:['unidades', 'escenarios', 'fotos'] },

  { id:'unidades', g:'editor', t:'Cobro por unidad y "Mis servicios"',
    kw:'unidad unidades metro metros m2 metro cuadrado jornada jornal cantidad precio unitario mis servicios tarifa tarifas trepador motosierra hora',
    txt:[
      'En **Jardinería**, cada trabajo puede cobrarse por **metro**, **metro cuadrado** o **jornada**: cargás precio y cantidad, y el documento lo desglosa ("40 m × $ 3.000").',
      '**Mis servicios** son tus tarifas propias: lo que cobrás cuando un colega te llama (la jornada de trepador, la hora de motosierra). Se cargan en Configuración → Datos → **Mis servicios** y aparecen al registrar un trabajo sin presupuesto.',
      'No hay que confundirlos con los servicios de un presupuesto (camión, volquete), que son costos dentro del trabajo.',
    ],
    ir:{ tab:'empresa', sub:'datos', cs:'cs-missvc', sel:['#cs-missvc'] },
    rel:['sin-presupuesto'] },

  { id:'escenarios', g:'editor', t:'Dos opciones en un PDF (escenarios A/B)',
    kw:'escenario escenarios opcion opciones alternativa alternativas a b dos precios comparar extraccion poda elegir',
    txt:[
      'Activá **Dos opciones en un PDF**, en la sección de trabajos, para ofrecer dos alternativas con su precio. Por ejemplo: Opción A = extraer el árbol, Opción B = podarlo.',
      'Cada opción tiene su lista de trabajos y su total, y la barra de abajo muestra los dos. El cliente ve las dos en el mismo documento y elige.',
    ],
    ir:{ tab:'editor', sec:['items'], sel:['.scenarios-toggle-row', '#mode-switch'],
      nota:'Las dos opciones están en el modo Normal.' },
    rel:['trabajos'] },

  { id:'ajustes', g:'editor', t:'Recargo y descuento',
    kw:'recargo descuento porcentaje viaticos distancia traslado aumento rebaja total ajuste ajustes precio',
    txt:[
      'En **Ajustes de precio** (en la vista Etapas, dentro de Cierre):',
      { ul:[
        '**Recargo**: un porcentaje que se suma a todos los precios, por ejemplo por viáticos o distancia. Tocá **Aplicar**; con la cruz lo sacás.',
        '**Descuento**: un porcentaje sobre el total. En Configuración → Textos podés cambiar cómo se llama en el PDF y sumarle una nota explicativa.',
      ] },
      'La barra de abajo muestra subtotal, descuento y recargo, así ves el total final mientras lo cambiás.',
    ],
    ir:{ tab:'editor', sec:['adjust'], sel:['#esec-adjust'] } },

  { id:'fotos', g:'editor', t:'Fotos de los trabajos',
    kw:'foto fotos imagen imagenes camara galeria compartir adjuntar leña residuos disposicion',
    txt:[
      'Cada árbol puede llevar foto, que sale en el documento junto al trabajo. Tocala para verla grande.',
      'Si compartís fotos a la app desde la galería o desde WhatsApp, te pregunta a qué trabajo va cada una.',
      'En **Disposición de leña y residuos** podés sumar fotos del lugar acordado con el cliente.',
      'Las fotos se guardan en el teléfono, aparte de los datos, y viajan en la copia de seguridad. **Duplicar** un presupuesto no copia las fotos.',
    ],
    ir:{ tab:'editor', sec:['items', 'est-items'], sel:['.add-tree', '#esec-est-items'] },
    rel:['backup'] },

  { id:'frases', g:'editor', t:'Frases guardadas',
    kw:'frase frases texto rapido textos plantilla insertar biblioteca especie hueco corchete condiciones de pago observaciones descripcion',
    txt:[
      'Los botones **Frases** abren tu biblioteca de textos para insertarlos sin tipear: condiciones de pago, observaciones, descripciones de trabajo. Para guardar una nueva, escribila en el campo y tocá el botón de guardar frase.',
      'Si una frase dice **[especie]**, se reemplaza por la especie de ese árbol. Si todavía no la cargaste, el corchete queda como recordatorio y se completa solo.',
      'Huecos como **[X]** (la altura) o **[localidad]** quedan seleccionados para que escribas encima. Antes de imprimir o mandar, la app te avisa si quedó alguno.',
    ],
    ir:{ tab:'editor', sec:['conditions'], sel:['#esec-conditions .phrase-btn', '#mode-switch'],
      nota:'Las frases de condiciones están en los modos Normal y Riesgo.' } },

  { id:'notas-internas', g:'editor', t:'Notas internas',
    kw:'nota notas privada privadas interna internas anotacion anotaciones recordatorio no sale pdf secreto',
    txt:[
      'El botón **Notas**, arriba del Editor, guarda anotaciones privadas del presupuesto: lo que te dijo el cliente, el código del portón, a quién llamar. **No salen en el PDF.**',
    ],
    ir:{ tab:'editor', sel:['#btn-notes-panel'] } },

  { id:'riesgo', g:'editor', t:'Informe de riesgo',
    kw:'riesgo informe isa evaluacion evaluar defecto defectos peligro peligroso caida blancos probabilidad falla impacto consecuencias nivel residual reinspeccion dap altura inclinacion',
    txt:[
      'Con el modo **Riesgo**, el Editor suma el **Informe**: el alcance de la inspección; los datos del árbol (especie, altura, DAP, vitalidad, inclinación); los **defectos**, con foto; qué hay en la zona de caída, el viento y el suelo.',
      'Con la probabilidad de falla, la de impacto y las consecuencias, la app calcula el **nivel de riesgo** con las matrices de la metodología de la ISA. Después cargás qué se propone hacer, el riesgo que queda (residual) y cuándo reinspeccionar.',
      'Quién evalúa y el descargo general de limitaciones se configuran una sola vez, en Configuración → Textos.',
    ],
    ir:{ tab:'editor', sec:['risk'], sel:['#esec-risk', '#mode-btn-riesgo'],
      nota:'Elegí el modo Riesgo para ver el informe.' },
    rel:['modos'] },

  { id:'enviar', g:'editor', t:'Vista previa, PDF y envío por WhatsApp',
    kw:'pdf vista previa ver imprimir descargar mandar enviar compartir whatsapp cliente documento total barra',
    txt:[
      'La barra de abajo del Editor muestra el total y tiene tres botones:',
      { ul:[
        '👁 **Vista previa**: el documento tal como lo va a ver el cliente.',
        '**Imprimir / PDF**: lo guarda como PDF o lo imprime.',
        '**WhatsApp**: abre el chat del cliente con el mensaje armado (el texto se edita en Configuración → Textos).',
      ] },
      'Al generar el PDF, la app te pregunta si lo marcás como **Enviado**. Desde ese momento cuenta el vencimiento y te recuerda hacer el seguimiento.',
    ],
    ir:{ tab:'editor', sel:['.stb-wa'] },
    rel:['estados', 'mensajes'] },

  // ── HISTORIAL ─────────────────────────────────────────────────
  { id:'buscar-historial', g:'historial', t:'Buscar y filtrar',
    kw:'buscar busqueda buscador filtro filtros filtrar encontrar cliente numero lugar mes meses duplicar copiar abrir editar guardados',
    txt:[
      'El buscador del Historial encuentra por número, cliente o lugar. Debajo están los filtros por cliente, por tipo (presupuestos, trabajos directos, colaboraciones) y por estado.',
      'Los presupuestos se agrupan por mes, con el total de cada mes. Cada tarjeta tiene sus acciones: abrirla en el Editor, verla, compartirla, duplicarla o escribirle al cliente.',
    ],
    ir:{ tab:'historial', sel:['#hist-search'] } },

  { id:'estados', g:'historial', t:'Estados del presupuesto',
    kw:'estado estados boton enviado enviados aceptado aceptados realizado realizados perdido perdidos borrador borradores ir a ver control en sitio evolucion marcar cambiar',
    txt:[
      'Cada presupuesto tiene un estado, que elegís en su tarjeta del Historial:',
      { ul:[
        '**Ir a ver**: todavía no lo cotizaste, hay que ir a evaluar.',
        '**Borrador**: lo estás armando.',
        '**Enviado**: ya lo tiene el cliente. Desde acá corren el seguimiento y el vencimiento.',
        '**Aceptado**: dijo que sí. La app te ofrece agendar la fecha del trabajo.',
        '**Realizado**: el trabajo está hecho. Te ofrece mandar los datos de pago y registrar la factura.',
        '**Control en sitio**: hay que volver a controlar cómo evoluciona el árbol.',
        '**Perdido**: no se hizo.',
      ] },
      'Tener los estados al día es lo que hace funcionar los avisos, la Agenda y las cifras del Mapa.',
    ],
    ir:{ tab:'historial', sel:['.hestado-sel', '#hist-search'],
      nota:'Cuando tengas presupuestos guardados, el estado se elige en cada tarjeta.' },
    rel:['vencidos', 'conversion'] },

  { id:'vencidos', g:'historial', t:'Vencidos y "¿Qué pasó?"',
    kw:'vencido vencidos vencimiento vence validez vigencia prorrogar prorroga extender sigue en pie que paso acepto lo perdi aviso',
    txt:[
      'Un presupuesto **Enviado** vence cuando pasa su fecha de validez. Vencido no quiere decir perdido: muchas veces el cliente simplemente no contestó.',
      'Los vencidos aparecen en los avisos del Historial, cada uno con **¿Qué pasó?**:',
      { ul:[
        '**Aceptó**: pasa a Aceptado y te ofrece agendar.',
        '**Lo perdí**: pasa a Perdido (con Deshacer).',
        '**Sigue en pie**: le da una vigencia nueva desde hoy, con los mismos días del presupuesto.',
      ] },
      'El ✓ solo saca el aviso: el presupuesto sigue vencido. Si el cliente vuelve tarde, **Nueva versión** lo cotiza de nuevo con precios actualizados.',
    ],
    ir:{ tab:'historial', avisos:true, sel:['#expiry-banner', '#hist-avisos'],
      nota:'Ahora no tenés vencidos: cuando haya, aparecen en estos avisos.' },
    rel:['vsr', 'versiones', 'numeracion'] },

  { id:'vsr', g:'historial', t:'Vencidos sin respuesta',
    kw:'vencidos sin respuesta lista completa pendientes respondidos todos contestar',
    txt:[
      'Es la lista completa de los enviados que vencieron sin que marques qué pasó, los más recientes primero. Incluye los que sacaste del aviso con el ✓.',
      'Se abre con **Ver todos los vencidos sin respuesta**, al pie del aviso de vencidos, o desde el Mapa, tocando "N vencidos sin respuesta" en la franja de arriba.',
      'Responder cada uno con ¿Qué pasó? es lo que hace que la cifra "de los respondidos" del Mapa sea real y no una suposición.',
    ],
    ir:{ tab:'historial', avisos:true, sel:['.fub-vsr', '#hist-avisos'],
      nota:'Ahora no tenés vencidos sin respuesta.' },
    rel:['vencidos', 'conversion'] },

  { id:'seguimiento', g:'historial', t:'Seguimiento y recontacto',
    kw:'seguimiento seguimientos recontacto recontactar recordar recordatorio volver a llamar escribir cliente no contesto dias aviso coordinar',
    txt:[
      '**Seguimiento**: si un presupuesto enviado pasa unos días sin respuesta, la app te avisa para escribirle al cliente, con un mensaje listo para WhatsApp. Cuántos días esperar, en qué estados avisar y el texto se configuran en Configuración → Textos → **Seguimiento de presupuestos**.',
      '**Recontacto**: cuando un cliente acepta pero todavía no hay fecha, en el diálogo de agendar podés elegir un día para volver a llamarlo. Ese día aparece en los avisos y en la Agenda, con su mensaje.',
    ],
    ir:{ tab:'empresa', sub:'textos', sel:['#fu-section'] },
    rel:['mensajes', 'agendar'] },

  { id:'versiones', g:'historial', t:'Versiones de un presupuesto',
    kw:'version versiones nueva version actualizar precios inflacion aumento porcentaje v2 revision volvio el cliente',
    txt:[
      'Cuando un presupuesto venció y el cliente vuelve, **Nueva versión** crea otro presupuesto ligado al anterior: el mismo número con "-v2", fecha de hoy, vigencia nueva y los precios actualizados con el porcentaje que elijas, redondeados a cifras de oficio.',
      'El original queda como referencia de lo que le dijiste, y sale de los avisos y del Mapa para no contar dos veces el mismo trabajo. Al mandarla por WhatsApp sale el mensaje de "presupuesto actualizado".',
    ],
    ir:{ tab:'historial', avisos:true, sel:['#expiry-banner', '#hist-avisos'],
      nota:'Nueva versión aparece en cada vencido de estos avisos.' },
    rel:['vencidos'] },

  { id:'sin-presupuesto', g:'historial', t:'Trabajos sin presupuesto',
    kw:'trabajo trabajos sin presupuesto directo colaboracion colaboraciones colega jornada trepador registrar rapido changa laburo',
    txt:[
      'El botón **+ Trabajo** del Historial registra trabajos que no pasaron por un presupuesto:',
      { ul:[
        '**Trabajo directo**: un trabajo chico para un cliente tuyo. Suma en tus ventas del mes y en el acumulado del cliente.',
        '**Colaboración**: una jornada para un colega que te llamó. Se lleva aparte, porque esa plata la paga el colega.',
      ] },
      'Si la fecha es futura queda Aceptado y aparece en la Agenda; si es hoy o ya pasó, queda Realizado y te ofrece los datos de pago y la factura. No cuentan en la conversión del Mapa, y también tienen su documento para ver o compartir.',
    ],
    ir:{ tab:'historial', sel:['#hist-colab-btn'] },
    rel:['unidades'] },

  // ── AGENDA ────────────────────────────────────────────────────
  { id:'agendar', g:'agenda', t:'Agendar un trabajo aceptado',
    kw:'agendar agenda fecha del trabajo programar dia dias duracion comienzo calendario aceptado coordinar',
    txt:[
      'Al marcar un presupuesto como **Aceptado** se abre el diálogo para agendarlo: cuántos días dura, el día de comienzo (y los otros días, si no son seguidos) y una nota. Abajo ves el pronóstico de los próximos días para elegir uno bueno.',
      'Si todavía no hay fecha, podés dejar un día para recontactar al cliente.',
      'El botón **Agenda** del Historial muestra los trabajos aceptados ordenados por fecha.',
    ],
    ir:{ tab:'historial', sel:['#hist-agenda-btn'] },
    rel:['vistas-agenda', 'clima', 'seguimiento'] },

  { id:'vistas-agenda', g:'agenda', t:'Vistas de la Agenda',
    kw:'agenda calendario mes semana 3 dias tres lista hoy vista vistas colores leyenda atrasado',
    txt:[
      'Arriba elegís **Mes**, **Semana**, **3 días** o **Agenda** (la lista cronológica, con lo atrasado aparte). Con las flechas te movés, y **Hoy** te trae de vuelta.',
      'Se ven juntos los trabajos, las visitas, los recordatorios, los recontactos, los seguimientos y los vencimientos, cada uno con su color.',
    ],
    ir:{ tab:'agenda', sel:['#agc-vtab-mes'] } },

  { id:'visitas', g:'agenda', t:'Visitas y recordatorios',
    kw:'visita visitas recordatorio recordatorios nota notas cita evaluacion presencial ir a ver hora contacto crear presupuesto mover cambiar dia',
    txt:[
      'Tocá un día de la Agenda y, abajo, anotá un **recordatorio** (+ Nota) o una **visita** (+ Visita: ir a evaluar o a presupuestar).',
      'Al editarlos podés sumar hora (si no, son de todo el día), un contacto para chatear directo y la ubicación, que sirve para "Cómo llegar". Con hora, te llega un aviso antes. Para moverlos de día, cambiales la fecha.',
      'Una visita tiene el botón **Crear presupuesto**: pasa el cliente, el teléfono y la ubicación al Editor, y la marca como hecha.',
    ],
    ir:{ tab:'agenda', sel:['.agc-note-form', '#agc-grid', '#agc-list'] },
    rel:['push'] },

  { id:'clima', g:'agenda', t:'Pronóstico del clima',
    kw:'clima tiempo pronostico lluvia llueve viento rafaga rafagas uv sol calor temperatura reprogramar postergar compartir',
    txt:[
      'Los trabajos y visitas agendados muestran un chip con lo importante del pronóstico: **lluvia**, **viento fuerte** (ráfagas, peligroso en altura) e **índice UV**.',
      'Tocá el chip para ver el detalle: el día completo, hora por hora de las próximas 72 h y recomendaciones. Desde ahí podés **reprogramar por WhatsApp** con el cliente o **compartir** el pronóstico con tu equipo.',
      'Si viene lluvia o viento para hoy o mañana en un trabajo agendado, la app te avisa sola. El dato se renueva cada 3 horas; **Actualizar**, en el detalle, lo pide de nuevo.',
    ],
    ir:{ tab:'agenda', sel:['#agc-grid', '#agc-list'] },
    rel:['agendar'] },

  { id:'gcal', g:'agenda', t:'Google Calendar y archivo .ics',
    kw:'google calendar calendario sincronizar sincronizacion ics exportar telefono computadora compu',
    txt:[
      '**Google Calendar**: en Configuración → Datos conectás tu cuenta, y la Agenda se copia sola a un calendario propio llamado "Presupuestos AR". Va de la app a Google, no al revés. Lo ves en el celular, en la computadora o donde uses Google Calendar.',
      '**Exportar .ics**: el botón de la Agenda descarga un archivo con tus trabajos y recontactos próximos, para sumarlos a cualquier calendario.',
    ],
    ir:{ tab:'empresa', sub:'datos', sel:['#gcal-section'] } },

  // ── MAPA ──────────────────────────────────────────────────────
  { id:'mapa', g:'mapa', t:'Mapa de presupuestos',
    kw:'mapa pin pines color colores ubicacion ubicaciones filtro filtros fechas periodo sin ubicar hueco grupo circulo',
    txt:[
      'Cada presupuesto con ubicación es un pin del color de su estado. Un pin **hueco** es un enviado vencido, y el ✓ marca los realizados. Los pins cercanos se juntan en un círculo con la cantidad: tocalo para acercarte.',
      '**Filtros**: por estado y por fechas, con atajos de período.',
      '**Sin ubicar**: los presupuestos que todavía no tienen ubicación, para completarla.',
      'Sin señal el mapa se abre igual, con los pins sobre un fondo vacío; **Cargar el fondo igual** lo baja.',
    ],
    ir:{ tab:'mapa', sel:['#mapa-filtros-btn'] },
    rel:['zonas', 'cliente'] },

  { id:'zonas', g:'mapa', t:'Zonas y estadísticas',
    kw:'zona zonas barrio barrios localidad estadistica estadisticas presupuestado total franja resumen',
    txt:[
      'La franja de arriba del mapa resume lo que tenés a la vista: cuántos presupuestos hay, cuánto presupuestaste y cuántos de cada estado (los chips llevan el color del pin, así que funcionan como referencia).',
      'Acercate a un barrio o a una localidad y la franja se actualiza con los números de esa zona. Los trabajos sin presupuesto aparecen aparte.',
    ],
    ir:{ tab:'mapa', sel:['#mapa-zonastats', '#mapa-vista'] },
    rel:['conversion'] },

  { id:'conversion', g:'mapa', t:'Conversión: aceptados y "de los respondidos"',
    kw:'conversion porcentaje tasa exito aceptados respondidos esperando respuesta estadistica efectividad cierre cuantos me aceptan',
    txt:[
      'La franja del Mapa muestra dos cifras:',
      { ul:[
        '**Aceptados: N de M enviados**: de todos los presupuestos que mandaste, cuántos se aceptaron o se hicieron. Es la cuenta de cabeza: si mandaste 50 y te aceptaron 25, es el 50%.',
        '**De los respondidos**: lo mismo, pero solo entre los que ya tienen respuesta (aceptados, perdidos y vencidos). Los que siguen vigentes van aparte, como "esperando respuesta".',
      ] },
      'Con menos de 5 presupuestos no se muestra el porcentaje, solo la cuenta: "1 de 1" no quiere decir que te acepten todos.',
      'Los borradores, "Ir a ver" y "Control en sitio" no cuentan, porque no son presupuestos mandados. Los trabajos sin presupuesto tampoco.',
    ],
    ir:{ tab:'mapa', sel:['.mapa-zona-conv', '#mapa-zonastats', '#mapa-vista'] },
    rel:['vsr', 'estados'] },

  { id:'cerca', g:'mapa', t:'Cerca mío y rutas',
    kw:'cerca mio cercanos ruta rutas recorrido gps como llegar maps google maps navegacion distancia',
    txt:[
      '**Cerca mío** te ubica y lista los trabajos más cercanos para armar el recorrido. Google Maps acepta pocas paradas por vez en el celular, así que la ruta se parte en tramos de hasta 4 paradas.',
      '**Cómo llegar** (en el Historial, el Mapa y el aviso de hoy) abre Google Maps con el camino ya cargado desde donde estás.',
    ],
    ir:{ tab:'mapa', sel:['#mapa-cerca-btn'] } },

  // ── FACTURACIÓN ───────────────────────────────────────────────
  { id:'facturas', g:'facturacion', t:'Registrar facturas',
    kw:'factura facturas facturar facturacion registrar monto arca afip emitir emitida mes',
    txt:[
      'En Facturación cargás cada factura que emitiste: fecha, monto, cliente y, si querés, una descripción.',
      'Arriba ves lo facturado en los últimos 12 meses, el promedio mensual, lo de este mes y cuánto te queda disponible hasta el tope.',
      'Al marcar un trabajo como Realizado, **Registrar factura** te trae acá con los datos del presupuesto.',
      'La app no emite facturas: las hacés en ARCA como siempre, y acá llevás la cuenta.',
    ],
    ir:{ tab:'facturacion', sel:['#fact-fecha'] },
    rel:['tope', 'recibo'] },

  { id:'tope', g:'facturacion', t:'Tope anual del monotributo',
    kw:'tope limite monotributo categoria recategorizacion arca anual maximo disponible',
    txt:[
      'La barra muestra qué porcentaje del tope anual llevás facturado en los últimos 12 meses, y te avisa cuando te acercás.',
      'El tope se carga en **Configuración del tope**, al final de la pestaña. ARCA lo actualiza en febrero y en agosto, y la app te recuerda revisarlo.',
    ],
    ir:{ tab:'facturacion', sel:['#fact-hero'] },
    rel:['facturas'] },

  { id:'recibo', g:'facturacion', t:'Recibo de pago',
    kw:'recibo recibos comprobante pago cobro cobrar datos de pago alias cbu transferencia',
    txt:[
      'Cada factura registrada tiene el botón 🧾 para generar un **recibo de pago** en PDF, con su propio número.',
      'Al marcar un trabajo como **Realizado**, la app te ofrece **Datos de pago**, que le manda al cliente tu alias y tu CBU por WhatsApp (y te deja el alias copiado), y **Registrar factura**.',
    ],
    ir:{ tab:'facturacion', sel:['#fact-reg-list'] },
    rel:['facturas', 'negocio'] },

  // ── CONFIGURACIÓN ─────────────────────────────────────────────
  { id:'mensajes', g:'config', t:'Mensajes de WhatsApp',
    kw:'mensaje mensajes whatsapp plantilla plantillas texto variables llaves cliente numero importe cobro saludo editar',
    txt:[
      'En Configuración → Textos editás los mensajes que arma la app:',
      { ul:[
        '**Al enviar** el presupuesto.',
        '**Presupuesto actualizado**, cuando mandás una nueva versión.',
        '**Recontacto**, para coordinar la fecha con un cliente que aceptó.',
        '**Cobro**, con tus datos de pago.',
        'Y el de **seguimiento**, en su propia sección.',
      ] },
      'Las palabras entre llaves se reemplazan solas: {cliente}, {numero}, {empresa}, {importe}, {alias}, {datos_pago}… Si una queda vacía, su renglón no se manda.',
    ],
    ir:{ tab:'empresa', sub:'textos', sel:['#wa-send-template'] },
    rel:['seguimiento'] },

  { id:'textos-doc', g:'config', t:'Textos del documento',
    kw:'textos texto titulo titulos disclaimer aviso pie de pagina firma saludo plan de trabajo como trabajamos criterios notas tecnicas orden secciones juego redaccion',
    txt:[
      'En Configuración → Textos también están los títulos de cada tipo de presupuesto, los avisos del estimativo, las secciones "Plan de trabajo" y "Cómo trabajamos", las notas técnicas, el pie de página y el saludo final, además del orden de las secciones del PDF y cuáles se muestran.',
      '**Juego de textos** cambia de una vez todos los textos de fábrica por otro estilo de redacción. Si ya escribiste textos propios, te pregunta antes, y se puede deshacer.',
    ],
    ir:{ tab:'empresa', sub:'textos', sel:['#textos-juegos'] } },

  { id:'estilo', g:'config', t:'Estilo del PDF',
    kw:'estilo estilos diseño diseños color colores tema letra tipografia fuente monograma iniciales compacto sorprendeme mis estilos oscuro claro apariencia lindo',
    txt:[
      'En Configuración → Estilo elegís cómo se ve tu documento: el diseño (Clásico, Profesional, Cálido, Minimalista, Lateral, Técnico, Elegante), el color principal y el de detalle, la tipografía, un monograma con tus iniciales (si no tenés logo) y elementos como encabezado, títulos, tabla, total, fondo y pie. El **modo compacto** aprieta todo cuando hay muchos trabajos.',
      '**🎲 Sorprendeme** sortea una combinación, y **Mis estilos** guarda las que te gustan. Sirve para que tu PDF no sea igual al de otro colega que usa la app.',
      'Ahí también elegís si la app se ve clara u oscura.',
    ],
    ir:{ tab:'empresa', sub:'estilo', sel:['#estilo-propio', '#theme-presets'] },
    rel:['negocio'] },

  { id:'numeracion', g:'config', t:'Numeración y validez',
    kw:'numero numeros numeracion prefijo correlativo proximo validez dias vigencia vencimiento vence',
    txt:[
      '**Numeración** (en Configuración → Estilo): el prefijo, por ejemplo el año, y el próximo número. La app sigue el correlativo sola; cambialo solo si venías numerando de otra forma, y tocá **Aplicar configuración de numeración**.',
      '**Validez**: cuántos días dura un presupuesto. El vencimiento se calcula desde la fecha de emisión, y de ahí salen los avisos de vencidos.',
    ],
    ir:{ tab:'empresa', sub:'estilo', sel:['#num-prefix'] },
    rel:['vencidos'] },

  { id:'push', g:'config', t:'Avisos con la app cerrada',
    kw:'notificaciones notificacion avisos push alarma alerta alertas celular cerrada resumen noche anterior probar silencio molestar',
    txt:[
      'En Configuración → Textos → **Avisos con la app cerrada** activás las notificaciones del teléfono, que llegan aunque no tengas la app abierta:',
      { ul:[
        'Resumen del día y aviso la noche anterior, con los trabajos y visitas.',
        'Seguimientos y vencidos.',
        'Visitas y recordatorios con hora, con la anticipación que elijas (30 min, 1 h o 2 h).',
        'Días sin avisos, para descansar.',
      ] },
      'Tocar una notificación te lleva directo al día o al presupuesto. **Probar notificaciones** confirma que llegan.',
      'Con la app abierta, lo pendiente está siempre en la campanita 🔔.',
    ],
    ir:{ tab:'empresa', sub:'textos', sel:['#push-section', '#fu-section'],
      nota:'Los avisos con la app cerrada todavía no están disponibles en este teléfono.' },
    rel:['pestanas'] },

  { id:'backup', g:'config', t:'Copia de seguridad',
    kw:'backup copia de seguridad respaldo drive google restaurar exportar importar telefono nuevo celular nuevo cambiar perder datos espacio memoria lleno',
    txt:[
      'Como los datos viven en el teléfono, la copia es tu seguro. En Configuración → Datos:',
      { ul:[
        '**Google Drive**: conectás tu cuenta una vez y la app sube una copia sola cada vez que algo cambia (con señal). En un teléfono nuevo, **Restaurar** la trae de vuelta.',
        '**Archivo**: **Exportar…** descarga un backup que podés guardar donde quieras, e **Importar…** lo restaura.',
        '**Espacio en este dispositivo**: cuánto ocupan tus datos del lugar disponible.',
      ] },
      'La copia incluye las fotos.',
    ],
    ir:{ tab:'empresa', sub:'datos', sel:['#gdrive-section', '#backup-file-section'] },
    rel:['que-es'] },
];

// Glosario: términos propios de la app. Van al mismo buscador.
const AYUDA_GLOSARIO = [
  { id:'g-ir-a-ver', t:'Ir a ver', d:'Estado de un presupuesto que todavía no se cotizó: hay que ir al lugar a evaluar.', rel:['estados'] },
  { id:'g-borrador', t:'Borrador', d:'Presupuesto que estás armando y todavía no mandaste.', rel:['estados'] },
  { id:'g-enviado', t:'Enviado', d:'Presupuesto que ya tiene el cliente. Desde ahí cuentan el seguimiento y el vencimiento.', rel:['estados'] },
  { id:'g-aceptado', t:'Aceptado', d:'El cliente dijo que sí. Falta hacer el trabajo; se agenda en la Agenda.', rel:['estados', 'agendar'] },
  { id:'g-realizado', t:'Realizado', d:'El trabajo está hecho. Es el momento de cobrar y facturar.', rel:['estados', 'recibo'] },
  { id:'g-control', t:'Control en sitio', d:'Hay que volver al lugar a controlar cómo evoluciona el árbol.', rel:['estados'] },
  { id:'g-perdido', t:'Perdido', d:'El trabajo no se hizo: el cliente dijo que no o eligió a otro.', rel:['estados'] },
  { id:'g-vencido', t:'Vencido', d:'Enviado cuya fecha de validez ya pasó sin que marques qué pasó. No es lo mismo que perdido.', rel:['vencidos'] },
  { id:'g-esperando', t:'Esperando respuesta', d:'Enviado que todavía está vigente: el cliente puede contestar.', rel:['conversion'] },
  { id:'g-respondidos', t:'De los respondidos', d:'Porcentaje de aceptados contando solo los presupuestos que ya tienen respuesta: aceptados, perdidos y vencidos.', rel:['conversion'] },
  { id:'g-estimativo', t:'Estimativo', d:'Presupuesto hecho con fotos, sin ver el lugar: un valor de referencia que se confirma en la visita.', rel:['modos'] },
  { id:'g-directo', t:'Trabajo directo', d:'Trabajo chico para un cliente, registrado sin presupuesto. Suma como venta.', rel:['sin-presupuesto'] },
  { id:'g-colab', t:'Colaboración', d:'Jornada de trabajo para un colega que te llamó. La paga el colega, así que no suma como venta tuya.', rel:['sin-presupuesto'] },
  { id:'g-version', t:'Versión', d:'Presupuesto nuevo hecho a partir de uno vencido, con su número "-v2" y precios actualizados.', rel:['versiones'] },
  { id:'g-escenario', t:'Escenario', d:'Cada una de las dos opciones (A y B) de un mismo presupuesto, con su lista de trabajos y su total.', rel:['escenarios'] },
  { id:'g-recargo', t:'Recargo', d:'Porcentaje que se suma a todos los precios, por ejemplo por viáticos.', rel:['ajustes'] },
];

// Palabras que no dicen qué se busca ("¿dónde está el botón de…?").
const AYUDA_VACIAS = new Set(('de del la el los las un una unos unas para que como en y o a al mi mis me se lo le con por '
  + 'boton botones pestana pestanas tab donde hago hacer quiero puedo sirve funcion funciones esta es cual son hay '
  + 'ver usar uso app aplicacion').split(' '));

// Palabras del día a día → las que usan los artículos.
const AYUDA_SINONIMOS = {
  laburo:['trabajo'], changa:['trabajo'], cotizacion:['presupuesto'], cotizar:['presupuesto'],
  mandar:['enviar'], mando:['enviar'], mandarlo:['enviar'], mandarle:['enviar'], pasar:['enviar'], plata:['cobro', 'factura'], cobrar:['cobro', 'recibo'],
  sena:['cobro', 'pago'], anticipo:['cobro', 'pago'], celu:['celular'], copia:['backup'],
  respaldo:['backup'], alarma:['notificaciones'], lluvia:['clima'], gps:['ubicacion'],
  borrar:['deshacer'], plantilla:['mensaje'], tasa:['conversion'], efectividad:['conversion'], porcentaje:['conversion'],
};

function _ayudaNorm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
// Plural → singular, a lo bruto: "enviados" encuentra "enviado".
function _ayudaRaiz(w) {
  return w.length > 4 ? w.replace(/(es|s)$/, '') : w;
}
function _ayudaPlano(txt) {
  return (txt || []).map(p => typeof p === 'string' ? p : (p.ul || p.ol || []).join(' ')).join(' ');
}

// Índice: cada artículo con sus campos tokenizados y el peso de cada campo.
let _ayudaIdx = null;
function _ayudaIndice() {
  if (_ayudaIdx) return _ayudaIdx;
  const grupoT = (g) => (AYUDA_GRUPOS.find(x => x.k === g) || {}).t || '';
  const tok = (s) => _ayudaNorm(s).split(' ').filter(Boolean);
  const arts = AYUDA.concat(AYUDA_GLOSARIO.map(x => ({ id:x.id, g:'glosario', t:x.t, kw:'', txt:[x.d], rel:x.rel })));
  _ayudaIdx = arts.map(a => ({
    a,
    // El título de un término del glosario pesa menos que el de un artículo:
    // quien busca "enviados" quiere el artículo de los estados, y la
    // definición de "Enviado" sale igual, debajo.
    campos: [[tok(a.t), a.g === 'glosario' ? 3 : 6], [tok(a.kw), 4], [tok(grupoT(a.g)), 3], [tok(_ayudaPlano(a.txt)), 1]],
  }));
  return _ayudaIdx;
}
function _ayudaArt(id) {
  const x = _ayudaIndice().find(i => i.a.id === id);
  return x ? x.a : null;
}

// Peso del mejor campo donde aparece alguna de las variantes de un término.
function _ayudaPeso(campos, variantes) {
  let best = 0;
  campos.forEach(([toks, w]) => {
    if (w <= best) return;
    const hay = toks.some(t => variantes.some(v => t.startsWith(v) || (t.length >= 4 && v.startsWith(_ayudaRaiz(t)))));
    if (hay) best = w;
  });
  return best;
}

// Busca en el índice. Cada término tiene que aparecer (Y); si así no hay
// nada, alcanza con alguno (O) y el resultado se marca `parcial`.
function ayudaBuscar(q) {
  const terms = _ayudaNorm(q).split(' ').filter(w => w && !AYUDA_VACIAS.has(w));
  if (!terms.length) return { arts: [], parcial: false, vacia: true };
  const vars = terms.map(w => [_ayudaRaiz(w)].concat(AYUDA_SINONIMOS[w] || []));
  const puntuar = (todos) => _ayudaIndice().map((x, i) => {
    const pesos = vars.map(v => _ayudaPeso(x.campos, v));
    const ok = todos ? pesos.every(p => p > 0) : pesos.some(p => p > 0);
    return ok ? { a: x.a, s: pesos.reduce((s, p) => s + p, 0), i } : null;
  }).filter(Boolean).sort((p, r) => (r.s - p.s) || (p.i - r.i)).map(r => r.a);
  let arts = puntuar(true), parcial = false;
  if (!arts.length && terms.length > 1) { arts = puntuar(false); parcial = arts.length > 0; }
  return { arts, parcial, vacia: false };
}

// ── PANTALLA ────────────────────────────────────────────────────
let _ayudaGrupo = '';      // filtro por chip ('' = todos)
let _ayudaAbierto = '';    // artículo desplegado
let _ayudaTimer = null;

function _ayudaFmt(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}
function _ayudaCuerpoHTML(a) {
  const partes = (a.txt || []).map(p => {
    if (typeof p === 'string') return `<p>${_ayudaFmt(p)}</p>`;
    const tag = p.ol ? 'ol' : 'ul';
    return `<${tag}>${(p.ol || p.ul).map(li => `<li>${_ayudaFmt(li)}</li>`).join('')}</${tag}>`;
  });
  if (a.ir) partes.push(`<button type="button" class="btn btn-p btn-sm ayuda-ir" onclick="ayudaIr('${a.id}')">Llevame ahí ›</button>`);
  const rel = (a.rel || []).map(_ayudaArt).filter(Boolean);
  if (rel.length) {
    partes.push(`<div class="ayuda-rel"><span>Ver también:</span> ${rel.map(r =>
      `<button type="button" class="ayuda-rel-a" onclick="ayudaVer('${r.id}')">${esc(r.t)}</button>`).join('')}</div>`);
  }
  return partes.join('');
}
function _ayudaArtHTML(a, conGrupo) {
  const abierto = a.id === _ayudaAbierto;
  const g = conGrupo ? `<span class="ayuda-art-g">${esc((AYUDA_GRUPOS.find(x => x.k === a.g) || {}).t || '')}</span>` : '';
  return `<div class="ayuda-art${abierto ? ' is-open' : ''}" data-ayuda="${a.id}">
    <button type="button" class="ayuda-art-h" onclick="ayudaToggle('${a.id}')" aria-expanded="${abierto}">
      <span class="ayuda-art-t">${esc(a.t)}</span>${g}<span class="ayuda-art-chev" aria-hidden="true">▾</span>
    </button>
    ${abierto ? `<div class="ayuda-art-b">${_ayudaCuerpoHTML(a)}</div>` : ''}
  </div>`;
}

function ayudaRender() {
  const box = document.getElementById('ayuda-res');
  const chips = document.getElementById('ayuda-chips');
  if (!box) return;
  const inp = document.getElementById('ayuda-q');
  const q = inp ? inp.value : '';
  if (chips) {
    chips.innerHTML = [{ k:'', t:'Todo' }].concat(AYUDA_GRUPOS).map(g =>
      `<button type="button" class="ayuda-chip${g.k === _ayudaGrupo ? ' is-active' : ''}" onclick="ayudaFiltro('${g.k}')">${esc(g.t)}</button>`).join('');
  }
  const r = ayudaBuscar(q);
  if (!r.vacia) {
    if (!r.arts.length) {
      box.innerHTML = `<p class="ayuda-vacio">No encontré nada con «${esc(q.trim())}». Probá con otra palabra, por ejemplo "PDF", "vencidos", "backup" o "clima".</p>`;
      return;
    }
    // Con una búsqueda, el mejor resultado se abre solo.
    if (!r.arts.some(a => a.id === _ayudaAbierto)) _ayudaAbierto = r.arts[0].id;
    const lista = _ayudaGrupo ? r.arts.filter(a => a.g === _ayudaGrupo) : r.arts;
    const aviso = r.parcial ? '<p class="ayuda-nota">No encontré todas las palabras juntas; esto es lo más parecido:</p>' : '';
    box.innerHTML = aviso + (lista.length
      ? lista.map(a => _ayudaArtHTML(a, true)).join('')
      : '<p class="ayuda-vacio">En este grupo no hay resultados. Tocá "Todo".</p>');
    return;
  }
  const grupos = _ayudaGrupo ? AYUDA_GRUPOS.filter(g => g.k === _ayudaGrupo) : AYUDA_GRUPOS;
  box.innerHTML = grupos.map(g => {
    const arts = _ayudaIndice().map(x => x.a).filter(a => a.g === g.k);
    return `<div class="ayuda-grupo"><div class="ayuda-grupo-t">${esc(g.t)}</div>${arts.map(a => _ayudaArtHTML(a, false)).join('')}</div>`;
  }).join('');
}

function ayudaBuscarDebounced() {
  clearTimeout(_ayudaTimer);
  _ayudaTimer = setTimeout(ayudaRender, 150);
}
function ayudaFiltro(g) {
  _ayudaGrupo = AYUDA_GRUPOS.some(x => x.k === g) ? g : '';
  ayudaRender();
}
function ayudaToggle(id) {
  _ayudaAbierto = (_ayudaAbierto === id) ? '' : id;
  ayudaRender();
  const el = document.querySelector(`#ayuda-res [data-ayuda="${id}"]`);
  if (el && _ayudaAbierto && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
}

// Abre un artículo desde cualquier lado (los "Ver también", y en el
// futuro los "?" de cada pantalla).
function ayudaVer(id) {
  const a = _ayudaArt(id);
  if (!a) return;
  if (!document.querySelector('#panel-empresa.active')) switchTab('empresa');
  switchSubtab('ayuda');
  const inp = document.getElementById('ayuda-q');
  if (inp) inp.value = '';
  _ayudaGrupo = '';
  _ayudaAbierto = id;
  ayudaRender();
  const el = document.querySelector(`#ayuda-res [data-ayuda="${id}"]`);
  if (el) { el.scrollIntoView({ block: 'start' }); _irFlash(el); }
}

const _ayudaVisible = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
// Un <select> reemplazado por el desplegable propio (js/dropdown.js) queda de
// 1 px e invisible: lo que se ve, y lo que tiene que destellar, es su botón.
const _ayudaLoQueSeVe = (el) => (el && el._cselBtn) ? el._cselBtn : el;

// En las vistas Fichas y Etapas la sección puede estar plegada o en otra
// etapa: se abre la primera de la lista que exista en el modo actual.
function _ayudaAbrirSeccion(secs) {
  const vista = currentVistaEditor();
  const key = secs.find(k => { const w = document.getElementById('esec-' + k); return w && !w.hidden; });
  if (!key) return;
  if (vista === 'fichas') { _esecOpen = key; editorShellSync(); }
  else if (vista === 'consola') {
    const et = EDITOR_ETAPAS.find(e => e.secs.indexOf(key) >= 0);
    if (et) editorSetEtapa(et.key);
  }
}

// "Llevame ahí": cambia a la pestaña del artículo, abre lo que haga falta y
// hace destellar el elemento del que habla.
function ayudaIr(id) {
  const a = _ayudaArt(id);
  if (!a || !a.ir) return;
  const ir = a.ir;
  switchTab(ir.tab);
  if (ir.sub) switchSubtab(ir.sub);
  if (ir.sec) _ayudaAbrirSeccion(ir.sec);
  if (ir.cs) {
    const cs = document.getElementById(ir.cs);
    if (cs && !cs.classList.contains('is-open')) toggleCollapsibleSection(ir.cs);
  }
  if (ir.avisos && typeof histAvisosToggle === 'function') histAvisosToggle(true);
  const sels = ir.sel || [];
  let idx = -1, el = null;
  sels.some((s, i) => {
    const hit = [...document.querySelectorAll(s)].map(_ayudaLoQueSeVe).find(_ayudaVisible);
    if (hit) { idx = i; el = hit; }
    return !!hit;
  });
  if (el) {
    el.scrollIntoView({ block: 'center' });
    _irFlash(el);
  }
  if (idx !== 0 && ir.nota) toast(ir.nota, 'info', 4500);
}
