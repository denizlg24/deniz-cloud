import { createHash, randomBytes } from "node:crypto";

const CODE_COUNT = 10;

function generateCode(): string {
  const bytes = randomBytes(4);
  const hex = bytes.toString("hex").toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

export function generateRecoveryCodes(count: number = CODE_COUNT): string[] {
  return Array.from({ length: count }, generateCode);
}

export function hashRecoveryCode(code: string): string {
  const normalized = code.replace(/-/g, "").toUpperCase();
  return createHash("sha256").update(normalized).digest("hex");
}

export function verifyRecoveryCode(code: string, hash: string): boolean {
  return hashRecoveryCode(code) === hash;
}
