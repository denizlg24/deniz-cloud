import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { s3CredentialsRoutes } from "../s3-credentials";

describe("S3 credentials route", () => {
  test("returns configured service-wide credentials without allowing caching", async () => {
    const app = new Hono().route(
      "/",
      s3CredentialsRoutes({
        endpoint: "https://storage.example.test/v2",
        accessKeyId: "test-access-key",
        secretAccessKey: "test-secret-key",
        region: "eu-west-1",
      }),
    );

    const response = await app.request("/");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("Pragma")).toBe("no-cache");
    expect(await response.json()).toEqual({
      data: {
        enabled: true,
        endpoint: "https://storage.example.test/v2",
        region: "eu-west-1",
        accessKeyId: "test-access-key",
        secretAccessKey: "test-secret-key",
        shared: true,
      },
    });
  });

  test("does not return partial credentials when S3 is disabled", async () => {
    const app = new Hono().route(
      "/",
      s3CredentialsRoutes({
        endpoint: "https://storage.example.test/v2",
        accessKeyId: "test-access-key",
        secretAccessKey: "",
        region: "eu-west-1",
      }),
    );

    const response = await app.request("/");

    expect(await response.json()).toEqual({
      data: {
        enabled: false,
        endpoint: "https://storage.example.test/v2",
        region: "eu-west-1",
        shared: true,
      },
    });
  });
});
