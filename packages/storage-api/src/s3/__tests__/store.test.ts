import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createBucket,
  getObjectMetadata,
  initS3Store,
  putObject,
  type S3StoreConfig,
} from "../store";

describe("S3 object store path isolation", () => {
  let testRoot: string | undefined;

  afterEach(async () => {
    if (testRoot) await rm(testRoot, { recursive: true, force: true });
    testRoot = undefined;
  });

  it("stores traversal-looking object keys only under the hashed object namespace", async () => {
    testRoot = await mkdtemp(join(tmpdir(), "deniz-s3-store-test-"));
    const config: S3StoreConfig = {
      rootPath: join(testRoot, "store"),
      tempPath: join(testRoot, "temp"),
      region: "eu-west-1",
    };
    await initS3Store(config);
    await createBucket(config, "path-isolation-test");

    const key = "../../outside.txt";
    await putObject(
      config,
      "path-isolation-test",
      key,
      new Request("http://localhost/object", {
        method: "PUT",
        body: "safe",
        headers: { "x-amz-content-sha256": "UNSIGNED-PAYLOAD" },
      }),
    );

    expect((await getObjectMetadata(config, "path-isolation-test", key)).key).toBe(key);
    await expect(stat(join(dirname(config.rootPath), "outside.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
