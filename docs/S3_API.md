# S3-compatible storage API

The storage service exposes an isolated, filesystem-backed S3 API at:

```text
https://storage.denizlg24.com/v2
```

It uses AWS Signature Version 4 and path-style addressing. The existing `/api/*` storage API and its Postgres file metadata are unchanged; S3 buckets and objects live under `S3_ROOT_PATH` (by default `SSD_STORAGE_PATH/.s3-v2`).

The machine-readable [OpenAPI 3.1 specification](./storage-s3-v2.openapi.yaml) documents the supported routes, dispatch variants, request parameters, XML schemas, and authentication requirements.

> **Credential scope:** the current implementation uses one service-wide access key and secret. It is not wired into admin project API-key provisioning, and it can access every v2 bucket.

Superusers can reveal and copy the configured endpoint, region, access key, and secret from the **S3 Storage** section on any project detail page in the admin panel. The values shown there are shared across projects.

## Configuration

Set both credentials to enable the API:

```dotenv
S3_ACCESS_KEY_ID=<random-access-key-id>
S3_SECRET_ACCESS_KEY=<long-random-secret>
S3_REGION=eu-west-1
```

Use a high-entropy secret, keep the endpoint behind HTTPS, and restart the storage container after changing credentials. If either credential is missing, `/v2/*` returns `ServiceUnavailable` while the legacy service continues to run.

Optional storage overrides:

```dotenv
S3_ROOT_PATH=/data/ssd/.s3-v2
S3_TEMP_PATH=/data/ssd/.s3-v2-temp
```

## SDK setup

All clients need the custom endpoint, configured region, credentials, and path-style addressing. For AWS SDK for JavaScript v3:

```ts
import { S3Client } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  endpoint: "https://storage.denizlg24.com/v2",
  region: "eu-west-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});
```

For boto3:

```py
from boto3 import client
from botocore.config import Config

s3 = client(
    "s3",
    endpoint_url="https://storage.denizlg24.com/v2",
    region_name="eu-west-1",
    aws_access_key_id="...",
    aws_secret_access_key="...",
    config=Config(s3={"addressing_style": "path"}),
)
```

## Supported operations

- Bucket create, list, head, and delete
- Object put, get, head, copy, delete, and multi-object delete
- `ListObjectsV2` with prefix, delimiter, pagination, and URL encoding
- Single HTTP byte ranges and conditional object reads
- Multipart create, upload part, list parts, complete, abort, and list uploads
- SigV4 authorization headers and presigned URLs
- Content type, standard representation headers, and `x-amz-meta-*` metadata

The API does not currently implement virtual-host addressing, ACLs, policies, versioning, lifecycle rules, object tagging, server-side encryption, browser POST policies, or SigV4 `aws-chunked` streaming payloads. Use ordinary signed PUTs or multipart upload for large objects.

S3 objects are deliberately separate from legacy files: they do not appear in the web file browser, Meilisearch index, or SSD/HDD tiering workflow.
