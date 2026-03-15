import { describe, expect, test } from "bun:test";
import { SESSION_COOKIE_MAX_AGE, sessionCookieOptions } from "../cookie";

describe("sessionCookieOptions", () => {
  test("returns httpOnly cookie settings", () => {
    const opts = sessionCookieOptions("dc_session");
    expect(opts.httpOnly).toBe(true);
  });

  test("includes the cookie name", () => {
    const opts = sessionCookieOptions("my-cookie");
    expect(opts.name).toBe("my-cookie");
  });

  test("sets sameSite to Lax", () => {
    const opts = sessionCookieOptions("dc_session");
    expect(opts.sameSite).toBe("Lax");
  });

  test("scopes path to /api", () => {
    const opts = sessionCookieOptions("dc_session");
    expect(opts.path).toBe("/api");
  });

  test("sets maxAge to SESSION_COOKIE_MAX_AGE (24h)", () => {
    const opts = sessionCookieOptions("dc_session");
    expect(opts.maxAge).toBe(SESSION_COOKIE_MAX_AGE);
    expect(SESSION_COOKIE_MAX_AGE).toBe(86400);
  });

  test("secure flag depends on NODE_ENV", () => {
    const opts = sessionCookieOptions("dc_session");
    const expected = process.env.NODE_ENV === "production";
    expect(opts.secure).toBe(expected);
  });
});
