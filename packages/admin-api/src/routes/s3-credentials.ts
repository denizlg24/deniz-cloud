import { Hono } from "hono";

export interface S3CredentialsConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export function s3CredentialsRoutes(config: S3CredentialsConfig): Hono {
  const app = new Hono();

  app.get("/", (context) => {
    context.header("Cache-Control", "private, no-store, max-age=0");
    context.header("Pragma", "no-cache");

    if (!config.accessKeyId || !config.secretAccessKey) {
      return context.json({
        data: {
          enabled: false as const,
          endpoint: config.endpoint,
          region: config.region,
          shared: true as const,
        },
      });
    }

    return context.json({
      data: {
        enabled: true as const,
        endpoint: config.endpoint,
        region: config.region,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        shared: true as const,
      },
    });
  });

  return app;
}
