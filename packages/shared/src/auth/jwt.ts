import { jwtVerify, SignJWT } from "jose";
import type { UserRole } from "../db/schema";

export interface SessionTokenPayload {
  sub: string;
  role: UserRole;
  sid: string;
}

function isUserRole(value: unknown): value is UserRole {
  return value === "superuser" || value === "user";
}

export async function signSessionToken(
  payload: SessionTokenPayload,
  secret: string,
  expiresIn: string = "24h",
): Promise<string> {
  const key = new TextEncoder().encode(secret);

  return new SignJWT({ role: payload.role, sid: payload.sid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

export async function verifySessionToken(
  token: string,
  secret: string,
): Promise<SessionTokenPayload> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key);

  const { sub, sid, role } = payload;

  if (typeof sub !== "string") {
    throw new Error("Invalid token: missing subject");
  }
  if (typeof sid !== "string") {
    throw new Error("Invalid token: missing session ID");
  }
  if (!isUserRole(role)) {
    throw new Error("Invalid token: invalid role");
  }

  return { sub, role, sid };
}
