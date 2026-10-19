# js/photos.js

> Detalle del módulo con el porqué de cada decisión, movido textual desde
> CLAUDE.md (que quedó como mapa corto). Leelo antes de tocar este código.

## `js/photos.js`

Almacén de fotos en **IndexedDB** (`pq_photos`). `item.photo` guarda un ID `p_...`; el binario vive en IDB. `savePhoto`/`getPhotoData`/`hydratePhotoCache`/`migrateInlinePhotosToIDB`/`restorePhotosFromBackup`.

**Fotos del lugar de disposición** (`dispoPhotoRefs`): no cuelgan de un ítem sino del presupuesto (`S.dispoPhotos`) — es UN lugar acordado para todo el trabajo, no una foto por árbol. Por eso `collectPhotoIds` y `migrateInlinePhotosToIDB` las recorren aparte de `items`/`itemsB`/`estItems`: si no, el backup viaja sin ellas y en el equipo nuevo quedan rotas
