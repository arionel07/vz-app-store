import sharp from "sharp";

export const PHOTO_SIGNATURES = [
  { mimeType: "image/jpeg", extension: "jpg", matches: (bytes: Uint8Array) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { mimeType: "image/png", extension: "png", matches: (bytes: Uint8Array) => bytes.length >= 8 && bytes.slice(0, 8).every((byte, index) => byte === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index]) },
  { mimeType: "image/webp", extension: "webp", matches: (bytes: Uint8Array) => bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP" },
] as const;

export type PhotoSignature = (typeof PHOTO_SIGNATURES)[number];

export interface PhotoProcessingLimits {
  maxBytes: number;
  maxDimension: number;
  maxPixels: number;
}

export class PhotoImageError extends Error {
  constructor(
    public readonly code: "INVALID_IMAGE" | "PHOTO_TOO_LARGE" | "PHOTO_DIMENSIONS_TOO_LARGE",
    message: string,
  ) {
    super(message);
    this.name = "PhotoImageError";
  }
}

export function detectPhotoType(bytes: Uint8Array): PhotoSignature | null {
  return PHOTO_SIGNATURES.find((signature) => signature.matches(bytes)) ?? null;
}

export async function normalizePhotoImage(
  input: Uint8Array,
  signature: PhotoSignature,
  limits: PhotoProcessingLimits,
): Promise<Uint8Array> {
  try {
    const metadata = await sharp(input, { limitInputPixels: limits.maxPixels, failOn: "error" }).metadata();
    if (!metadata.width || !metadata.height) {
      throw new PhotoImageError("INVALID_IMAGE", "Image dimensions could not be determined");
    }
    if (metadata.width > limits.maxDimension || metadata.height > limits.maxDimension || metadata.width * metadata.height > limits.maxPixels) {
      throw new PhotoImageError("PHOTO_DIMENSIONS_TOO_LARGE", "Photo dimensions exceed the allowed limits");
    }

    let pipeline = sharp(input, { limitInputPixels: limits.maxPixels, failOn: "error" }).rotate();
    if (signature.mimeType === "image/jpeg") pipeline = pipeline.jpeg({ quality: 90 });
    if (signature.mimeType === "image/png") pipeline = pipeline.png({ compressionLevel: 9 });
    if (signature.mimeType === "image/webp") pipeline = pipeline.webp({ quality: 90 });
    const output = new Uint8Array(await pipeline.toBuffer());
    if (output.byteLength > limits.maxBytes) {
      throw new PhotoImageError("PHOTO_TOO_LARGE", "Photo exceeds the maximum allowed size after normalization");
    }
    return output;
  } catch (error) {
    if (error instanceof PhotoImageError) throw error;
    if (error instanceof Error && error.message.toLowerCase().includes("pixel limit")) {
      throw new PhotoImageError("PHOTO_DIMENSIONS_TOO_LARGE", "Photo dimensions exceed the allowed limits");
    }
    throw new PhotoImageError("INVALID_IMAGE", "Photo could not be decoded");
  }
}
