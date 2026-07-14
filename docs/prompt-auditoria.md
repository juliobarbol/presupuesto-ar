# Prompt: Auditoría integral de Presupuestos AR

> Copiá todo lo que sigue (desde "## PROMPT") en una sesión nueva de Claude Code
> sobre este repo. También podés pedirle directamente:
> _"Realizá la auditoría siguiendo `docs/prompt-auditoria.md`"_.

---

## PROMPT

Realizá una **auditoría integral de solo lectura** de esta app (Presupuestos AR,
PWA offline-first en un único `index.html`, ver `CLAUDE.md`). **No modifiques
código de la app**: el entregable es un informe. Solo podés escribir el archivo
del informe y scripts temporales de verificación en el scratchpad.

### Reglas de trabajo

1. Leé primero `CLAUDE.md` completo: ahí están la arquitectura, las convenciones
   y las secciones del código. Navegá el `index.html` (~13.700 líneas) por los
   marcadores `// ===== js/<nombre>.js =====` (`grep -n "===== js/" index.html`),
   no por números de línea.
2. Cada hallazgo debe tener **evidencia concreta**: referencia `archivo:línea`,
   fragmento de código, y cuando sea posible una **reproducción** (script de
   node o del navegador headless — hay `chrome-headless-shell` + `puppeteer-core`
   instalados por el SessionStart hook; mirá `test/pwa.test.cjs` como ejemplo de
   cómo lanzarlo). No reportes nada que no hayas verificado en el código real.
3. Clasificá cada hallazgo por severidad:
   - **Crítico**: pérdida de datos del usuario, XSS explotable, rotura del
     backup/restore, monto de presupuesto mal calculado.
   - **Alto**: bug funcional en un flujo principal, fuga de datos, offline roto.
   - **Medio**: bug en flujo secundario, riesgo latente, degradación de
     rendimiento perceptible.
   - **Bajo**: calidad de código, inconsistencias, mejoras sugeridas.
4. Priorizá profundidad sobre cobertura superficial: mejor 10 hallazgos
   verificados que 40 sospechas.

### Áreas a auditar (en este orden)

**A. Integridad y persistencia de datos (máxima prioridad — no hay backend, los
datos del usuario viven solo en su dispositivo)**
- Toda escritura a `localStorage` pasa por `safeSetLS()`? Buscar
  `localStorage.setItem` directos que esquiven el manejo de cuota.
- Claves de `localStorage`: ¿todas centralizadas (`LS`, `SPECIES_KEY`,
  `SERVICES_KEY`, `CLIENT_KEY`, `PHRASE_KEYS`, …)? ¿Alguna clave hardcodeada
  duplicada o con typo?
- Ciclo backup/restore: ¿`buildBackupObject()` incluye TODO lo que la app
  persiste (historial, clientes, especies, servicios, frases, notas de agenda,
  facturación, config, fotos)? ¿`applyBackupObject()` restaura todo eso de forma
  simétrica? Enumerá cada clave persistida y verificá que esté en ambos lados.
  Un dato que se persiste pero no entra al backup = hallazgo Crítico.
- Fotos en IndexedDB (`js/photos.js`): manejo de errores de IDB, migración
  `migrateInlinePhotosToIDB()`, ¿puede quedar un `item.photo` huérfano (ID sin
  binario) tras un restore parcial o un borrado? ¿`restorePhotosFromBackup()`
  cubre todos los casos?
- Import de JSON: ¿se valida la estructura antes de aplicar? ¿Un JSON malformado
  o de una versión vieja puede dejar el estado corrupto a mitad de aplicación?

**B. Correctitud de cálculos (dinero y fechas)**
- Dinero: ¿todo opera en centavos vía `moneyToCents`/`centsToMoney`/`fmtM`?
  Buscar aritmética con floats de pesos (sumas, recargos, porcentajes,
  escenarios A/B, tope anual de facturación). Un redondeo mal hecho = Crítico.
- Fechas: ¿queda algún `toISOString().slice(0,10)` u otro uso de UTC para
  fechas de calendario? (corre el día en Argentina, UTC-3). Verificar
  `today()`/`toLocalISODate()`/`calcExpiry()` y todos los cálculos de
  vencimiento, recontacto y agenda (`js/calendar.js`, `js/history.js`).
