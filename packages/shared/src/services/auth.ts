import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { signSessionToken, verifySessionToken } from "../auth/jwt";
import { hashPassword, verifyPassword } from "../auth/password";
import { generateRecoveryCodes, hashRecoveryCode } from "../auth/recovery";
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  verifyTotpToken,
} from "../auth/totp";
import type { Database } from "../db";
import {
  apiKeys,
  recoveryCodes,
  sessions,
  totpSecrets,
  type User,
  type UserRole,
  users,
} from "../db/schema";
import type { SafeUser } from "../types";

type AuthErrorStatus = 400 | 401 | 403 | 404;

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: AuthErrorStatus = 401,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

function toSafeUser(user: User): SafeUser {
  const { passwordHash: _, ...safe } = user;
  return safe;
}

function parseDurationMs(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match || !match[1] || !match[2]) {
    throw new Error(`Invalid duration format: ${duration}`);
  }
  const value = parseInt(match[1], 10);
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  const multiplier = multipliers[match[2]];
  if (!multiplier) throw new Error(`Invalid duration unit: ${match[2]}`);
  return value * multiplier;
}

export async function registerUser(
  db: Database,
  input: {
    username: string;
    password: string;
    email?: string;
    role?: UserRole;
  },
): Promise<SafeUser> {
  const passwordHash = await hashPassword(input.password);

  const [user] = await db
    .insert(users)
    .values({
      username: input.username,
      passwordHash,
      email: input.email,
      role: input.role ?? "user",
      status: "active",
    })
    .returning();

  if (!user) throw new Error("Failed to create user");
  return toSafeUser(user);
}

export async function createPendingUser(
  db: Database,
  input: { username: string; role?: UserRole },
): Promise<SafeUser> {
  const [user] = await db
    .insert(users)
    .values({
      username: input.username,
      role: input.role ?? "user",
      status: "pending",
    })
    .returning();

  if (!user) throw new Error("Failed to create user");
  return toSafeUser(user);
}

export async function completeSignup(
  db: Database,
  input: { username: string; email: string; password: string },
): Promise<SafeUser> {
  const user = await db.query.users.findFirst({
    where: eq(users.username, input.username),
  });

  if (!user) throw new AuthError("User not found", "USER_NOT_FOUND", 404);
  if (user.status !== "pending") {
    throw new AuthError("Account already activated", "ALREADY_ACTIVE", 400);
  }

  const passwordHash = await hashPassword(input.password);

  const [updated] = await db
    .update(users)
    .set({
      email: input.email,
      passwordHash,
      status: "active",
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id))
    .returning();

  if (!updated) throw new Error("Failed to complete signup");
  return toSafeUser(updated);
}

export async function listUsers(
  db: Database,
  opts: { page?: number; limit?: number } = {},
): Promise<{ users: SafeUser[]; total: number }> {
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 50;
  const offset = (page - 1) * limit;

  const [allUsers, countResult] = await Promise.all([
    db.select().from(users).orderBy(users.createdAt).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(users),
  ]);

  return {
    users: allUsers.map(toSafeUser),
    total: countResult[0]?.count ?? 0,
  };
}

export async function deleteUser(db: Database, userId: string): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new AuthError("User not found", "USER_NOT_FOUND", 404);
  if (user.role === "superuser") {
    throw new AuthError("Cannot delete superuser accounts", "FORBIDDEN", 403);
  }

  await db.delete(users).where(eq(users.id, userId));
}

export async function resetUserMfa(db: Database, userId: string): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new AuthError("User not found", "USER_NOT_FOUND", 404);

  await db.delete(totpSecrets).where(eq(totpSecrets.userId, userId));
  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  await db
    .update(users)
    .set({ totpEnabled: false, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function loginWithPassword(
  db: Database,
  input: { username: string; password: string },
): Promise<{
  user: SafeUser;
  requiresTotp: boolean;
  requiresRecoveryCode: boolean;
}> {
  const user = await db.query.users.findFirst({
    where: eq(users.username, input.username),
  });
  if (!user) {
    throw new AuthError("Invalid credentials", "INVALID_CREDENTIALS");
  }

  if (user.status === "pending") {
    throw new AuthError("Account setup not completed", "ACCOUNT_PENDING", 403);
  }

  if (!user.passwordHash) {
    throw new AuthError("Account setup not completed", "ACCOUNT_PENDING", 403);
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    throw new AuthError("Invalid credentials", "INVALID_CREDENTIALS");
  }

  return {
    user: toSafeUser(user),
    requiresTotp: user.totpEnabled,
    requiresRecoveryCode: user.role === "superuser",
  };
}

export async function setupTotp(
  db: Database,
  userId: string,
  encryptionKey: string,
): Promise<{ uri: string }> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) throw new AuthError("User not found", "USER_NOT_FOUND", 404);

  const { secret, uri } = generateTotpSecret(user.username);
  const { encrypted, iv, authTag } = encryptTotpSecret(secret, encryptionKey);

  await db
    .insert(totpSecrets)
    .values({
      userId,
      encryptedSecret: encrypted,
      iv,
      authTag,
      verified: false,
    })
    .onConflictDoUpdate({
      target: totpSecrets.userId,
      set: { encryptedSecret: encrypted, iv, authTag, verified: false },
    });

  return { uri };
}

