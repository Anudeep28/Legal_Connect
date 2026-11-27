import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

const dataDir = await mkdtemp(join(tmpdir(), "consult-lawyer-local-storage-"));
process.env.OBJECT_STORAGE_PROVIDER = "local";
process.env.LOCAL_OBJECT_STORAGE_DIR = dataDir;

const { ObjectNotFoundError, ObjectStorageService } = await import("./objectStorage");
const storage = new ObjectStorageService();

after(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

test("local uploads are private object paths with metadata, streaming reads, and deletion", async () => {
  const consultationId = "consultation-1";
  const attachmentId = "attachment-1";
  const uploadURL = await storage.getObjectEntityUploadURL("text/plain", { consultationId, attachmentId });
  assert.equal(uploadURL, `/api/consultations/${consultationId}/attachments/${attachmentId}/upload`);

  const objectPath = storage.normalizeObjectEntityPath(uploadURL);
  assert.equal(objectPath, `/objects/${consultationId}/${attachmentId}`);
  const content = Buffer.from("case attachment");
  const size = await storage.writeObjectEntityFromStream(
    objectPath,
    Readable.from([content]),
    "text/plain",
    100,
  );
  assert.equal(size, content.length);

  const file = await storage.getObjectEntityFile(objectPath);
  assert.deepEqual(await file.getMetadata(), [{ size: content.length, contentType: "text/plain" }]);
  const chunks: Buffer[] = [];
  for await (const chunk of file.createReadStream()) chunks.push(Buffer.from(chunk));
  assert.deepEqual(Buffer.concat(chunks), content);

  await file.delete();
  await assert.rejects(storage.getObjectEntityFile(objectPath), ObjectNotFoundError);
});

test("local storage rejects traversal and stops oversized streams without leaving files", async () => {
  await assert.rejects(storage.getObjectEntityFile("/objects/../outside/file"), ObjectNotFoundError);
  const objectPath = "/objects/consultation-2/attachment-2";
  await assert.rejects(
    storage.writeObjectEntityFromStream(objectPath, Readable.from([Buffer.alloc(20)]), "text/plain", 10),
    (error: unknown) => (error as { type?: string }).type === "entity.too.large",
  );
  await assert.rejects(storage.getObjectEntityFile(objectPath), ObjectNotFoundError);
});
