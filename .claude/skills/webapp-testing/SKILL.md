---
name: webapp-testing
description: Manejar y testear Presupuestos AR en un navegador headless real (screenshots, inspección del DOM, logs de consola, vista previa y PDF de los 3 modos). Usar cuando el usuario pida ver cómo queda un cambio, sacar una captura, validar la vista previa o el documento PDF, depurar un comportamiento de UI, o confirmar visualmente que algo funciona. Adaptación de la skill oficial anthropics/skills/webapp-testing al stack del repo (chrome-headless-shell + puppeteer-core, ya instalados por el SessionStart hook).
---

# Testing visual de Presupuestos AR (headless)

El SessionStart hook (`.claude/hooks/session-start.sh`) deja listos:
- `$PUPPETEER_EXECUTABLE_PATH` → binario `chrome-headless-shell`
- `$NODE_PATH` → `node_modules` con `puppeteer-core`

> No usamos Python/Playwright (la network policy bloquea la descarga de navegadores).
> Usamos el navegador y puppeteer-core que ya provee el entorno.

## Comportamiento PWA primero
Para SW / cache / offline ya existe un test dedicado — no reinventarlo:
```bash
node test/pwa.test.cjs
```
Esta skill es para lo **visual e interactivo** (cómo se ve y se comporta la UI).

## Script disponible (caja negra)
`scripts/app-shot.cjs` — sirve el repo por HTTP (necesario para que registre el SW),
abre `index.html`, opcionalmente inyecta un setup JS, y saca una captura. Corré
`--help` primero; no leas el fuente salvo que necesites algo a medida.

```bash
node .claude/skills/webapp-testing/scripts/app-shot.cjs --help
```

## Patrón recomendado: reconocimiento, luego acción
1. **Captura inicial** para ver el estado renderizado:
   ```bash
   node .claude/skills/webapp-testing/scripts/app-shot.cjs --out /tmp/app.png --full
   ```
   Después abrí `/tmp/app.png` con la herramienta Read para mirarla.
2. **Identificá selectores** desde lo que ves.
3. **Ejecutá acciones / setup** con `--setup` (un archivo JS que corre en la página
   antes de capturar) o `--eval "<js>"` para una línea.

## Validar la vista previa y el PDF (los 3 modos)
La app arma el documento con `buildDoc()` → deriva a `buildEstDoc()`/`buildRiskDoc()`
según `S.isEstimative`/`S.isRisk`. Para capturar cada modo, seteá `S` y forzá el render
en un archivo de setup. Ejemplo (`/tmp/setup-riesgo.js`):
```js
// Se ejecuta dentro de la página, en el ámbito global del <script>.
S.isRisk = true; S.isEstimative = false;
// ...completá S con datos mínimos de prueba si hace falta...
if (typeof restoreUI === 'function') restoreUI();
if (typeof renderPreview === 'function') renderPreview(); // o la fn de vista previa real
```
```bash
node .claude/skills/webapp-testing/scripts/app-shot.cjs \
  --setup /tmp/setup-riesgo.js --selector ".doc-a4-screen" --out /tmp/riesgo.png
```
Repetir para Normal (`isRisk=false,isEstimative=false`) y Estimativo (`isEstimative=true`).

> Tip: si no estás seguro del nombre de la función de render o del selector del
> documento en pantalla, buscalos primero:
> `grep -n "doc-a4-screen\|renderPreview\|function build.*Doc" index.html`

## Logs de consola
`--logs` imprime los `console.*` y errores de página (útil para depurar). Los errores
de recursos externos bloqueados por la network policy son esperables e ignorables.

## Buenas prácticas
- Siempre `--help` antes de usar el script.
- Servir por HTTP (lo hace el script) — `file://` no registra el Service Worker.
- Esperá a que la app renderice (`networkidle` / un selector) antes de capturar.
- Cerrá siempre el navegador (el script lo hace solo).
