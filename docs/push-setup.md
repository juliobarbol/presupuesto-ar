# Notificaciones push — Puesta en marcha (paso a paso)

> Avisos en el teléfono **con la app cerrada** cuando un presupuesto llega al
> día de seguimiento o cuando **se vence**. La app sigue siendo **offline-first**:
> los datos viven en el dispositivo. Lo único que sale a la red es la *suscripción*
> y las *listas de seguimientos y vencimientos* (solo cuando hay señal). Si nunca
> configurás esto, la app funciona igual que siempre y la sección de avisos ni
> aparece.

## Actualizar el Worker (v237) — hacelo una vez

El Worker que estaba publicado era una versión **anterior** a la del repo (sin
los arreglos de seguridad ni los avisos nuevos). Publicar el Worker **no** pasa
solo al mergear a `main`: la app se despliega sola, el Worker no. Desde tu compu:

```bash
cd push-worker
npx wrangler deploy --config ./wrangler.toml
```

> ⚠️ **El `--config` no es opcional.** En la raíz del repo está el
> `wrangler.jsonc` de la app, y wrangler busca primero `wrangler.json(c)`
> subiendo carpetas **antes** que el `wrangler.toml` local: sin `--config`,
> desde `push-worker/` publica la **app** (`presupuesto-ar`) en vez del Worker
> de avisos. Pasó el 09/10/2026 (sin daño: subió la misma versión que ya
> estaba).

Publicado por última vez: 09/10/2026 (versión del repo v237).

Con eso quedan activos los avisos de trabajos/visitas, los recordatorios con
hora y el botón **"Probar notificaciones"** de la app. Mientras no lo publiques,
la app sigue andando con los seguimientos y vencimientos de siempre, y el botón
"Probar" avisa que el servidor está desactualizado.

**Para no tener que acordarte nunca más:** en el panel de Cloudflare → Workers
→ `presupuesto-push` → Settings → **Build** → conectá este repositorio con
*Root directory* `push-worker`. Desde ahí cada merge a `main` publica también
el Worker.

## Cómo funciona (resumen)

1. El teléfono se suscribe a push (Push API + clave VAPID) y le manda al Worker
   su endpoint + la lista de seguimientos (con su **fecha de aviso**) y la de
   vencimientos (con la **fecha de vigencia** de cada presupuesto).
2. El **Worker de Cloudflare** (`push-worker/`) corre un **cron cada 15
   minutos**. Seguimientos y vencimientos salen en las franjas de **9, 14 y
   19 h** (hora del teléfono, que la app manda como `tz`), una vez por día cada
   presupuesto. Además entrega los **avisos con horario** que arma la app
   (`avisos`: `{k, at, title, body, go, tag}`): "Mañana: …" a las 19 h del día
   anterior, "Hoy: …" a las 7:30 y el recordatorio 1 h antes de una visita o
   nota con hora. Cada aviso sale una vez, y no si tiene más de 3 h de atraso.
   Como el texto y la hora los arma la app, **sumar un aviso nuevo no requiere
   volver a publicar el Worker**. Una suscripción que el servicio de push da
   por muerta (404/410) se borra sola.
3. El push lo entrega el navegador/Android (transporte FCM transparente: **no
   hace falta cuenta de Firebase**). El Service Worker muestra la notificación.

```
[Teléfono/PWA] --suscripción+seguimientos--> [Worker + KV] --cron 3x/día--> push --> [Teléfono]
```

---

## Lo que tenés que hacer vos (una sola vez)

Necesitás Node instalado en tu compu y una cuenta de Cloudflare (gratis, la
misma donde ya está publicada la app).

### 1. Generar las claves VAPID

Un par de claves: la **pública** va en la app, la **privada** solo en el Worker.

```bash
npx web-push generate-vapid-keys
```

Anotá las dos. Salida de ejemplo:

```
Public Key:  BNb...   (87 caracteres, base64url)
Private Key: k3Q...   (43 caracteres, base64url)
```

### 2. Crear el namespace KV (donde se guardan las suscripciones)

```bash
cd push-worker
npx wrangler kv namespace create PUSH_KV
```

Te devuelve algo como:

```
[[kv_namespaces]]
binding = "PUSH_KV"
id = "abc123def456..."
```

Copiá ese `id` y pegalo en **`push-worker/wrangler.toml`** reemplazando
`REEMPLAZAR_CON_ID_DE_KV`.

### 3. Cargar los secretos del Worker

La clave **privada** y el resto NO van en el código: se cargan como secrets.

```bash
# Desde push-worker/
npx wrangler secret put VAPID_PUBLIC_KEY      # pegás la pública del paso 1
npx wrangler secret put VAPID_PRIVATE_KEY     # pegás la privada del paso 1
npx wrangler secret put VAPID_SUBJECT         # escribís: mailto:juliobarribolbo@gmail.com
```

