import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Hono } from "hono";
import { initializeS3, s3Routes } from "../s3";

const ACCESS_KEY_ID = "deniz-cloud-test";
const SECRET_ACCESS_KEY = "test-secret-access-key-change-me";
const REGION = "eu-west-1";
const BUCKET = "sdk-compatibility-test";

describe("S3-compatible /v2 API", () => {
  let root: string;
  let server: ReturnType<typeof Bun.serve>;
  let client: S3Client;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "deniz-s3-test-"));
    const config = {
      enabled: true,
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
      region: REGION,
      rootPath: join(root, "objects"),
      tempPath: join(root, "temp"),
    };
    await initializeS3(config);
    const app = new Hono();
    app.route("/v2", s3Routes(config));
    server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: app.fetch });
    client = new S3Client({
      endpoint: `http://127.0.0.1:${server.port}/v2`,
      forcePathStyle: true,
      region: REGION,
      credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
    });
  });

  afterAll(async () => {
    client?.destroy();
    server?.stop(true);
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("works end-to-end through the official AWS SDK", async () => {
    await expect(client.send(new HeadBucketCommand({ Bucket: BUCKET }))).rejects.toMatchObject({
      name: "NotFound",
      $metadata: { httpStatusCode: 404 },
    });

    await client.send(new CreateBucketCommand({ Bucket: BUCKET }));

    await expect(client.send(new HeadBucketCommand({ Bucket: BUCKET }))).resolves.toBeDefined();

    const listedBuckets = await client.send(new ListBucketsCommand({}));
    expect(listedBuckets.Buckets?.map((bucket) => bucket.Name)).toContain(BUCKET);

    const key = "relatórios/avó.txt";
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: new TextEncoder().encode("hello from the AWS SDK"),
        ContentType: "text/plain; charset=utf-8",
        Metadata: { source: "integration-test" },
      }),
    );

    const head = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    expect(head.ContentLength).toBe(22);
    expect(head.ContentType).toBe("text/plain; charset=utf-8");
    expect(head.Metadata?.source).toBe("integration-test");

    const object = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    expect(await object.Body?.transformToString()).toBe("hello from the AWS SDK");

    const range = await client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: "bytes=6-9" }),
    );
    expect(await range.Body?.transformToString()).toBe("from");
    expect(range.ContentRange).toBe("bytes 6-9/22");

    const folders = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Delimiter: "/" }));
    expect(folders.CommonPrefixes?.map((prefix) => prefix.Prefix)).toContain("relatórios/");

    const copyKey = "copies/avó.txt";
    await client.send(
      new CopyObjectCommand({ Bucket: BUCKET, Key: copyKey, CopySource: `${BUCKET}/${key}` }),
    );
    const copied = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: copyKey }));
    expect(await copied.Body?.transformToString()).toBe("hello from the AWS SDK");

    const multipartKey = "multipart.bin";
    const initiated = await client.send(
      new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: multipartKey }),
    );
    const part = await client.send(
      new UploadPartCommand({
        Bucket: BUCKET,
        Key: multipartKey,
        UploadId: initiated.UploadId,
        PartNumber: 1,
        Body: new Uint8Array([1, 2, 3, 4]),
      }),
    );
    await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: BUCKET,
        Key: multipartKey,
        UploadId: initiated.UploadId,
        MultipartUpload: { Parts: [{ PartNumber: 1, ETag: part.ETag }] },
      }),
    );
    const multipart = await client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: multipartKey }),
    );
    const multipartBytes = await multipart.Body?.transformToByteArray();
    expect(multipartBytes).toBeDefined();
    expect([...(multipartBytes ?? [])]).toEqual([1, 2, 3, 4]);

    const signedUrl = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
      { expiresIn: 60 },
    );
    const signedResponse = await fetch(signedUrl);
    const signedBody = await signedResponse.text();
    expect(signedResponse.status).toBe(200);
    expect(signedBody).toBe("hello from the AWS SDK");

    const tamperedUrl = `${signedUrl}&tampered=true`;
    expect((await fetch(tamperedUrl)).status).toBe(403);

    const badClient = new S3Client({
      endpoint: `http://127.0.0.1:${server.port}/v2`,
      forcePathStyle: true,
      region: REGION,
      maxAttempts: 1,
      credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: "wrong-secret" },
    });
    await expect(badClient.send(new ListBucketsCommand({}))).rejects.toMatchObject({
      name: "SignatureDoesNotMatch",
    });
    badClient.destroy();

    const unauthorized = await fetch(`http://127.0.0.1:${server.port}/v2/${BUCKET}`);
    expect(unauthorized.status).toBe(403);
    expect(await unauthorized.text()).toContain("<Code>AccessDenied</Code>");

    await client.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: {
          Objects: [{ Key: key }, { Key: copyKey }, { Key: multipartKey }],
        },
      }),
    );
    await client.send(new DeleteBucketCommand({ Bucket: BUCKET }));
  }, 30_000);
});
