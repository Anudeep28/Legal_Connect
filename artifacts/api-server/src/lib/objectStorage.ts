import { randomUUID } from 'crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'node:stream/promises';
import { File, Storage } from '@google-cloud/storage';

import {
  canAccessObject,
  getObjectAclPolicy,
  ObjectAclPolicy,
  ObjectPermission,
  setObjectAclPolicy,
} from './objectAcl';

const REPLIT_SIDECAR_ENDPOINT = 'http://127.0.0.1:1106';

export interface ObjectEntityMetadata {
  size?: number | string;
  contentType?: string;
}

export interface ObjectEntityFile {
  getMetadata(): Promise<[ObjectEntityMetadata, ...unknown[]]>;
  delete(): Promise<unknown>;
  createReadStream(): Readable;
}

export type ObjectEntityUploadContext = {
  consultationId: string;
  attachmentId: string;
};

class ObjectUploadTooLargeError extends Error {
  readonly type = 'entity.too.large';

  constructor() {
    super('Uploaded object exceeds the allowed size.');
    this.name = 'ObjectUploadTooLargeError';
  }
}

class LocalObjectEntityFile implements ObjectEntityFile {
  constructor(
    private readonly filePath: string,
    private readonly metadataPath: string,
  ) {}

  async getMetadata(): Promise<[ObjectEntityMetadata]> {
    const [details, metadataContents] = await Promise.all([
      stat(this.filePath),
      readFile(this.metadataPath, 'utf8'),
    ]);
    const metadata = JSON.parse(metadataContents) as { contentType?: unknown };
    return [{
      size: details.size,
      contentType: typeof metadata.contentType === 'string' ? metadata.contentType : undefined,
    }];
  }

  async delete(): Promise<void> {
    await Promise.all([
      unlink(this.filePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      }),
      unlink(this.metadataPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      }),
    ]);
  }

  createReadStream(): Readable {
    return createReadStream(this.filePath);
  }
}

class LocalFilesystemObjectStorageService {
  private readonly root: string;

  constructor(root = process.env.LOCAL_OBJECT_STORAGE_DIR?.trim()) {
    if (!root) throw new Error('LOCAL_OBJECT_STORAGE_DIR must be set when OBJECT_STORAGE_PROVIDER=local.');
    if (!path.isAbsolute(root)) throw new Error('LOCAL_OBJECT_STORAGE_DIR must be an absolute path.');
    this.root = path.resolve(root);
  }

  getObjectEntityUploadURL(context: ObjectEntityUploadContext): string {
    const consultationId = encodeURIComponent(context.consultationId);
    const attachmentId = encodeURIComponent(context.attachmentId);
    return `/api/consultations/${consultationId}/attachments/${attachmentId}/upload`;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (rawPath.startsWith('/objects/')) return rawPath;
    try {
      const url = new URL(rawPath, 'http://localhost');
      const match = url.pathname.match(/^\/api\/consultations\/([^/]+)\/attachments\/([^/]+)\/upload$/);
      if (!match) return rawPath;
      return `/objects/${decodeURIComponent(match[1]!)}/${decodeURIComponent(match[2]!)}`;
    } catch {
      return rawPath;
    }
  }

