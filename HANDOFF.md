# HANDOFF — Auditoría de estilos y temas (Presupuestos AR)

> Documento de traspaso para continuar en otra sesión de Claude Code.
> Última actualización: 2026-06-08.

## Contexto de la tarea
Se pidió una **auditoría completa de la sección de estilos y temas** del proyecto
(`index.html`, un único archivo con todo el CSS/JS) para detectar problemas que
afecten el uso cotidiano, listarlos, e ir implementando con aprobación.

## Estado del repo
- **Rama de trabajo:** `claude/styles-themes-audit-99fkui`
- **`main`:** ya tiene los 3 commits de esta sesión desplegados (Cloudflare auto-deploy).
- **`CACHE_VERSION` actual:** `presupuesto-v26` (en `sw.js` y documentado en `CLAUDE.md`).
- **Árbol limpio.**

### Commits en `main` (esta sesión), del más nuevo al más viejo
| Hash | Qué |
|---|---|
| `1a69e30` | Refactor PDF: fuente única de estilos (impresión + vista previa) |
| `a1aa582` | Color de marca coherente, `color-scheme:light`, limpieza de marcadores |
| `7f3c12b` | Fix `--card` indefinida + coherencia color de marca + doc |

> Base previa de la sesión: `1f491a0` (feat: 4 temas de diseño PDF).
> Para revertir un cambio puntual: `git revert <hash>`.

### Solo en la rama (NO en main, no se despliega)
- `test-preview.html` — banco de pruebas autónomo del refactor PDF (fuente única
  de estilos). Sirve para verificar en navegador que vista previa == PDF impreso,
  con selector de tema/color y modos Normal/Estimativo. Útil si se vuelve a tocar
  el documento.
- `HANDOFF.md` — este archivo.

## Lo que se hizo (✅ todo en main)

### A — Refactor: fuente única de estilos del PDF (`1a69e30`)
**Problema:** los estilos del documento (`.pdoc`, `.ph`, `.ptable`, `.ptotals`,
`.pobs`, `.pcrit`, `.pest-*`, etc.) estaban **duplicados**: una copia dentro de
`@media print` y otra prefijada con `.doc-preview-host` (vista previa en pantalla).
Divergían con facilidad y el segundo bloque estaba auto-generado/ilegible.

**Solución:** una sola definición en ámbito **global**.
- Tokens del documento en `#doc-a4,.doc-a4-screen{...}` (sirven a impresión y preview).
- `@media print` quedó mínimo: solo `@page`, ocultar UI (`#app`, overlays…),
  `#print-zone{display:block}` y `print-color-adjust`.
- Se borró el bloque `.doc-preview-host` completo + duplicados de `.pphotos` y temas.
- **−254 líneas / ~18 KB** de CSS. Sin cambios visuales esperados.

**Por qué es seguro globalizar:** las clases `.pdoc/.ph/.ptable/...` SOLO aparecen
dentro del JS que arma el PDF (`buildDoc`/`buildEstDoc`/`buildRiskDoc`, ~línea 6850+),
y se renderizan dentro de `#doc-a4` (oculto fuera de impresión) o `.doc-a4-screen`
(preview). No colisionan con la UI de la app.

**DOM relevante:**
- Impresión: `#print-zone > #doc-a4` (display:none salvo en `@media print`).
- Preview: `.doc-preview-paper > .doc-preview-host > .doc-a4-screen#doc-preview-content`.
  `previewCurrent()`/`previewFromHistory()` copian `#doc-a4.innerHTML` al `#doc-preview-content`
  y `_scalePreview()` escala el papel 210mm para que entre en pantalla.

### B — Color de marca coherente (`a1aa582`)
El `--accent` de pantalla se setea dinámicamente con el color elegido por el usuario
(`applyAccent()` en JS, llamado desde `applyColor()` y `restoreUI()`). Antes solo
cambiaba `--accent`; ahora también deriva tonos coherentes para que NO queden restos
verdes con colores personalizados:
- `--accent-light` (tinte claro: hovers, chips, badges, fondos suaves)
- `--accent-rgb` (sombras y anillos de foco vía `rgba(var(--accent-rgb),α)`)
- `--accent-dark` (hover de `.btn-p`)
- `--accent-2` (segundo stop de gradientes: `#est-banner`, `.fact-hero`)

