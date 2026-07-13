import { createHash } from "node:crypto";
import { copyFile, mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { assertPayloadHash, requestPayloadHash } from "./auth";
import { S3Error } from "./errors";
import type { CompletedPart } from "./xml";

const BUCKET_DESCRIPTOR = "bucket.json";
const MIN_MULTIPART_PART_SIZE = 5 * 1024 * 1024;
const MAX_OBJECT_KEY_BYTES = 1024;
const MAX_LIST_KEYS = 1000;

export interface S3StoreConfig {
  rootPath: string;
  tempPath: string;
  region: string;
}

interface BucketDescriptor {
  name: string;
  creationDate: string;
}

export interface ObjectMetadata {
  key: string;
  size: number;
  etag: string;
  contentType: string;
  lastModified: string;
  headers: Record<string, string>;
}

interface MultipartDescriptor {
  uploadId: string;
  bucket: string;
  key: string;
  initiated: string;
  contentType: string;
  headers: Record<string, string>;
}

interface PartMetadata {
  partNumber: number;
  size: number;
  etag: string;
  lastModified: string;
}

export interface ObjectListResult {
  objects: ObjectMetadata[];
  commonPrefixes: string[];
  keyCount: number;
  maxKeys: number;
  isTruncated: boolean;
  nextContinuationToken?: string;
}

function bucketPath(config: S3StoreConfig, bucket: string): string {
  return join(config.rootPath, bucket);
}

function descriptorPath(config: S3StoreConfig, bucket: string): string {
  return join(bucketPath(config, bucket), BUCKET_DESCRIPTOR);
}

function metadataDir(config: S3StoreConfig, bucket: string): string {
  return join(bucketPath(config, bucket), "metadata");
}

function objectDir(config: S3StoreConfig, bucket: string): string {
  return join(bucketPath(config, bucket), "objects");
}

function keyHash(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function metadataPath(config: S3StoreConfig, bucket: string, key: string): string {
  return join(metadataDir(config, bucket), `${keyHash(key)}.json`);
}

function objectPath(config: S3StoreConfig, bucket: string, key: string): string {
  return join(objectDir(config, bucket), `${keyHash(key)}.data`);
}

function uploadDir(config: S3StoreConfig, uploadId: string): string {
  if (!uploadId.match(/^[0-9a-f-]{36}$/i)) {
    throw new S3Error("NoSuchUpload", "The specified multipart upload does not exist.", 404);
  }
  return join(config.tempPath, "multipart", uploadId);
}

function validateBucketName(bucket: string): void {
  const valid =
    bucket.length >= 3 &&
    bucket.length <= 63 &&
    /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket) &&
    !bucket.includes("..") &&
    !bucket.includes(".-") &&
    !bucket.includes("-.") &&
    !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(bucket) &&
    !bucket.startsWith("xn--") &&
    !bucket.endsWith("-s3alias") &&
    !bucket.endsWith("--ol-s3");

  if (!valid) {
    throw new S3Error("InvalidBucketName", "The specified bucket is not valid.", 400, bucket);
  }
}

export function validateObjectKey(key: string): void {
  if (!key || Buffer.byteLength(key, "utf8") > MAX_OBJECT_KEY_BYTES || key.includes("\0")) {
    throw new S3Error(
      "InvalidArgument",
      "Object key must contain between 1 and 1024 UTF-8 bytes.",
      400,
      key,
    );
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function hasErrorCode(error: unknown, ...codes: string[]): boolean {
  return error instanceof Error && "code" in error && codes.includes(String(error.code));
}

async function readJson<T>(path: string): Promise<T> {
  return Bun.file(path).json() as Promise<T>;
}

async function writeJsonAtomic(path: string, value: unknown, tempPath: string): Promise<void> {
  const temporary = join(tempPath, `${crypto.randomUUID()}.json.tmp`);
  await mkdir(tempPath, { recursive: true });
  await Bun.write(temporary, JSON.stringify(value));
  await replaceFile(temporary, path);
}

async function replaceFile(source: string, target: string): Promise<void> {
  try {
    await rename(source, target);
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST", "EPERM")) throw error;
    await rm(target, { force: true });
    await rename(source, target);
  }
}

async function hashFile(path: string): Promise<{ sha256: string; md5: string; size: number }> {
  const sha256 = createHash("sha256");
  const md5 = createHash("md5");
  let size = 0;
  for await (const chunk of Bun.file(path).stream()) {
    sha256.update(chunk);
    md5.update(chunk);
    size += chunk.byteLength;
  }
  return { sha256: sha256.digest("hex"), md5: md5.digest("hex"), size };
}

async function writeRequestBody(
  path: string,
  body: ReadableStream<Uint8Array> | null,
): Promise<void> {
  const file = await open(path, "w");
  let position = 0;
  try {
    if (!body) return;
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      let chunkOffset = 0;
      while (chunkOffset < value.byteLength) {
        const { bytesWritten } = await file.write(
          value,
          chunkOffset,
          value.byteLength - chunkOffset,
          position,
        );
        chunkOffset += bytesWritten;
        position += bytesWritten;
      }
    }
  } finally {
    await file.close();
  }
}

function validateContentLength(request: Request, actualSize: number): void {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number.parseInt(contentLength, 10) !== actualSize) {
    throw new S3Error(
      "IncompleteBody",
      "The request body terminated before the declared content length.",
      400,
    );
  }
}

function validateContentMd5(request: Request, md5: string): void {
  const expected = request.headers.get("content-md5");
  if (expected && Buffer.from(md5, "hex").toString("base64") !== expected) {
    throw new S3Error(
      "BadDigest",
      "The Content-MD5 you specified did not match what we received.",
      400,
    );
  }
}

function storedHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  const standard = [
    "cache-control",
    "content-disposition",
    "content-encoding",
    "content-language",
    "expires",
  ];
  for (const name of standard) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  for (const [name, value] of request.headers) {
    if (name.startsWith("x-amz-meta-")) headers[name] = value;
  }
  return headers;
}

