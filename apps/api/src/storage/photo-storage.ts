import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import type { Env } from "../config/env";

export interface PhotoStorage {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    (("name" in error && error.name === "NoSuchKey") || ("$metadata" in error && (error.$metadata as { httpStatusCode?: number }).httpStatusCode === 404));
}

export class LocalPhotoStorage implements PhotoStorage {
  private readonly root: string;

  constructor(rootDirectory: string) {
    this.root = resolve(rootDirectory);
  }

  private pathFor(key: string): string {
    const candidate = resolve(this.root, key);
    const relativePath = relative(this.root, candidate);
    if (!relativePath || relativePath.startsWith(".." + sep) || relativePath === ".." || resolve(this.root, relativePath) !== candidate) {
      throw new Error("Invalid photo storage key");
    }
    return candidate;
  }

  async put(key: string, data: Uint8Array, _contentType: string): Promise<void> {
    const filePath = this.pathFor(key);
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
    await writeFile(filePath, data, { flag: "wx", mode: 0o600 });
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
  }
}

export class S3PhotoStorage implements PhotoStorage {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    options: {
      endpoint?: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
      forcePathStyle: boolean;
    },
  ) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
      ServerSideEncryption: "AES256",
    }));
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!result.Body) return null;
      return new Uint8Array(await result.Body.transformToByteArray());
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export function createPhotoStorage(env: Env): PhotoStorage {
  if (env.PHOTO_STORAGE_DRIVER === "local") return new LocalPhotoStorage(env.PHOTO_STORAGE_PATH);

  if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw new Error("S3 photo storage configuration is incomplete");
  }

  return new S3PhotoStorage(env.S3_BUCKET, {
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
}
