import type { EncodedPreview } from "../messages";

/** Chromium codecs keep full resolution where possible, then reduce dimensions without cropping. */
export async function preparePreviewImage(dataUri: string, maxBytes: number): Promise<EncodedPreview> {
  const image = new Image();
  image.src = dataUri;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Image conversion is unavailable.");
  const encode = (mime: EncodedPreview["mime"], quality?: number): Promise<Blob> =>
    new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Image encoding failed."))),
        mime,
        quality
      )
    );
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let transparent = false;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] !== 255) {
      transparent = true;
      break;
    }
  }
  for (;;) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    let blob = await encode("image/png");
    // JPEG keeps screenshot text at its original resolution. Alpha always stays PNG.
    if (!transparent && blob.size >= maxBytes) {
      for (const quality of [0.92, 0.85, 0.75]) {
        blob = await encode("image/jpeg", quality);
        if (blob.size < maxBytes) break;
      }
    }
    if (blob.size < maxBytes) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return {
        mime: transparent || blob.type === "image/png" ? "image/png" : "image/jpeg",
        data: btoa(binary),
      };
    }
    if (canvas.width === 1 && canvas.height === 1)
      throw new Error("Cannot fit the image under Steam's size limit.");
    canvas.width = Math.max(1, Math.floor(canvas.width * 0.8));
    canvas.height = Math.max(1, Math.floor(canvas.height * 0.8));
  }
}
