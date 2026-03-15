import { createHmac } from "node:crypto";

type ExpiresIn = "30m" | "1d" | "7d" | "30d" | "never";

const DURATIONS_MS: Record<ExpiresIn, number> = {
  "30m": 30 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  never: 0,
};

function deriveKey(jwtSecret: string): string {
  return createHmac("sha256", jwtSecret).update("dc-share-link").digest("hex");
}

function sign(fileId: string, expiresAt: number, key: string): string {
  return createHmac("sha256", key).update(`${fileId}:${expiresAt}`).digest("hex");
}

export function generateShareToken(
  fileId: string,
  expiresIn: ExpiresIn,
  jwtSecret: string,
): string {
  const expiresAt = expiresIn === "never" ? 0 : Date.now() + DURATIONS_MS[expiresIn];
  const key = deriveKey(jwtSecret);
  const signature = sign(fileId, expiresAt, key);
  return `${fileId}.${expiresAt}.${signature}`;
}

interface ShareTokenPayload {
  fileId: string;
  expiresAt: number;
}

export function verifyShareToken(token: string, jwtSecret: string): ShareTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const fileId = parts[0];
  const expiresAtStr = parts[1];
  const signature = parts[2];
  if (!fileId || !expiresAtStr || !signature) return null;

  const expiresAt = parseInt(expiresAtStr, 10);
  if (Number.isNaN(expiresAt)) return null;

  const key = deriveKey(jwtSecret);
  const expected = sign(fileId, expiresAt, key);

  if (signature.length !== expected.length) return null;

  const sigBuf = Buffer.from(signature, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length) return null;

  let match = 0;
  for (let i = 0; i < sigBuf.length; i++) {
    match |= (sigBuf[i] as number) ^ (expBuf[i] as number);
  }
  if (match !== 0) return null;

  if (expiresAt !== 0 && Date.now() > expiresAt) return null;

  return { fileId, expiresAt };
}

export function isValidExpiresIn(value: string): value is ExpiresIn {
  return value in DURATIONS_MS;
}
