---
name: deploy-presupuesto
description: Prepara y verifica un despliegue de Presupuestos AR. Usar SIEMPRE antes de mergear a main o cuando el usuario diga "deploy", "desplegar", "publicar", "subir versión", "release", o pida dejar un cambio listo para producción. Sube CACHE_VERSION en sw.js, valida APP_SHELL, corre el lint y la suite de tests, y confirma que es seguro mergear.
---

# Deploy de Presupuestos AR

App PWA offline-first sin build (markup en `index.html`, código en `js/` y `css/`), servida desde Cloudflare.
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
Un `js/`/`css/` nuevo va además en `index.html` con el mismo `?v=` y en `APP_CODIGO`
(no en `APP_SHELL`); el lint del paso 3 avisa si no coinciden.

```bash
git diff --name-only main...HEAD
git status --porcelain
```
Para cada archivo nuevo servido al cliente, confirmar que está en `APP_SHELL`.

### 3. Lint (incluye el chequeo de sintaxis)
ESLint parsea todo `js/` como un programa (un error de sintaxis corta acá) y
además atrapa funciones globales duplicadas, variables inexistentes y las
convenciones de CLAUDE.md (`fetch` sin `netFetch`, `toISOString().slice`,
snapshot copiado a `S` sin `assignSnapshot`). Si `node_modules` no está, `npm ci`.

```bash
npm run lint
```
Debe salir sin errores (exit 0).

### 4. Verificar que las claves de `localStorage` no cambiaron
Cambiar el valor de una clave de `LS` (o de `SPECIES_KEY`, `SERVICES_KEY`,
`CLIENT_KEY`, `PHRASE_KEYS`, etc.) hace que los usuarios pierdan sus datos.
Revisar que el diff no toque esos strings salvo que sea una migración intencional:

```bash
git diff main...HEAD -- js/ | grep -E "pq_|_KEY|LS\s*=|GDRIVE_EMAIL" || echo "OK: sin cambios en claves de storage"
```
Si aparecen cambios en claves, FRENAR y confirmarlo con el usuario.

### 5. Tests (navegador headless real)
La suite completa corre en paralelo en ~1,5 min e incluye `test/pwa.test.cjs`
(SW real, cache de la versión declarada en `sw.js`, app-shell offline).

```bash
npm test
```
Debe terminar en `N/N ok` (exit 0). Si algo falla, el runner imprime el log
completo de ese test. Para iterar: `npm test -- <parte del nombre>`.

### 6. Commit y push a la rama de trabajo
Mensaje claro y descriptivo. Incluir el bump de versión en el mismo commit.

```bash
git add -A && git commit -m "<descripción> (cache vNN)"
git push -u origin <rama-claude>
```

### 7. Reportar — listo para mergear
Resumir al usuario: versión nueva (`vNN`), qué se verificó (lint ✓, tests ✓,
claves de storage intactas ✓), y que mergear a `main` dispara el deploy de Cloudflare.
**No** crear PR ni mergear a `main` salvo que el usuario lo pida explícitamente.

## Checklist final
- [ ] `CACHE_VERSION` subido en `sw.js`
- [ ] Archivos nuevos (si hay) agregados a `APP_SHELL`
- [ ] `npm run lint` sin errores
- [ ] Claves de `localStorage` sin cambios accidentales
- [ ] `npm test` en verde
- [ ] Commit + push a la rama de trabajo
