# Notificaciones push — Puesta en marcha (paso a paso)

> Avisos en el teléfono **con la app cerrada** cuando un presupuesto llega al
> día de seguimiento o cuando **se vence**. La app sigue siendo **offline-first**:
> los datos viven en el dispositivo. Lo único que sale a la red es la *suscripción*
> y las *listas de seguimientos y vencimientos* (solo cuando hay señal). Si nunca
> configurás esto, la app funciona igual que siempre y la sección de avisos ni
> aparece.

## Cómo funciona (resumen)

1. El teléfono se suscribe a push (Push API + clave VAPID) y le manda al Worker
   su endpoint + la lista de seguimientos (con su **fecha de aviso**) y la de
   vencimientos (con la **fecha de vigencia** de cada presupuesto).
2. El **Worker de Cloudflare** (`push-worker/`) corre un **cron diario** y, por
   cada dispositivo, manda un push si hay algún seguimiento que llegó a su día
   o algún presupuesto enviado cuya vigencia ya pasó.
3. El push lo entrega el navegador/Android (transporte FCM transparente: **no
   hace falta cuenta de Firebase**). El Service Worker muestra la notificación.

```
[Teléfono/PWA] --suscripción+seguimientos--> [Worker + KV] --cron diario--> push --> [Teléfono]
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

### 4. Desplegar el Worker

```bash
# Desde push-worker/
npx wrangler deploy
```

Te da la URL pública, por ejemplo:
`https://presupuesto-push.juliobarribolbo.workers.dev`

> El cron ya queda activo (configurado en `wrangler.toml`: `0 11 * * *` = todos
> los días a las 11:00 UTC ≈ 8:00 en Argentina). Para cambiar la hora, editá
> esa línea y volvé a desplegar.

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

Abrí la app → pestaña **Empresa** → bajá hasta **"📲 Avisos con la app
cerrada"** (solo aparece si los pasos anteriores están hechos). Prendé el
toggle y aceptá el permiso de notificaciones. Listo.

---

## Probar que anda

- **Prueba inmediata del envío** (sin esperar al cron): podés disparar el cron a
  mano desde el panel de Cloudflare (Workers → tu worker → Triggers → "Trigger"
  del cron) o con `npx wrangler dev --test-scheduled` y pegando
  `http://localhost:8787/__scheduled`. Para ver un push real necesitás un
  presupuesto en estado "enviado" cuya fecha de seguimiento ya haya llegado, o
  cuya fecha de vigencia ya haya pasado (aviso de vencido).
- **Ver suscripciones guardadas**: `npx wrangler kv key list --binding PUSH_KV`.

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
