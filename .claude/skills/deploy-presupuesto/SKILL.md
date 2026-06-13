---
name: deploy-presupuesto
description: Prepara y verifica un despliegue de Presupuestos AR. Usar SIEMPRE antes de mergear a main o cuando el usuario diga "deploy", "desplegar", "publicar", "subir versión", "release", o pida dejar un cambio listo para producción. Sube CACHE_VERSION en sw.js, valida APP_SHELL, corre el chequeo de sintaxis y el test PWA, y confirma que es seguro mergear.
---

# Deploy de Presupuestos AR

App PWA offline-first en un único `index.html`, sin build, servida desde Cloudflare.
El bug más caro de este proyecto es **desplegar sin subir `CACHE_VERSION`**: los
dispositivos quedan con la versión vieja cacheada. Esta skill convierte el
"Flujo de despliegue (SEGUIR SIEMPRE)" del `CLAUDE.md` en un procedimiento ejecutable.

## Cuándo NO desplegar
- No estás en una rama de trabajo (`claude/...`). Nunca preparar deploy desde `main`.
- Hay cambios sin commitear que no son parte de este deploy.

## Procedimiento (ejecutar en orden)

### 1. Subir `CACHE_VERSION` en `sw.js`
Es obligatorio en **cada** deploy. Formato `presupuesto-vNN`.

```bash
grep -n "CACHE_VERSION" sw.js | head -1
```
Editar `sw.js` incrementando el número: `presupuesto-vNN` → `presupuesto-v(NN+1)`.
**No** tocar `CACHE_VERSION` "a mano" en `test/pwa.test.cjs`: el test lo parsea solo.

### 2. ¿Hay archivos nuevos? → agregarlos a `APP_SHELL`
Si este cambio agrega un archivo que la app necesita offline (otro `.js`, `.css`,
`.png`, etc.), agregarlo al array `APP_SHELL` de `sw.js`, o se rompe el offline.
(Hoy todo vive en `index.html`, así que normalmente NO hace falta — pero verificar.)

```bash
git diff --name-only main...HEAD
git status --porcelain
```
Para cada archivo nuevo servido al cliente, confirmar que está en `APP_SHELL`.

### 3. Chequeo de sintaxis del JS inline
El `<script>` vive embebido en `index.html`; hay que aislarlo y validarlo con node:

```bash
python3 - <<'PY'
import re, subprocess, sys
html = open('index.html', encoding='utf-8').read()
js = "\n;\n".join(re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S))
open('/tmp/app_check.js','w',encoding='utf-8').write(js)
sys.exit(subprocess.run(['node','--check','/tmp/app_check.js']).returncode)
PY
```
Debe salir sin errores (exit 0).

### 4. Verificar que las claves de `localStorage` no cambiaron
Cambiar el valor de una clave de `LS` (o de `SPECIES_KEY`, `SERVICES_KEY`,
`CLIENT_KEY`, `PHRASE_KEYS`, etc.) hace que los usuarios pierdan sus datos.
Revisar que el diff no toque esos strings salvo que sea una migración intencional:

```bash
git diff main...HEAD -- index.html | grep -E "pq_|_KEY|LS\s*=|GDRIVE_EMAIL" || echo "OK: sin cambios en claves de storage"
```
Si aparecen cambios en claves, FRENAR y confirmarlo con el usuario.

### 5. Test PWA real (navegador headless)
Valida el SW real, que se crea la cache de la versión declarada en `sw.js`, y que
el app-shell carga offline. Parsea `CACHE_VERSION` solo, así que corre después del bump.

```bash
node test/pwa.test.cjs
```
Debe terminar en `✓ TODOS LOS CHECKS OK` (exit 0). Si falla por la network policy
(cdnjs/fuentes bloqueadas), eso es esperado y el test ya lo ignora — pero los checks
de SW/cache/offline deben pasar igual.

### 6. Commit y push a la rama de trabajo
Mensaje claro y descriptivo. Incluir el bump de versión en el mismo commit.

```bash
git add -A && git commit -m "<descripción> (cache vNN)"
git push -u origin <rama-claude>
```

### 7. Reportar — listo para mergear
Resumir al usuario: versión nueva (`vNN`), qué se verificó (sintaxis ✓, test PWA ✓,
claves de storage intactas ✓), y que mergear a `main` dispara el deploy de Cloudflare.
**No** crear PR ni mergear a `main` salvo que el usuario lo pida explícitamente.

## Checklist final
- [ ] `CACHE_VERSION` subido en `sw.js`
- [ ] Archivos nuevos (si hay) agregados a `APP_SHELL`
- [ ] Chequeo de sintaxis JS sin errores
- [ ] Claves de `localStorage` sin cambios accidentales
- [ ] `node test/pwa.test.cjs` en verde
- [ ] Commit + push a la rama de trabajo