Para el **verde por defecto** (`#064e3b`) se hace `removeProperty` y rige el CSS de
`:root` (look idéntico al original). Helpers: `_hexToRgb`, `_mixWhite`, `_mixBlack`.

### C — `color-scheme:light` en `:root`
Evita inversiones impredecibles del modo oscuro forzado del SO.

### D — Limpieza
- `--card` agregada a `:root` (`#ffffff`); estaba referenciada sin definir.
- Eliminados 13 comentarios marcadores (`===== js/css =====`) duplicados.

## Pendiente / posibles próximos pasos

### Verificación manual (lo más importante)
Probar en uso real **vista previa + Guardar PDF** en los **3 modos** (Normal,
Estimativo, Riesgo) con distintos temas y colores. El refactor A no pudo verificarse
con navegador en el entorno de Claude. Si algo se ve mal: `git revert 1a69e30`.

Checklist:
- [ ] Vista previa en pantalla == PDF impreso (tipografía, colores, márgenes).
- [ ] 4 temas OK (Clásico, Profesional, Cálido, Minimalista).
- [ ] Color de marca tiñe solo los 3 puntos correctos (nombre, número, caja total).
- [ ] A4 con pie "Página X de Y"; firmas/pie sin cortar.

### Mejoras NO hechas (documentadas, decisión del dueño)
- **Verdes decorativos pálidos** en controles secundarios que aún no siguen el color
  de marca: `.phrase-btn` (`#f0f9f4`/`#bbf7d0`/`#dcfce7`), `.quick-services` (`#f0f9f4`).
  Se dejaron para no alterar el look por defecto; son menores. Si se quiere coherencia
  total con colores personalizados, rutearlos a `--accent-light` (cambiaría el default).
- **Modo oscuro real**: hoy solo se fija `color-scheme:light`. No hay dark theme.

## Reglas del proyecto que NO romper (de `CLAUDE.md`)
- **Sin build/frameworks**: JS vanilla, todo en un `index.html`. No pasar a módulos ES
  (rompería los `onclick` globales).
- **Subir `CACHE_VERSION`** en `sw.js` en cada cambio desplegado (formato `presupuesto-vNN`).
- No cambiar las claves de `localStorage` (objeto `LS` y constantes de DBs).
- Fechas en LOCAL (`today()`/`toLocalISODate()`), nunca `toISOString()` para calendario.
- Escapar datos de usuario con `esc()` antes de `innerHTML`.
- No incluir `client_secret` de Google; no pedir token al abrir la app.

## Cómo verificar cambios (sin romper)
**Sintaxis JS** (aislar el `<script>` inline):
```bash
python3 - <<'PY'
import re, subprocess, sys
html = open('index.html', encoding='utf-8').read()
js = "\n;\n".join(re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S))
open('/tmp/app_check.js','w',encoding='utf-8').write(js)
sys.exit(subprocess.run(['node','--check','/tmp/app_check.js']).returncode)
PY
```
**Balance de llaves CSS** (sanity tras editar estilos):
```bash
python3 - <<'PY'
import re
css = re.search(r'<style>(.*?)</style>', open('index.html',encoding='utf-8').read(), re.S).group(1)
print(css.count('{'), css.count('}'))   # deben coincidir
PY
```

## Mapa rápido del CSS en `index.html`
- `:root` (vars, incluye accent + derivados + `--card` + `color-scheme`): ~línea 25.
- Componentes de la app (botones, items, toggles, etc.): hasta ~877.
- `@media print` (ahora mínimo: `@page` + ocultar UI): ~889.
- **DOCUMENTO — fuente única** (`#doc-a4,.doc-a4-screen` + `.pdoc` family): tras el
  `@media print`, marcado con el comentario `── DOCUMENTO (.pdoc) — FUENTE ÚNICA ──`.
- Facturación (`.fact-*`): tras el bloque del documento.
- Chrome de la vista previa (`.doc-preview-overlay/-bar/-scroll/-paper`,
  `.doc-preview-host{display:block}`): ~1255.
- Íconos SVG del doc (`.pdf-ic`), registro fotográfico (`.pphotos`): ~1527+.
- Modo riesgo (`.section-card`, `.prisk-*`) — `css/risk.css`: ~1577+.
- Temas PDF (`.pdoc.pdoc-theme-*`): al final del `<style>`.

Buscar anclas estables con: `grep -n "===== js/\|===== css/\|FUENTE ÚNICA" index.html`.
