import assert from "node:assert/strict";
import { test } from "node:test";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { MinioObjectStorageService } from "./objectStorage";

const config = {
  endpoint: "http://127.0.0.1:9000",
  publicEndpoint: "https://files.consultwithlawyer.in",
  bucket: "consultation-attachments",
  region: "us-east-1",
  accessKeyId: "test-access",
  secretAccessKey: "test-secret",
};

test("MinIO signs private uploads and converts the URL to a bucket-independent object path", async () => {
  let command: unknown;
  let expiry = 0;
  const fakeClient = { send: async () => ({}) } as unknown as S3Client;
  const storage = new MinioObjectStorageService(config, {
    client: fakeClient,
    presignerClient: fakeClient,
    signUrl: async (_client, signedCommand, options) => {
      command = signedCommand;
      expiry = options?.expiresIn ?? 0;
      return "https://files.consultwithlawyer.in/consultation-attachments/uploads/test-id?X-Amz-Signature=fixture";
    },
  });

  const uploadUrl = await storage.getObjectEntityUploadURL("application/pdf");
  assert.match(uploadUrl, /^https:\/\/files\.consultwithlawyer\.in\//);
  assert.ok(command instanceof PutObjectCommand);
  assert.equal(command.input.ContentType, "application/pdf");
  assert.equal(expiry, 900);
  assert.equal(
    storage.normalizeObjectEntityPath(uploadUrl),
    "/objects/uploads/test-id",
  );
  assert.equal(
    storage.normalizeObjectEntityPath("https://other.example/bucket/key"),
    "https://other.example/bucket/key",
  );
});

test("AWS SDK signs MinIO uploads for the public HTTPS host and bucket path", async () => {
  const storage = new MinioObjectStorageService(config);
  const uploadUrl = new URL(await storage.getObjectEntityUploadURL("image/png"));
  assert.equal(uploadUrl.origin, config.publicEndpoint);
  assert.match(uploadUrl.pathname, /^\/consultation-attachments\/uploads\/[0-9a-f-]+$/i);
  assert.ok(uploadUrl.searchParams.has("X-Amz-Signature"));
  assert.match(uploadUrl.searchParams.get("X-Amz-SignedHeaders") ?? "", /content-type/);
});

test("MinIO object handles expose metadata, streams, and deletion", async () => {
  const commands: unknown[] = [];
  const fakeClient = {
    send: async (command: unknown) => {
      commands.push(command);
      if (command instanceof GetObjectCommand) {
        const { Readable } = await import("node:stream");
        return { Body: Readable.from(["private file"]) };
      }
      if (command instanceof HeadObjectCommand) {
        return { ContentLength: 321, ContentType: "application/pdf" };
      }
      return {};
    },
  } as unknown as S3Client;
  const storage = new MinioObjectStorageService(config, {
    client: fakeClient,
    presignerClient: fakeClient,
    signUrl: async () => "unused",
  });

  const file = await storage.getObjectEntityFile("/objects/uploads/test-id");
  assert.deepEqual(await file.getMetadata(), [{ size: 321, contentType: "application/pdf" }]);
  const body = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    file.createReadStream()
      .on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
      .on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
      .on("error", reject);
  });
  assert.equal(body, "private file");
  await file.delete();
  assert.ok(commands.some((command) => command instanceof HeadObjectCommand));
  assert.ok(commands.some((command) => command instanceof GetObjectCommand));
  assert.ok(commands.some((command) => command instanceof DeleteObjectCommand));
});