**Opcionales (seguridad):**

```bash
# Habilita el endpoint GET /test?key=… para disparar un push de prueba a mano.
# Si NO lo cargás, ese endpoint responde 404 — que es lo que querés en
# producción: la URL del Worker está en claro en el index.html público, así que
# sin secreto cualquiera podría hacer sonar el teléfono de todos los equipos.
npx wrangler secret put TEST_KEY

# Solo si algún día la app se sirve desde otro dominio: origen permitido para
# las llamadas del navegador (CORS). Por defecto ya acepta el de Cloudflare.
npx wrangler secret put ALLOWED_ORIGIN
```

### 4. Desplegar el Worker

```bash
# Desde push-worker/ (el --config es obligatorio, ver arriba)
npx wrangler deploy --config ./wrangler.toml
```

Te da la URL pública, por ejemplo:
`https://presupuesto-push.juliobarribolbo.workers.dev`

> El cron ya queda activo (configurado en `wrangler.toml`: cada 15 minutos).
> Las horas de cada aviso se deciden en la app y en `runDue`, no en el cron.

### 5. Conectar la app con el Worker

En **`index.html`**, buscá estas dos constantes (cerca del principio del
`<script>`, después del objeto `LS`) y rellenalas:

```js
const PUSH_WORKER_URL = 'https://presupuesto-push.juliobarribolbo.workers.dev';
const PUSH_VAPID_KEY  = 'BNb...';   // la clave PÚBLICA del paso 1
```

> ⚠️ Acá va **solo la pública**. La privada nunca toca el repo.

### 6. Subir `CACHE_VERSION` y desplegar la app

En `sw.js` subí `CACHE_VERSION` (ej. `presupuesto-v44`) y mergeá a `main`.
Cloudflare publica solo.

### 7. Activar en el teléfono

Lo más rápido: tocá la **campanita** → "Activar". O en **Configuración →
Textos → "Avisos con la app cerrada"**: prendé el interruptor, aceptá el
permiso y elegí qué avisos querés. Se activa en **cada teléfono** por separado.

---

## Probar que anda

- **Desde la app**: Configuración → Textos → "Probar notificaciones". Manda
  dos: una **local** (prueba el teléfono: permiso, canal, No molestar) y otra
  **desde el Worker** (`POST /ping`, solo a ese equipo). Si llega la primera y
  no la segunda, el teléfono frena las de la app cerrada: en Android,
  Información de la app → Batería → **Sin restricciones**. La línea de estado
  dice cuándo se actualizó el servidor por última vez y cuántos avisos hay
  programados.

- **Prueba inmediata del envío** (sin esperar al cron): podés disparar el cron a
  mano desde el panel de Cloudflare (Workers → tu worker → Triggers → "Trigger"
  del cron) o con `npx wrangler dev --test-scheduled` y pegando
  `http://localhost:8787/__scheduled`. Para ver un push real necesitás un
  presupuesto en estado "enviado" cuya fecha de seguimiento ya haya llegado, o
  cuya fecha de vigencia ya haya pasado (aviso de vencido).
- **Ver suscripciones guardadas**: `npx wrangler kv key list --binding PUSH_KV`.
  Cada registro expira solo a los 90 días sin re-suscribirse (la app re-suscribe
  en cada apertura con señal), así que un equipo que dejaste de usar se limpia
  sin que hagas nada.
- **Push de prueba inmediato a todos los equipos**: solo si cargaste `TEST_KEY`,
  abrí `https://…workers.dev/test?key=TU_TEST_KEY`.

---

## Costo

Todo entra en el **plan gratuito** de Cloudflare:
- Workers: 100.000 requests/día.
- Cron triggers: incluidos.
- KV: 1 GB y 100.000 lecturas/día.

Para un uso de un podador (decenas de presupuestos) sobra de lejos.

---

## Notas y límites

- **Offline-first intacto**: si no hay señal, la suscripción no se actualiza y
  el push no llega — es lo esperado. Los datos y el trabajo siguen 100% locales.
- **Hace falta abrir la app con señal al menos una vez** para registrar/renovar
  la suscripción. Si desinstalás la app o revocás el permiso, dejan de llegar.
- **iOS**: el push web en iPhone solo funciona si la PWA está **instalada en la
  pantalla de inicio** (iOS 16.4+). En Android (incluido el APK/TWA) funciona
  directo.
- **El Worker es independiente del PWA shell**: no va en `APP_SHELL` de `sw.js`
  ni se cachea. Desplegarlo o no, no afecta el offline de la app.
- **Privacidad**: al Worker solo le llega el nombre del cliente y las fechas de
  seguimiento/vencimiento (para armar el texto del aviso). No se mandan montos,
  direcciones, fotos ni el detalle del presupuesto.