export async function verifyAndEnableTotp(
  db: Database,
  userId: string,
  token: string,
  encryptionKey: string,
): Promise<void> {
  const record = await db.query.totpSecrets.findFirst({
    where: eq(totpSecrets.userId, userId),
  });
  if (!record) {
    throw new AuthError("TOTP not configured", "TOTP_NOT_CONFIGURED", 400);
  }

  const secret = decryptTotpSecret(
    record.encryptedSecret,
    record.iv,
    record.authTag,
    encryptionKey,
  );
  if (!verifyTotpToken(secret, token)) {
    throw new AuthError("Invalid TOTP token", "INVALID_TOTP");
  }

  await db.update(totpSecrets).set({ verified: true }).where(eq(totpSecrets.userId, userId));
  await db
    .update(users)
    .set({ totpEnabled: true, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function verifyTotp(
  db: Database,
  userId: string,
  token: string,
  encryptionKey: string,
): Promise<void> {
  const record = await db.query.totpSecrets.findFirst({
    where: and(eq(totpSecrets.userId, userId), eq(totpSecrets.verified, true)),
  });
  if (!record) {
    throw new AuthError("TOTP not configured", "TOTP_NOT_CONFIGURED", 400);
  }

  const secret = decryptTotpSecret(
    record.encryptedSecret,
    record.iv,
    record.authTag,
    encryptionKey,
  );
  if (!verifyTotpToken(secret, token)) {
    throw new AuthError("Invalid TOTP token", "INVALID_TOTP");
  }
}

export async function generateAndStoreRecoveryCodes(
  db: Database,
  userId: string,
): Promise<string[]> {
  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));

  const codes = generateRecoveryCodes();
  await db.insert(recoveryCodes).values(
    codes.map((code) => ({
      userId,
      codeHash: hashRecoveryCode(code),
    })),
  );

  return codes;
}

export async function useRecoveryCode(db: Database, userId: string, code: string): Promise<void> {
  const hash = hashRecoveryCode(code);

  const [record] = await db
    .select()
    .from(recoveryCodes)
    .where(
      and(
        eq(recoveryCodes.userId, userId),
        eq(recoveryCodes.codeHash, hash),
        eq(recoveryCodes.used, false),
      ),
    );

  if (!record) {
    throw new AuthError("Invalid recovery code", "INVALID_RECOVERY_CODE");
  }

  await db
    .update(recoveryCodes)
    .set({ used: true, usedAt: new Date() })
    .where(eq(recoveryCodes.id, record.id));
}

export async function createSession(
  db: Database,
  userId: string,
  role: UserRole,
  jwtSecret: string,
  expiresIn: string = "24h",
): Promise<{ token: string; expiresAt: Date }> {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + parseDurationMs(expiresIn));

  const token = await signSessionToken({ sub: userId, role, sid: sessionId }, jwtSecret, expiresIn);

  const tokenHash = createHash("sha256").update(token).digest("hex");

  await db.insert(sessions).values({
    id: sessionId,
    userId,
    tokenHash,
    expiresAt,
  });

  return { token, expiresAt };
}

export async function validateSession(
  db: Database,
  token: string,
  jwtSecret: string,
): Promise<{ user: SafeUser; sessionId: string }> {
  let payload: import("../auth/jwt").SessionTokenPayload;
  try {
    payload = await verifySessionToken(token, jwtSecret);
  } catch {
    throw new AuthError("Invalid or expired token", "TOKEN_INVALID");
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");

  const session = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.id, payload.sid),
      eq(sessions.tokenHash, tokenHash),
      gt(sessions.expiresAt, new Date()),
    ),
    with: { user: true },
  });

  if (!session) {
    throw new AuthError("Session expired or revoked", "SESSION_INVALID");
  }

  return { user: toSafeUser(session.user), sessionId: session.id };
}

export async function revokeSession(db: Database, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function createApiKey(
  db: Database,
  userId: string,
  name: string,
): Promise<{ id: string; key: string; prefix: string }> {
  const keyBytes = randomBytes(32);
  const key = keyBytes.toString("base64url");
  const prefix = key.slice(0, 8);
  const keyHash = createHash("sha256").update(key).digest("hex");

  const [record] = await db
    .insert(apiKeys)
    .values({ userId, name, keyHash, keyPrefix: prefix })
    .returning();

  if (!record) throw new Error("Failed to create API key");
  return { id: record.id, key, prefix };
}

export async function validateApiKey(db: Database, key: string): Promise<SafeUser> {
  const keyHash = createHash("sha256").update(key).digest("hex");

  const record = await db.query.apiKeys.findFirst({
    where: eq(apiKeys.keyHash, keyHash),
    with: { user: true },
  });

  if (!record) throw new AuthError("Invalid API key", "INVALID_API_KEY");
  if (record.expiresAt && record.expiresAt < new Date()) {
    throw new AuthError("API key expired", "API_KEY_EXPIRED");
  }

  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, record.id));

  return toSafeUser(record.user);
}

export async function revokeApiKey(db: Database, keyId: string, userId: string): Promise<void> {
  const [deleted] = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
    .returning({ id: apiKeys.id });

  if (!deleted) {
    throw new AuthError("API key not found", "API_KEY_NOT_FOUND", 404);
  }
}
