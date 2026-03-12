const ARGON2_OPTIONS = {
  algorithm: "argon2id" as const,
  memoryCost: 19456, // ~19MB — OWASP recommendation, safe for 4GB Pi
  timeCost: 2,
};

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}
