/** Per-panel image caches and batched requests for the two coat-of-arms editors. */
export function createTextureImages(
  send: (message: { type: "textures"; keys: string[]; thumbs: boolean }) => void,
  draw: () => void,
  paintTiles: () => void
) {
  const images = new Map<string, HTMLImageElement | null>();
  const thumbs = new Map<string, HTMLImageElement | null>();
  const pending = { full: new Set<string>(), thumb: new Set<string>() };
  let flushTimer: ReturnType<typeof setTimeout> | undefined;

  function request(key: string, thumb: boolean): void {
    const store = thumb ? thumbs : images;
    const queue = thumb ? pending.thumb : pending.full;
    if (store.has(key) || queue.has(key)) return;
    queue.add(key);
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = undefined;
        for (const [q, isThumb] of [
          [pending.full, false],
          [pending.thumb, true],
        ] as const) {
          if (q.size) send({ type: "textures", keys: [...q], thumbs: isThumb });
          q.clear();
        }
      }, 0);
    }
  }

  function receiveTextures(urls: Record<string, string | null>, thumb: boolean): void {
    const store = thumb ? thumbs : images;
    for (const [key, url] of Object.entries(urls)) {
      if (!url) {
        store.set(key, null);
        if (thumb) paintTiles();
        continue;
      }
      const img = new Image();
      img.onload = () => {
        store.set(key, img);
        if (thumb) paintTiles();
        else draw();
      };
      img.onerror = () => store.set(key, null);
      img.src = url;
    }
    if (!thumb) draw();
  }
  return { images, thumbs, request, receiveTextures };
}
