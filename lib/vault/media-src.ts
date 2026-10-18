// The one shape a picture's address takes inside a stored document:
// `/api/media/<folder_id>/<sha256>.<ext>` (see saveMedia in ./store.ts). Its
// own module so the browser-side renderer can check it without pulling in the
// data layer.
export const MEDIA_SRC = /^\/api\/media\/([0-9a-f-]{36})\/([0-9a-f]{64}\.(?:png|jpg|gif|webp))$/;
