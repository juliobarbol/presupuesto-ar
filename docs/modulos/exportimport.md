# js/exportimport.js

> Detalle del módulo con el porqué de cada decisión, movido textual desde
> CLAUDE.md (que quedó como mapa corto). Leelo antes de tocar este código.

## `js/exportimport.js` · `js/gdrive.js` · `js/gcal.js`

Export/import JSON, `buildBackupObject`/`applyBackupObject`; **GDRIVE** (copia en Google Drive) y **GCAL** (Agenda → Google Calendar) en sus archivos, ver sus secciones más abajo. Las secciones de Copia de seguridad, Drive y Calendar viven en **Configuración → Datos** (v227); los mensajes de WhatsApp, el seguimiento y los avisos push en **Configuración → Textos**; "Negocio" queda con logo, titular y datos para cobrar
