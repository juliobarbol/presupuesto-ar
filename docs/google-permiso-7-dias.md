# "Se desconecta solo de Google cada tanto"

> Diagnóstico del 10/08/2026. Drive y Calendar dejaron de sincronizar y la app
> siguió diciendo "Conectado ✓". Reconectar lo arregló — como las veces
> anteriores. Esto explica **por qué vuelve a pasar** y cómo cortarlo de raíz.

## Los números del caso

| Qué | Cuándo |
|---|---|
| Última copia a Drive | **03/08** 08:57 |
| Última sincronización de Calendar | **02/08** 21:44 |
| Día en que se notó | **10/08** |

Siete días. No es casualidad.

## La causa

El navegador **no guarda un refresh token**: la app usa el flujo de token de
Google Identity Services, donde el permiso se renueva callado (`prompt: 'none'`)
mientras el **consentimiento** del usuario siga vigente.

Y ahí está el detalle: si el proyecto de Google Cloud tiene la pantalla de
consentimiento en estado **"Prueba" / "Testing"**, Google **caduca el
consentimiento a los 7 días**. Cuando eso pasa:

1. La renovación silenciosa empieza a fallar.
2. El auto-backup y la sync de la agenda dejan de correr.
3. Nada vuelve a andar hasta que el usuario **vuelve a dar el permiso a mano**
   (que es exactamente lo que hace "Desconectar y volver a conectar", y también
   lo que hace ahora el botón "Reconectar", sin perder nada).

Por eso el patrón es siempre el mismo: **anda una semana y para**.

## La solución de fondo (la hace el dueño del proyecto, una sola vez)

En [Google Cloud Console](https://console.cloud.google.com/), con el proyecto
del `CLIENT_ID` de la app:

1. **APIs y servicios → Pantalla de consentimiento de OAuth**.
2. En **Estado de publicación** dice *En prueba*. Tocar **PUBLICAR APLICACIÓN**
   y confirmar.
3. Google avisa que, con permisos sensibles, la app queda como *no verificada*.
   Para uso propio alcanza: al conectar aparece una pantalla de advertencia y se
   entra con **Configuración avanzada → Ir a Presupuestos AR**. (La verificación
   completa solo hace falta para publicarla a terceros.)
4. Reconectar Drive y Calendar una última vez.

Desde ahí el consentimiento **no caduca a los 7 días**: dura hasta que se
revoque desde la cuenta de Google.

Los scopes que pide la app son mínimos y no dan acceso general:

- `drive.appdata` — una carpeta privada de la app en Drive; no ve el resto de
  los archivos del usuario.
- `calendar.app.created` — solo los calendarios que la app creó; no ve la
  agenda personal.

## Lo que se arregló del lado de la app (v204–v205)

La caducidad de Google no se puede evitar desde el código, pero **la app no
puede mentir sobre su estado**. Antes, los dos módulos se tragaban en silencio
el fallo del token al abrir (`.catch(() => {})`) y seguían mostrando
"Conectado ✓" con la fecha del último éxito.

- El fallo del token silencioso al arrancar ahora **cuenta como fallo de
  sincronización** en Drive (`gdriveInitOnLoad`) y en Calendar
  (`gcalInitOnLoad`): al segundo, sección en rojo y botón "Reconectar".
- **Aviso por antigüedad**: si la última copia (o sincronización) tiene más de
  24 h, la sección se marca sola y muestra `_gSesionVencidaMsg()`, que nombra la
  causa —el permiso que caduca cada 7 días en modo Prueba— y ofrece
  "Reconectar". Esto no depende del contador de fallos, que vive en memoria y se
  reinicia en cada apertura: con un cambio por sesión nunca llegaba a 2, y por
  eso la caída podía durar días sin marcarse.
- "Sincronizar ahora" (Calendar) pide el token con la **escalera interactiva**,
  así el botón de reparar puede efectivamente reparar una sesión vencida.

Cubierto en `test/backup-sync.test.cjs` (A3d) y `test/gcal-agenda.test.cjs`.
