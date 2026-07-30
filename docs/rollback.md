# Volver atrás un despliegue

> Cómo revertir la app a una versión anterior cuando algo sale mal en
> producción. Pensado para leerse **con la app rota y con apuro**.

## Punto de retorno del rediseño del editor

```
b04cf2c   Merge: reintentar sin la cuenta recordada cuando el popup se cierra solo
```

Es el último commit de `main` **antes** de tocar nada del rediseño del editor
(`CACHE_VERSION = presupuesto-v187`). Todo lo del rediseño entra después de ese
punto.

> Hay un tag local `pre-rediseno-editor` apuntando ahí, pero el proxy de git de
> este entorno **no acepta push de tags**, así que el SHA de arriba es el registro
> que vale. No hace falta el tag: `main` nunca se reescribe, así que ese commit
> siempre está en la historia.

## Antes de empezar: la buena noticia

El service worker sirve las navegaciones con **network-first** (`sw.js`, ver el
comentario de cabecera): al abrir la app, siempre intenta traer la versión nueva de
la red y solo cae al caché si no hay señal.

Eso significa que **un rollback llega solo**: el usuario abre la app con datos y ya
tiene la versión corregida. **Nadie tiene que desinstalar ni reinstalar nada.**

## Caso 1 — Todavía no mergeaste a `main`

No hay nada que revertir. `main` está limpio y es lo que está en producción. Podés
borrar la rama de trabajo y listo.

```bash
git checkout main
git branch -D claude/editor-format-options-redesign-akjunb
```

## Caso 2 — Ya está en producción y anda mal (recomendado)

Revertir el merge. **No reescribe la historia**, así que es seguro aunque haya
trabajo encima.

```bash
git checkout main
git pull origin main

# Encontrar el merge que hay que deshacer
git log --oneline --merges -5

# Revertirlo. -m 1 = "volver a como estaba main antes del merge"
git revert -m 1 <sha-del-merge>

# Subir CACHE_VERSION en sw.js (ver más abajo por qué) y luego:
git push origin main
```

Cloudflare despliega solo al detectar el push.

Si el problema vino de **varios** merges, revertilos del más nuevo al más viejo.

## Caso 3 — Emergencia: volver a un punto conocido

Solo si el Caso 2 se complica y hace falta cortar por lo sano.

```bash
git checkout main
git fetch origin main
git reset --hard b04cf2c
# Subir CACHE_VERSION en sw.js, commitear, y:
git push --force-with-lease origin main
```

⚠️ **Esto reescribe `main`.** Se pierde todo lo que haya después de ese commit,
incluido trabajo de otras funciones que se hayan mergeado en el medio. Usar solo si
no hay nada más que salvar. `--force-with-lease` (no `--force`) evita pisar un push
de otro que no hayas visto.

## Siempre: subir `CACHE_VERSION`

Después de revertir, **subí el número igual**, no lo bajes:

```js
// sw.js
const CACHE_VERSION = 'presupuesto-v189';   // no volver a v187
```

Técnicamente volver a un número viejo también funciona —`activate` borra toda cache
cuyo nombre no sea el actual, así que no queda nada pegado—, pero ir siempre para
adelante evita confundirse al mirar qué versión tiene un teléfono.

## Verificar que el rollback llegó

1. Abrir `https://presupuesto-ar.juliobarribolbo.workers.dev` en una pestaña nueva.
2. DevTools → Application → Service Workers: la versión activa tiene que ser la
   nueva.
3. En el teléfono: cerrar la app del todo y abrirla **con señal**. Network-first
   hace el resto.
4. Si un dispositivo quedó raro: Ajustes → borrar datos de la app. Los presupuestos
   viven en `localStorage`, así que **antes de borrar nada, exportar el backup** o
   confirmar que Drive está al día.

## Los datos del usuario no se tocan

Revertir el código **no toca `localStorage` ni IndexedDB**: los presupuestos, el
historial, las fotos y la configuración siguen intactos. La única forma de perder
datos es borrar los datos de la app a mano.

La excepción a vigilar: si una versión nueva agregó una clave de `localStorage` y se
revierte, la clave queda huérfana pero no molesta. Al revés —revertir una migración
que *transformó* datos existentes— sí sería un problema, y por eso ninguna migración
debería borrar el formato viejo en el mismo despliegue que introduce el nuevo.
