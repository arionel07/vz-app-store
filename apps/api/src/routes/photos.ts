import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { photoCollectionQuerySchema, photoIdempotencyKeySchema, photoStoreCollectionQuerySchema } from "@vizaje/contracts";
import type { TrustedPrincipal } from "../domain/authz";
import { DomainError } from "../domain/errors";
import type { PhotosService } from "../domain/photos/service";
import type { PrincipalResolver } from "./management";

export interface PhotoRoutesOptions {
  photos: PhotosService;
  resolvePrincipal: PrincipalResolver;
  maxUploadBytes: number;
}

function parseInput<TSchema extends z.ZodTypeAny>(schema: TSchema, value: unknown): z.output<TSchema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new DomainError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request");
  return parsed.data;
}

async function requirePrincipal(resolvePrincipal: PrincipalResolver, context: Context): Promise<TrustedPrincipal> {
  const principal = await resolvePrincipal(context);
  if (!principal) throw new DomainError(401, "UNAUTHENTICATED", "Authentication is required");
  return principal;
}

function idParam(context: Context, name: string): string {
  return parseInput(z.string().uuid(), context.req.param(name));
}

async function parsePhotoFile(context: Context): Promise<File> {
  let form: FormData;
  try {
    form = await context.req.formData();
  } catch {
    throw new DomainError(400, "INVALID_MULTIPART", "Request must be multipart/form-data");
  }
  const files = form.getAll("file");
  if (files.length !== 1 || !(files[0] instanceof File)) {
    throw new DomainError(400, "PHOTO_REQUIRED", "Exactly one file field is required");
  }
  return files[0];
}

export function registerPhotoRoutes(app: Hono, options: PhotoRoutesOptions): void {
  const { photos, resolvePrincipal, maxUploadBytes } = options;
  const uploadLimit = bodyLimit({
    maxSize: maxUploadBytes + 64 * 1024,
    onError: (context) => context.json({ error: { code: "PHOTO_TOO_LARGE", message: "Photo exceeds the maximum allowed size" } }, 413),
  });

  app.post("/api/v1/stores/:storeId/photos", uploadLimit, async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const file = await parsePhotoFile(context);
    const rawIdempotencyKey = context.req.header("Idempotency-Key");
    const idempotencyKey = rawIdempotencyKey === undefined ? undefined : parseInput(photoIdempotencyKeySchema, rawIdempotencyKey);
    const result = await photos.upload(principal, idParam(context, "storeId"), file, idempotencyKey);
    return context.json(result.photo, result.created ? 201 : 200);
  });

  app.get("/api/v1/photos", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const query = parseInput(photoCollectionQuerySchema, context.req.query());
    return context.json(await photos.list(principal, query), 200);
  });

  app.get("/api/v1/stores/:storeId/photos", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const query = parseInput(photoStoreCollectionQuerySchema, context.req.query());
    return context.json(await photos.listByStore(principal, idParam(context, "storeId"), query), 200);
  });

  app.get("/api/v1/photos/:id", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    const result = await photos.get(principal, idParam(context, "id"));
    const body = new ArrayBuffer(result.body.byteLength);
    new Uint8Array(body).set(result.body);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": result.photo.mimeType,
        "Content-Length": String(result.body.byteLength),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(result.photo.originalFilename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  app.delete("/api/v1/photos/:id", async (context) => {
    const principal = await requirePrincipal(resolvePrincipal, context);
    await photos.deletePhoto(principal, idParam(context, "id"));
    return context.body(null, 204);
  });
}
