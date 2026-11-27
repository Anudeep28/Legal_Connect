import { randomUUID } from 'crypto';
import { PassThrough, Readable } from 'stream';
import { File, Storage } from '@google-cloud/storage';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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

type MinioConfig = {
  endpoint: string;
  publicEndpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

type MinioDependencies = {
  client?: S3Client;
  presignerClient?: S3Client;
  signUrl?: typeof getSignedUrl;
};

function minioConfigFromEnv(): MinioConfig {
  const required = (name: string) => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} must be set when OBJECT_STORAGE_PROVIDER=minio.`);
    return value;
  };
  const endpoint = new URL(required('MINIO_ENDPOINT'));
  const publicEndpoint = new URL(required('MINIO_PUBLIC_ENDPOINT'));
  if (endpoint.pathname !== '/' || publicEndpoint.pathname !== '/') {
    throw new Error('MINIO_ENDPOINT and MINIO_PUBLIC_ENDPOINT must not include a URL path.');
  }
  if (process.env.NODE_ENV === 'production' && publicEndpoint.protocol !== 'https:') {
    throw new Error('MINIO_PUBLIC_ENDPOINT must use HTTPS in production.');
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || !['http:', 'https:'].includes(publicEndpoint.protocol)) {
    throw new Error('MinIO endpoints must use HTTP or HTTPS.');
  }
  return {
    endpoint: endpoint.origin,
    publicEndpoint: publicEndpoint.origin,
    bucket: required('MINIO_BUCKET'),
    region: process.env.MINIO_REGION?.trim() || 'us-east-1',
    accessKeyId: required('MINIO_ACCESS_KEY'),
    secretAccessKey: required('MINIO_SECRET_KEY'),
  };
}

class MinioObjectEntityFile implements ObjectEntityFile {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly key: string,
  ) {}

  async getMetadata(): Promise<[ObjectEntityMetadata]> {
    const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key }));
    return [{
      size: result.ContentLength,
      contentType: result.ContentType,
    }];
  }

  async delete(): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key }));
  }

  createReadStream(): Readable {
    const output = new PassThrough();
    void this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key }))
      .then((result) => {
        const body = result.Body;
        if (body instanceof Readable) body.pipe(output);
        else if (body) output.destroy(new Error('MinIO returned an unsupported object stream.'));
        else output.destroy(new Error('MinIO returned an empty object stream.'));
      })
      .catch((error: unknown) => output.destroy(error instanceof Error ? error : new Error('MinIO object download failed.')));
    return output;
  }
}

/**
 * MinIO is private to the app server. The browser receives a short-lived,
 * content-type-bound upload URL through the public HTTPS MinIO endpoint.
 */
export class MinioObjectStorageService {
  private readonly client: S3Client;
  private readonly presignerClient: S3Client;
  private readonly signUrl: typeof getSignedUrl;

  constructor(config = minioConfigFromEnv(), dependencies: MinioDependencies = {}) {
    const credentials = { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey };
    const options = { region: config.region, credentials, forcePathStyle: true };
    this.client = dependencies.client ?? new S3Client({ ...options, endpoint: config.endpoint });
    this.presignerClient = dependencies.presignerClient ?? new S3Client({ ...options, endpoint: config.publicEndpoint });
    this.signUrl = dependencies.signUrl ?? getSignedUrl;
    this.config = config;
  }

  private readonly config: MinioConfig;

  async getObjectEntityUploadURL(contentType: string): Promise<string> {
    const key = `uploads/${randomUUID()}`;
    return this.signUrl(
      this.presignerClient,
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key, ContentType: contentType }),
      { expiresIn: 900, signableHeaders: new Set(['content-type']) },
    );
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (rawPath.startsWith('/objects/')) return rawPath;
    let url: URL;
    try {
      url = new URL(rawPath);
    } catch {
      return rawPath;
    }
    if (url.origin !== this.config.publicEndpoint) return rawPath;
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.shift() !== this.config.bucket || segments.length === 0) return rawPath;
    const key = segments.map((segment) => decodeURIComponent(segment)).join('/');
    return `/objects/${key}`;
  }

  async getObjectEntityFile(objectPath: string): Promise<ObjectEntityFile> {
    if (!objectPath.startsWith('/objects/')) throw new ObjectNotFoundError();
    const key = objectPath.slice('/objects/'.length);
    if (!key || key.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new ObjectNotFoundError();
    }
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      const name = (error as { name?: string })?.name;
      if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') throw new ObjectNotFoundError();
      throw error;
    }
    return new MinioObjectEntityFile(this.client, this.config.bucket, key);
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
  private readonly minio: MinioObjectStorageService | null;

  constructor() {
    const provider = process.env.OBJECT_STORAGE_PROVIDER || 'replit';
    if (provider !== 'replit' && provider !== 'minio') {
      throw new Error(`Unsupported OBJECT_STORAGE_PROVIDER: ${provider}`);
    }
    this.minio = provider === 'minio' ? new MinioObjectStorageService() : null;
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

  async getObjectEntityUploadURL(contentType?: string): Promise<string> {
    if (this.minio) {
      if (!contentType) throw new Error('A content type is required to sign a MinIO upload.');
      return this.minio.getObjectEntityUploadURL(contentType);
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
    if (this.minio) return this.minio.getObjectEntityFile(objectPath);
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
    if (this.minio) return this.minio.normalizeObjectEntityPath(rawPath);
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

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith('/')) {
      return normalizedPath;
    }

    if (this.minio) {
      throw new Error('Object ACL metadata is not used for MinIO attachments; keep authorization in the application database.');
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
