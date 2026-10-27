import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalPhotoStorage } from "../src/storage/photo-storage";

describe("local photo storage", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  test("stores, retrieves, deletes, and rejects traversal keys", async () => {
    root = await mkdtemp(join(tmpdir(), "vizaje-photo-storage-"));
    const storage = new LocalPhotoStorage(root);
    const bytes = Uint8Array.from([1, 2, 3, 4]);

    await storage.put("photos/example.bin", bytes, "application/octet-stream");
    expect(await storage.get("photos/example.bin")).toEqual(bytes);
    await storage.delete("photos/example.bin");
    expect(await storage.get("photos/example.bin")).toBeNull();
    await expect(storage.get("../outside.bin")).rejects.toThrow("Invalid photo storage key");
  });
});
