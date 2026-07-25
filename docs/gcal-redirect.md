# Conectar Google Calendar sin ventana emergente (redirección)

## Por qué existe este camino

El flujo normal de Google (GIS) abre una **ventana emergente**. En algunos
dispositivos esa ventana se cierra sin responder y Google solo reporta
`popup_closed`, sin decir por qué. Pasa **tanto en la app instalada como en una
pestaña del navegador**, así que no hay forma de dar el permiso.

El camino por **redirección** no usa ventanas: la app navega a Google en la
misma pestaña y Google devuelve el permiso en el fragmento (`#access_token=…`)
al volver. Usa el flujo implícito (`response_type=token`), que **no necesita
`client_secret`** — importante, porque este proyecto no tiene backend.

Se ofrece solo cuando el popup falla (`gcalOfrecerRedireccion`), con un diálogo
de confirmación. El camino normal sigue siendo el de siempre.

## Paso único en Google Cloud (el dueño, una vez)

La URL de retorno tiene que estar registrada en el Client ID, o Google contesta
**`redirect_uri_mismatch`**.

1. `console.cloud.google.com/apis/credentials` → proyecto **Presupuestos**.
2. En **ID de clientes de OAuth 2.0**, abrir el cliente web de la app.
3. En **URI de redireccionamiento autorizados** → **Agregar URI**:

   ```
   https://presupuesto-ar.juliobarribolbo.workers.dev/
   ```

   Con la **barra final**, exactamente así: la app manda `location.origin + '/'`
   y Google exige coincidencia exacta.
4. Guardar. Puede tardar unos minutos en tomar efecto.

> Los **orígenes de JavaScript autorizados** que ya estaban NO se tocan: los
> sigue usando el flujo con popup, que queda como camino principal.

## Cómo se ve funcionando

1. Empresa → Sincronizar con Google Calendar → **Conectar**.
2. Si la ventana falla, aparece *"Conectar sin ventana emergente"* → **Ir a Google**.
3. La app te lleva a Google, das el permiso, y volvés a la app ya conectada.

El token se saca de la barra de direcciones apenas se lee (`history.replaceState`),
así que no queda en el historial.

## Detalles que no romper

- El `state` se guarda en `sessionStorage` (`pq_gcal_state`) y se valida al
  volver: un fragmento con otro `state` se ignora. Es lo que evita que alguien
  te meta un token ajeno con un link.
- `gcalHandleRedirectReturn()` corre **temprano** en el init (no diferido) para
  limpiar la URL cuanto antes, y si manejó la vuelta, `gcalInitOnLoad()` no
  arranca una segunda sincronización encima.
- El scope se verifica en la vuelta: si Google no otorgó `calendar.app.created`,
  no se marca como conectado.
- Ver `test/gcal-redirect.test.cjs`.