async function requireBucket(config: S3StoreConfig, bucket: string): Promise<BucketDescriptor> {
  validateBucketName(bucket);
  const path = descriptorPath(config, bucket);
  if (!(await pathExists(path))) {
    throw new S3Error("NoSuchBucket", "The specified bucket does not exist.", 404, bucket);
  }
  return readJson<BucketDescriptor>(path);
}

async function finalizeObject(
  config: S3StoreConfig,
  bucket: string,
  key: string,
  temporaryDataPath: string,
  values: Omit<ObjectMetadata, "key" | "lastModified"> & { lastModified?: string },
): Promise<ObjectMetadata> {
  await requireBucket(config, bucket);
  const finalDataPath = objectPath(config, bucket, key);
  const finalMetadataPath = metadataPath(config, bucket, key);
  const metadata: ObjectMetadata = {
    key,
    ...values,
    lastModified: values.lastModified ?? new Date().toISOString(),
  };

  await replaceFile(temporaryDataPath, finalDataPath);
  try {
    await writeJsonAtomic(finalMetadataPath, metadata, config.tempPath);
  } catch (error) {
    await rm(finalDataPath, { force: true });
    throw error;
  }
  return metadata;
}

export async function initS3Store(config: S3StoreConfig): Promise<void> {
  await Promise.all([
    mkdir(config.rootPath, { recursive: true }),
    mkdir(config.tempPath, { recursive: true }),
    mkdir(join(config.tempPath, "multipart"), { recursive: true }),
  ]);
}

export async function createBucket(config: S3StoreConfig, bucket: string): Promise<void> {
  validateBucketName(bucket);
  const path = bucketPath(config, bucket);
  if (await pathExists(descriptorPath(config, bucket))) {
    throw new S3Error(
      "BucketAlreadyOwnedByYou",
      "Your previous request to create the named bucket succeeded and you already own it.",
      409,
      bucket,
    );
  }

  await mkdir(join(path, "metadata"), { recursive: true });
  await mkdir(join(path, "objects"), { recursive: true });
  const descriptor: BucketDescriptor = { name: bucket, creationDate: new Date().toISOString() };
  await writeJsonAtomic(descriptorPath(config, bucket), descriptor, config.tempPath);
}

export async function listBuckets(config: S3StoreConfig): Promise<BucketDescriptor[]> {
  const entries = await readdir(config.rootPath, { withFileTypes: true });
  const buckets: BucketDescriptor[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = descriptorPath(config, entry.name);
    if (await pathExists(path)) buckets.push(await readJson<BucketDescriptor>(path));
  }
  return buckets.sort((left, right) => left.name.localeCompare(right.name));
}