- Numeración de presupuestos: ¿puede duplicarse o saltearse?

**C. Seguridad**
- XSS: auditar TODOS los puntos donde datos del usuario entran a `innerHTML`
  (o `insertAdjacentHTML`, atributos `onclick` generados, etc.) y verificar que
  pasen por `esc()`. Datos del usuario = nombre de cliente, dirección, especies,
  servicios, frases, notas, nombres de archivo importados, contenido de un
  backup JSON importado (un backup ajeno es input no confiable). Probá un
  payload real si podés.
- Google Drive (módulo GDRIVE en `js/exportimport.js`): manejo del token
  (¿se persiste? ¿dónde?), scopes pedidos, que NO haya `client_secret` en el
  repo, que no se pida token al abrir la app (solo silencioso con `login_hint`,
  interactivo solo desde botones).
- `push-worker/index.js`: exposición de endpoints, validación de origen,
  manejo de claves VAPID.
- Dependencias en `vendor/` (html2pdf, leaflet): versiones, CVEs conocidos.
- Datos sensibles en URLs, logs de consola, o en el `.ics` exportado.

**D. PWA / offline / Service Worker (`sw.js`)**
- ¿`APP_SHELL` incluye todos los archivos que la app necesita offline
  (fonts.css, fuentes, vendor/, iconos)? Cruzar contra los recursos que
  `index.html` realmente referencia. Un recurso referenciado y no cacheado =
  offline roto (Alto).
- Estrategia de cache y flujo de actualización: ¿puede un usuario quedar
  atrapado en una versión vieja? ¿Se limpia la cache anterior?
- Correr `node test/pwa.test.cjs` y reportar el resultado.
- `manifest.webmanifest`: íconos, `share_target` si existe, coherencia con
  `docs/apk-twa.md` y `.well-known/assetlinks.json`.

**E. Robustez y manejo de errores**
- `try/catch` que tragan errores silenciosamente en flujos donde el usuario
  necesita enterarse (guardado, backup, export PDF).
- Estados a medio guardar: ¿qué pasa si la app se cierra en medio de una
  operación multi-paso (import, migración de fotos, backup a Drive)?
- `navigator.onLine` y el listener `online`: ¿el backup pendiente a Drive
  realmente se sube al volver la conexión en todos los caminos?

**F. Rendimiento (celulares de gama baja, uso en campo)**
- Tamaño y peso: `index.html` ~700 KB, fotos como dataURL en memoria
  (`hydratePhotoCache()`): ¿cuánta memoria puede consumir con un historial
  grande? ¿Hay re-render completo de listas largas (historial, agenda, mapa)
  en cada cambio?
- Búsquedas/filtros sobre el historial: ¿lineales sobre todo el dataset en cada
  tecla?

**G. Calidad de código (severidad Baja, al final)**
- Código muerto, funciones duplicadas entre secciones, inconsistencias con las
  convenciones de `CLAUDE.md`.

### Entregable

Escribí el informe en `docs/auditoria-<fecha>.md` con esta estructura:

1. **Resumen ejecutivo** (10 líneas máx.): estado general y los 3–5 hallazgos
   más importantes.
2. **Tabla de hallazgos**: ID, severidad, área, título, archivo:línea.
3. **Detalle por hallazgo**: evidencia (código citado), impacto concreto para
   el usuario (un podador con la app en el celular), reproducción si la hay, y
   recomendación de fix (sin implementarlo).
4. **Lo que está bien**: prácticas del código que conviene conservar.
5. **Plan de remediación sugerido**: orden de ataque en tandas pequeñas
   (recordar que cada deploy requiere subir `CACHE_VERSION` en `sw.js`).

Al terminar: commiteá **solo el informe** en la rama de trabajo, pushealo y
mergealo a `main` según el flujo de `CLAUDE.md`. No toques `index.html` ni
`sw.js` en esta sesión — los fixes se harán en sesiones posteriores, por tandas,
usando el informe como guía.