  private resolveObjectPath(objectPath: string): { filePath: string; metadataPath: string } {
    if (!objectPath.startsWith('/objects/')) throw new ObjectNotFoundError();
    const key = objectPath.slice('/objects/'.length);
    const segments = key.split('/');
    if (segments.length !== 2 || segments.some((part) =>
      !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\0'))) {
      throw new ObjectNotFoundError();
    }
    const filePath = path.resolve(this.root, ...segments);
    if (!filePath.startsWith(`${this.root}${path.sep}`)) throw new ObjectNotFoundError();
    return { filePath, metadataPath: `${filePath}.metadata.json` };
  }

  async writeObjectEntityFromStream(
    objectPath: string,
    input: Readable,
    contentType: string,
    maxBytes: number,
  ): Promise<number> {
    const { filePath, metadataPath } = this.resolveObjectPath(objectPath);
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    const temporaryMetadataPath = `${metadataPath}.${randomUUID()}.tmp`;
    let size = 0;
    const byteLimit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > maxBytes) {
          callback(new ObjectUploadTooLargeError());
          return;
        }
        callback(null, chunk);
      },
    });

    try {
      await pipeline(input, byteLimit, createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }));
      if (size === 0) throw new Error('The uploaded file is empty.');
      await writeFile(temporaryMetadataPath, JSON.stringify({ contentType }), { flag: 'wx', mode: 0o600 });
      await rename(temporaryMetadataPath, metadataPath);
      await rename(temporaryPath, filePath);
      return size;
    } catch (error) {
      await Promise.all([
        unlink(temporaryPath).catch(() => undefined),
        unlink(temporaryMetadataPath).catch(() => undefined),
      ]);
      throw error;
    }
  }

  async getObjectEntityFile(objectPath: string): Promise<ObjectEntityFile> {
    const paths = this.resolveObjectPath(objectPath);
    try {
      const details = await stat(paths.filePath);
      if (!details.isFile()) throw new ObjectNotFoundError();
      return new LocalObjectEntityFile(paths.filePath, paths.metadataPath);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ObjectNotFoundError();
      throw error;
    }
  }
}

export const objectStorageClient = new Storage({
  credentials: {
    audience: 'replit',
    subject_token_type: 'access_token',
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: 'external_account',
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: 'json',
        subject_token_field_name: 'access_token',
      },
    },
    universe_domain: 'googleapis.com',
  },
  projectId: '',
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super('Object not found');
    this.name = 'ObjectNotFoundError';
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  private readonly local: LocalFilesystemObjectStorageService | null;

  constructor() {
    const provider = process.env.OBJECT_STORAGE_PROVIDER || 'replit';
    if (provider !== 'replit' && provider !== 'local') {
      throw new Error(`Unsupported OBJECT_STORAGE_PROVIDER: ${provider}`);
    }
    this.local = provider === 'local' ? new LocalFilesystemObjectStorageService() : null;
  }

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || '';
    const paths = Array.from(
      new Set(
        pathsStr
          .split(',')
          .map((path) => path.trim())
          .filter((path) => path.length > 0),
      ),
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          'tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths).',
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || '';
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          'tool and set PRIVATE_OBJECT_DIR env var.',
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(
    file: File,
    cacheTtlSec: number = 3600,
  ): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === 'public';

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      'Content-Type':
        (metadata.contentType as string) || 'application/octet-stream',
      'Cache-Control': `${isPublic ? 'public' : 'private'}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers['Content-Length'] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(
    contentType?: string,
    context?: ObjectEntityUploadContext,
  ): Promise<string> {
    if (this.local) {
      if (!context) throw new Error('Consultation and attachment IDs are required for a local upload.');
      return this.local.getObjectEntityUploadURL(context);
    }
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          'tool and set PRIVATE_OBJECT_DIR env var.',
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: 'PUT',
      ttlSec: 900,
    });
  }

  async getObjectEntityFile(objectPath: string): Promise<ObjectEntityFile> {
    if (this.local) return this.local.getObjectEntityFile(objectPath);
    if (!objectPath.startsWith('/objects/')) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split('/');
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join('/');
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith('/')) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (this.local) return this.local.normalizeObjectEntityPath(rawPath);
    if (!rawPath.startsWith('https://storage.googleapis.com/')) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith('/')) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async writeObjectEntityFromStream(
    objectPath: string,
    input: Readable,
    contentType: string,
    maxBytes: number,
  ): Promise<number> {
    if (!this.local) throw new Error('Authenticated API uploads are only enabled for local object storage.');
    return this.local.writeObjectEntityFromStream(objectPath, input, contentType, maxBytes);
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith('/')) {
      return normalizedPath;
    }

    if (this.local) {
      throw new Error('Object ACL metadata is not used for local attachments; keep authorization in the application database.');
    }
    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile as File, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  const pathParts = path.split('/');
  if (pathParts.length < 3) {
    throw new Error('Invalid path: must contain at least a bucket name');
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join('/');

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`,
    );
  }

  const { signed_url: signedURL } = (await response.json()) as { signed_url: string };
  return signedURL;
}
