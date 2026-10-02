/** Image helpers: optional resizing/conversion via sharp (falls back to pass-through). */

type SharpModule = typeof import("sharp");
let sharpMod: SharpModule | null | undefined;

async function loadSharp(): Promise<SharpModule | null> {
  if (sharpMod !== undefined) return sharpMod;
  try {
    sharpMod = (await import("sharp")).default as unknown as SharpModule;
  } catch {
    sharpMod = null;
  }
  return sharpMod;
}

export interface ImageBytes {
  data: Buffer;
  mediaType: string;
}

/** Downscale to fit maxSide (keeps format), used for images sent to Claude. */
export async function normalizeForVision(img: ImageBytes, maxSide = 1568): Promise<ImageBytes> {
  const sharp = await loadSharp();
  if (!sharp) return img;
  try {
    const meta = await sharp(img.data).metadata();
    if ((meta.width ?? 0) <= maxSide && (meta.height ?? 0) <= maxSide && img.data.length < 4_000_000) return img;
    const out = await sharp(img.data).resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    return { data: out, mediaType: "image/jpeg" };
  } catch {
    return img;
  }
}

/** Convert to PNG (image generation APIs are picky about webp). */
export async function toPng(img: ImageBytes, maxSide = 1536): Promise<ImageBytes> {
  if (img.mediaType === "image/png" && img.data.length < 6_000_000) return img;
  const sharp = await loadSharp();
  if (!sharp) return img;
  try {
    const out = await sharp(img.data).resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    return { data: out, mediaType: "image/png" };
  } catch {
    return img;
  }
}

export async function toJpeg(img: ImageBytes, maxSide = 1536): Promise<ImageBytes> {
  const sharp = await loadSharp();
  if (!sharp) return img;
  try {
    const out = await sharp(img.data).resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    return { data: out, mediaType: "image/jpeg" };
  } catch {
    return img;
  }
}

export function extForMedia(mediaType: string): string {
  return { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }[mediaType] ?? "bin";
}