export async function headBucket(config: S3StoreConfig, bucket: string): Promise<void> {
  await requireBucket(config, bucket);
}

export async function deleteBucket(config: S3StoreConfig, bucket: string): Promise<void> {
  await requireBucket(config, bucket);
  const metadataEntries = await readdir(metadataDir(config, bucket));
  if (metadataEntries.some((entry) => entry.endsWith(".json"))) {
    throw new S3Error(
      "BucketNotEmpty",
      "The bucket you tried to delete is not empty.",
      409,
      bucket,
    );
  }
  await rm(bucketPath(config, bucket), { recursive: true, force: true });
}

export async function putObject(
  config: S3StoreConfig,
  bucket: string,
  key: string,
  request: Request,
): Promise<ObjectMetadata> {
  validateObjectKey(key);
  await requireBucket(config, bucket);
  const temporary = join(config.tempPath, `${crypto.randomUUID()}.put`);
  try {
    await writeRequestBody(temporary, request.body);
    const hashes = await hashFile(temporary);
    assertPayloadHash(requestPayloadHash(request), hashes.sha256);
    validateContentLength(request, hashes.size);
    validateContentMd5(request, hashes.md5);
    return await finalizeObject(config, bucket, key, temporary, {
      size: hashes.size,
      etag: hashes.md5,
      contentType: request.headers.get("content-type") ?? "application/octet-stream",
      headers: storedHeaders(request),
    });
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function getObjectMetadata(
  config: S3StoreConfig,
  bucket: string,
  key: string,
): Promise<ObjectMetadata> {
  validateObjectKey(key);
  await requireBucket(config, bucket);
  const path = metadataPath(config, bucket, key);
  if (!(await pathExists(path))) {
    throw new S3Error("NoSuchKey", "The specified key does not exist.", 404, key);
  }
  return readJson<ObjectMetadata>(path);
}

export function getObjectFile(config: S3StoreConfig, bucket: string, key: string): Bun.BunFile {
  return Bun.file(objectPath(config, bucket, key));
}

export async function deleteObject(
  config: S3StoreConfig,
  bucket: string,
  key: string,
): Promise<void> {
  validateObjectKey(key);
  await requireBucket(config, bucket);
  await Promise.all([
    rm(metadataPath(config, bucket, key), { force: true }),
    rm(objectPath(config, bucket, key), { force: true }),
  ]);
}

export async function copyObject(
  config: S3StoreConfig,
  sourceBucket: string,
  sourceKey: string,
  targetBucket: string,
  targetKey: string,
  request: Request,
): Promise<ObjectMetadata> {
  const source = await getObjectMetadata(config, sourceBucket, sourceKey);
  validateObjectKey(targetKey);
  await requireBucket(config, targetBucket);
  const temporary = join(config.tempPath, `${crypto.randomUUID()}.copy`);
  await copyFile(objectPath(config, sourceBucket, sourceKey), temporary);
  const replaceMetadata =
    request.headers.get("x-amz-metadata-directive")?.toUpperCase() === "REPLACE";

  try {
    return await finalizeObject(config, targetBucket, targetKey, temporary, {
      size: source.size,
      etag: source.etag,
      contentType: replaceMetadata
        ? (request.headers.get("content-type") ?? "application/octet-stream")
        : source.contentType,
      headers: replaceMetadata ? storedHeaders(request) : source.headers,
    });
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function encodeContinuationToken(key: string): string {
  return Buffer.from(JSON.stringify({ version: 1, key })).toString("base64url");
}

function decodeContinuationToken(token: string): string {
  try {
    const value = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as {
      version?: number;
      key?: string;
    };
    if (value.version !== 1 || typeof value.key !== "string") throw new Error("invalid");
    return value.key;
  } catch {
    throw new S3Error("InvalidArgument", "The continuation token provided is incorrect.", 400);
  }
}

function compareKeys(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export async function listObjects(
  config: S3StoreConfig,
  bucket: string,
  options: {
    prefix: string;
    delimiter?: string;
    maxKeys?: number;
    continuationToken?: string;
    startAfter?: string;
  },
): Promise<ObjectListResult> {
  await requireBucket(config, bucket);
  const maxKeys = Math.min(MAX_LIST_KEYS, Math.max(0, options.maxKeys ?? MAX_LIST_KEYS));
  const metadataFiles = (await readdir(metadataDir(config, bucket))).filter((name) =>
    name.endsWith(".json"),
  );
  const allObjects = await Promise.all(
    metadataFiles.map((name) => readJson<ObjectMetadata>(join(metadataDir(config, bucket), name))),
  );
  const matching = allObjects
    .filter((object) => object.key.startsWith(options.prefix))
    .sort((left, right) => compareKeys(left.key, right.key));

  const entries = new Map<
    string,
    { type: "object"; object: ObjectMetadata } | { type: "prefix"; prefix: string }
  >();
  for (const object of matching) {
    if (options.delimiter) {
      const delimiterIndex = object.key.indexOf(options.delimiter, options.prefix.length);
      if (delimiterIndex >= 0) {
        const commonPrefix = object.key.slice(0, delimiterIndex + options.delimiter.length);
        entries.set(commonPrefix, { type: "prefix", prefix: commonPrefix });
        continue;
      }
    }
    entries.set(object.key, { type: "object", object });
  }

  const after = options.continuationToken
    ? decodeContinuationToken(options.continuationToken)
    : options.startAfter;
  const sortedEntries = [...entries.entries()]
    .sort(([left], [right]) => compareKeys(left, right))
    .filter(([entryKey]) => !after || compareKeys(entryKey, after) > 0);
  const page = sortedEntries.slice(0, maxKeys);
  const isTruncated = sortedEntries.length > page.length;
  const lastKey = page.at(-1)?.[0];

  return {
    objects: page.flatMap(([, entry]) => (entry.type === "object" ? [entry.object] : [])),
    commonPrefixes: page.flatMap(([, entry]) => (entry.type === "prefix" ? [entry.prefix] : [])),
    keyCount: page.length,
    maxKeys,
    isTruncated,
    nextContinuationToken: isTruncated && lastKey ? encodeContinuationToken(lastKey) : undefined,
  };
}

async function readMultipart(
  config: S3StoreConfig,
  uploadId: string,
): Promise<MultipartDescriptor> {
  const path = join(uploadDir(config, uploadId), "upload.json");
  if (!(await pathExists(path))) {
    throw new S3Error("NoSuchUpload", "The specified multipart upload does not exist.", 404);
  }
  return readJson<MultipartDescriptor>(path);
}

async function requireMultipart(
  config: S3StoreConfig,
  bucket: string,
  key: string,
  uploadId: string,
): Promise<MultipartDescriptor> {
  const upload = await readMultipart(config, uploadId);
  if (upload.bucket !== bucket || upload.key !== key) {
    throw new S3Error("NoSuchUpload", "The specified multipart upload does not exist.", 404);
  }
  return upload;
}

export async function createMultipartUpload(
  config: S3StoreConfig,
  bucket: string,
  key: string,
  request: Request,
): Promise<MultipartDescriptor> {
  validateObjectKey(key);
  await requireBucket(config, bucket);
  const uploadId = crypto.randomUUID();
  const upload: MultipartDescriptor = {
    uploadId,
    bucket,
    key,
    initiated: new Date().toISOString(),
    contentType: request.headers.get("content-type") ?? "application/octet-stream",
    headers: storedHeaders(request),
  };
  const path = uploadDir(config, uploadId);
  await mkdir(path, { recursive: true });
  await Bun.write(join(path, "upload.json"), JSON.stringify(upload));
  return upload;
}

export async function uploadPart(
  config: S3StoreConfig,
  bucket: string,
  key: string,
  uploadId: string,
  partNumber: number,
  request: Request,
): Promise<PartMetadata> {
  await requireMultipart(config, bucket, key, uploadId);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
    throw new S3Error(
      "InvalidArgument",
      "Part number must be an integer between 1 and 10000.",
      400,
    );
  }
  const directory = uploadDir(config, uploadId);
  const partPath = join(directory, `${partNumber}.part`);
  try {
    await writeRequestBody(partPath, request.body);
    const hashes = await hashFile(partPath);
    assertPayloadHash(requestPayloadHash(request), hashes.sha256);
    validateContentLength(request, hashes.size);
    validateContentMd5(request, hashes.md5);
    const metadata: PartMetadata = {
      partNumber,
      size: hashes.size,
      etag: hashes.md5,
      lastModified: new Date().toISOString(),
    };
    await writeJsonAtomic(join(directory, `${partNumber}.json`), metadata, config.tempPath);
    return metadata;
  } catch (error) {
    await rm(partPath, { force: true });
    throw error;
  }
}

export async function listParts(
  config: S3StoreConfig,
  bucket: string,
  key: string,
  uploadId: string,
): Promise<{ upload: MultipartDescriptor; parts: PartMetadata[] }> {
  const upload = await requireMultipart(config, bucket, key, uploadId);
  const names = (await readdir(uploadDir(config, uploadId))).filter((name) =>
    /^\d+\.json$/.test(name),
  );
  const parts = await Promise.all(
    names.map((name) => readJson<PartMetadata>(join(uploadDir(config, uploadId), name))),
  );
  return { upload, parts: parts.sort((left, right) => left.partNumber - right.partNumber) };
}

export async function completeMultipartUpload(
  config: S3StoreConfig,
  bucket: string,
  key: string,
  uploadId: string,
  completedParts: CompletedPart[],
): Promise<ObjectMetadata> {
  const upload = await requireMultipart(config, bucket, key, uploadId);
  const directory = uploadDir(config, uploadId);
  const outputPath = join(config.tempPath, `${crypto.randomUUID()}.complete`);
  const output = await open(outputPath, "w");
  const partMd5s: Buffer[] = [];
  let totalSize = 0;
  let previousPartNumber = 0;

  try {
    for (const [index, completed] of completedParts.entries()) {
      if (completed.partNumber <= previousPartNumber) {
        throw new S3Error("InvalidPartOrder", "The list of parts was not in ascending order.", 400);
      }
      previousPartNumber = completed.partNumber;
      let part: PartMetadata;
      try {
        part = await readJson<PartMetadata>(join(directory, `${completed.partNumber}.json`));
      } catch {
        throw new S3Error(
          "InvalidPart",
          "One or more of the specified parts could not be found.",
          400,
        );
      }
      if (
        part.etag !== completed.etag ||
        (index < completedParts.length - 1 && part.size < MIN_MULTIPART_PART_SIZE)
      ) {
        throw new S3Error("InvalidPart", "One or more parts were invalid or too small.", 400);
      }
      const partFile = Bun.file(join(directory, `${completed.partNumber}.part`));
      for await (const chunk of partFile.stream()) {
        let chunkOffset = 0;
        while (chunkOffset < chunk.byteLength) {
          const { bytesWritten } = await output.write(
            chunk,
            chunkOffset,
            chunk.byteLength - chunkOffset,
            totalSize,
          );
          chunkOffset += bytesWritten;
          totalSize += bytesWritten;
        }
      }
      partMd5s.push(Buffer.from(part.etag, "hex"));
    }
  } catch (error) {
    await output.close();
    await rm(outputPath, { force: true });
    throw error;
  }
  await output.close();

  const etag = `${createHash("md5").update(Buffer.concat(partMd5s)).digest("hex")}-${completedParts.length}`;
  try {
    const metadata = await finalizeObject(config, bucket, key, outputPath, {
      size: totalSize,
      etag,
      contentType: upload.contentType,
      headers: upload.headers,
    });
    await rm(directory, { recursive: true, force: true });
    return metadata;
  } catch (error) {
    await rm(outputPath, { force: true });
    throw error;
  }
}

export async function abortMultipartUpload(
  config: S3StoreConfig,
  bucket: string,
  key: string,
  uploadId: string,
): Promise<void> {
  await requireMultipart(config, bucket, key, uploadId);
  await rm(uploadDir(config, uploadId), { recursive: true, force: true });
}

export async function listMultipartUploads(
  config: S3StoreConfig,
  bucket: string,
): Promise<MultipartDescriptor[]> {
  await requireBucket(config, bucket);
  const root = join(config.tempPath, "multipart");
  const entries = await readdir(root, { withFileTypes: true });
  const uploads: MultipartDescriptor[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const upload = await readMultipart(config, entry.name);
      if (upload.bucket === bucket) uploads.push(upload);
    } catch {}
  }
  return uploads.sort((left, right) => left.key.localeCompare(right.key));
}
