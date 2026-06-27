---
name: nuevo-tema-pdf
description: Crear un nuevo diseño/tema para el PDF de presupuestos (o un modificador de densidad estilo "Compacto"). Usar cuando el usuario pida agregar un estilo distinto para los presupuestos, un tema nuevo del documento, otro look del PDF, o cambiar la estética del documento impreso/exportado.
---

# Crear un tema nuevo para el PDF de presupuestos

Receta para agregar un diseño de documento sin romper la arquitectura existente.
Toda la app vive en `index.html` (HTML + `<style>` + `<script>`). No hay build.

## Modelo mental: 2 capas + 1 modificador

| Capa | Qué controla | Cómo se aplica |
|---|---|---|
| `accentColor` | Color de marca (verde, azul…) | Inline desde JS en 3 lugares: nombre del emisor, número de presupuesto, caja del Costo Total. Picker libre. |
| `pdfTheme` | Tipografía, paleta y estructura del encabezado | Clase `pdoc-theme-X` sobre `<table class="pdoc">`. Es un string libre, se persiste como parte de `S`. |
| `pdfCompact` | Densidad (fuentes/paddings más chicos) | **Ortogonal** al tema: clase extra `pdoc-compact`. Es un boolean en `S`. |

Temas existentes (úsalos como referencia): `clasico`, `profesional`, `calido`,
`minimalista`, `lateral`, `tecnico`, `elegante`.

Anclas rápidas:
```bash
grep -n "pdoc-theme-" index.html        # bloques CSS de cada tema
grep -n "_buildDocHeader" index.html    # builder del encabezado
grep -n 'data-theme=' index.html        # botones de la UI
grep -n "function applyPdfTheme" index.html
```

## Pasos para un tema NUEVO (solo cambia CSS/encabezado)

### 1. CSS del tema
Agregá un bloque al final de los temas, **antes de `</style>`** (después del bloque
`.pdoc.pdoc-theme-elegante` / `.pdoc.pdoc-compact`). Sobreescribí los design tokens
y, si hace falta, selectores puntuales. El selector base es `.pdoc.pdoc-theme-X`.

```css
.pdoc.pdoc-theme-MITEMA {
  --c-bg-soft:  #...;   /* fondo suave de thead/observaciones */
  --c-zebra:    #...;   /* (reservado) */
  --c-divider:  #...;   /* líneas fuertes */
  --c-divider-soft: #...;
  --c-muted:    #...;   /* texto secundario */
  --c-muted-2:  #...;
  --r-sm: 4pt; --r-md: 8pt;   /* radios; 0pt = esquinas rectas */
  font-family: ...;    /* familia base del documento */
}
```

**Tokens disponibles** (declarados en `#doc-a4,.doc-a4-screen`, se sobreescriben en `.pdoc.pdoc-theme-X`):
`--fs-micro/-small/-body/-h3/-h2/-display`, `--c-text`, `--c-text-2`, `--c-muted`,
`--c-muted-2`, `--c-divider`, `--c-divider-soft`, `--c-bg-soft`, `--c-zebra`,
`--r-sm`, `--r-md`, `--page-x` (margen lateral), `--ls-label`.

**Selectores clave del documento:** `.ph` (encabezado), `.ph-co`, `.ph-name`,
`.ph-sub`, `.ph-contact`, `.ph-badge`, `.ph-badge-num`, `.ptitle` (título del doc),
`.psec-t` (título de sección), `.ptable tbody td`, `.ptotal-amt` (monto total),
`.pobs`, `.pcrit`.

### 2. Encabezado propio (SOLO si la estructura HTML difiere)
Si el tema necesita un encabezado con estructura distinta (no solo otra paleta),
agregá una rama en `_buildDocHeader(theme, S, color, contacts, badgeLabel, badgeDate, showPlaceholder)`:

```js
if (theme === 'MITEMA') {
  // ...armar y devolver el HTML del header...
  return `<div class="ph">...</div>`;
}
```
Si solo cambia la estética (tipografía/paleta), **no toques el builder**: el tema cae
en la rama por defecto (Clásico/Cálido/Técnico/Elegante) y el CSS hace el resto.

