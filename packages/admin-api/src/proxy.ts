import type { Context } from "hono";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

const STRIP_RESPONSE_HEADERS = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "content-encoding",
  "content-length",
]);

export function createProxyHandler(targetBase: string, stripPrefix: string) {
  return async (c: Context) => {
    const path = c.req.path.replace(stripPrefix, "") || "/";
    const search = new URL(c.req.url).search;
    const targetUrl = `${targetBase}${path}${search}`;

    const reqHeaders = new Headers();
    for (const [key, value] of c.req.raw.headers.entries()) {
      if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase()) && key.toLowerCase() !== "host") {
        reqHeaders.set(key, value);
      }
    }

    const hasBody = c.req.method !== "GET" && c.req.method !== "HEAD";

    const upstream = await fetch(targetUrl, {
      method: c.req.method,
      headers: reqHeaders,
      body: hasBody ? c.req.raw.body : undefined,
      redirect: "manual",
    });

    const respHeaders = new Headers();
    for (const [key, value] of upstream.headers.entries()) {
      const lower = key.toLowerCase();
      if (!HOP_BY_HOP_HEADERS.has(lower) && !STRIP_RESPONSE_HEADERS.has(lower)) {
        respHeaders.set(key, value);
      }
    }

    if (upstream.headers.has("location")) {
      const location = upstream.headers.get("location");
      if (location?.startsWith("/")) {
        respHeaders.set("location", `${stripPrefix}${location}`);
      }
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  };
}