⚠️ **Siempre** escapá datos del usuario con `esc()` y resolvé el logo con `safeImgSrc(S.logo)`.

### 3. Botón en la UI
En el contenedor `#theme-presets` agregá un botón con su swatch:
```html
<button class="tpreset" data-theme="MITEMA" onclick="applyPdfTheme('MITEMA')">
  <div class="tpreset-swatch"> ...mini preview con divs... </div>
  <span class="tpreset-label">Mi Tema</span>
</button>
```
El swatch es `56×36px`. `applyPdfTheme` y `restoreUI` ya marcan el `.active` solo;
no hay que tocar JS para un tema nuevo.

## Pasos para un MODIFICADOR ortogonal nuevo (tipo "Compacto")
Un modificador combina con cualquier tema (clase extra sobre la misma tabla).
Requiere estado propio:
1. **`DEF`**: agregá el campo (ej. `pdfCompact:false`). Se persiste solo (todo `S` se guarda).
2. **Handler** junto a `applyPdfTheme`: `function applyPdfX(on){ S.pdfX = !!on; sched(); }`.
3. **`restoreUI`**: sincronizá el control (`document.getElementById('...').checked = !!S.pdfX`).
4. **Las 3 funciones de build** (`buildDoc`, `buildEstDoc`, `buildRiskDoc`): agregá la
   clase a `class="pdoc pdoc-theme-${theme}${S.pdfX ? ' pdoc-clase' : ''}"`.
5. **UI**: un checkbox/toggle con `onchange="applyPdfX(this.checked)"`.
6. **CSS**: `.pdoc.pdoc-clase { ...sobreescribir tokens... }` + selectores puntuales.

## Cosas que NO romper
- El encabezado va en `<thead>` y el navegador lo **repite por página** nativamente.
  Un "sidebar" como elemento del `.ph` sólo llega al alto del header, NO de la hoja.
  Para una **banda lateral full-height** (ej. tema `lateral`) la técnica que sí
  funciona es pintarla como **fondo de la `<table class="pdoc">`** (gradiente lineal
  con color de `--pdoc-accent`): el navegador repinta el fondo de la tabla en cada
  página impresa, igual que repite el `<thead>`. Como los contenedores de sección no
  tienen fondo propio (su inset izquierdo es transparente), la banda se ve a través
  del margen; sólo hay que correr el `padding-left`/`margin-left` de cada sección.
  Evitá `position:fixed` (falla en móvil).
- El CSS del documento es **una sola fuente** (sirve impresión y vista previa). No
  dupliques bloques `@media print` vs pantalla.
- El `accentColor` se inyecta inline desde JS; no lo hardcodees en el CSS del tema
  (usá `currentColor` o dejá que JS lo ponga).

## Verificar (antes de desplegar)
1. **Sintaxis JS:**
   ```bash
   python3 - <<'PY'
   import re, subprocess, sys
   html = open('index.html', encoding='utf-8').read()
   js = "\n;\n".join(re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S))
   open('/tmp/app_check.js','w',encoding='utf-8').write(js)
   sys.exit(subprocess.run(['node','--check','/tmp/app_check.js']).returncode)
   PY
   ```
2. **PWA offline:** `node test/pwa.test.cjs`
3. **Render real (headless):** cargá `file://.../index.html`, seteá `S.pdfTheme='MITEMA'`,
   llamá `buildDoc()` y revisá `#doc-a4`. Sacá captura clonando el HTML en un
   `<div class="doc-a4-screen">` visible (el `#doc-a4` está oculto fuera de impresión).
   El navegador headless ya está instalado por el SessionStart hook (`puppeteer-core`
   + `chrome-headless-shell`).

## Desplegar (flujo del proyecto)
1. **Subir `CACHE_VERSION`** en `sw.js` (`presupuesto-vNN`) y la referencia en `CLAUDE.md`.
2. Si agregaste archivos nuevos, sumalos a `APP_SHELL` en `sw.js`.
3. **Mergear a `main`** → Cloudflare despliega solo.
