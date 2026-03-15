import { createDb } from "@deniz-cloud/shared/db";
import { users } from "@deniz-cloud/shared/db/schema";
import { requiredEnv } from "@deniz-cloud/shared/env";
import {
  createSession,
  generateAndStoreRecoveryCodes,
  registerUser,
  setupTotp,
  verifyAndEnableTotp,
} from "@deniz-cloud/shared/services";
import { eq } from "drizzle-orm";

const databaseUrl = requiredEnv("DATABASE_URL");
const jwtSecret = requiredEnv("JWT_SECRET");
const totpEncryptionKey = requiredEnv("TOTP_ENCRYPTION_KEY");

const db = createDb(databaseUrl);

const existing = await db.query.users.findFirst({
  where: eq(users.role, "superuser"),
});

if (existing) {
  console.log(`Superuser "${existing.username}" already exists.`);

  const reuseSession = prompt("Generate a new session token for this user? (y/n): ");
  if (reuseSession?.trim().toLowerCase() === "y") {
    const { token, expiresAt } = await createSession(
      db,
      existing.id,
      existing.role,
      jwtSecret,
      "7d",
    );
    console.log("\n--- Session Token (valid 7 days) ---");
    console.log(token);
    console.log(`Expires: ${expiresAt.toISOString()}`);
  }

  process.exit(0);
}

console.log("\n=== Deniz Cloud — Superuser Setup ===\n");

const username = prompt("Username: ");
if (!username?.trim()) {
  console.error("Username is required.");
  process.exit(1);
}

const password = prompt("Password: ");
if (!password || password.length < 12) {
  console.error("Password must be at least 12 characters.");
  process.exit(1);
}

const confirmPassword = prompt("Confirm password: ");
if (password !== confirmPassword) {
  console.error("Passwords do not match.");
  process.exit(1);
}

const email = prompt("Email (optional, press Enter to skip): ");

const user = await registerUser(db, {
  username: username.trim(),
  password,
  email: email?.trim() || undefined,
  role: "superuser",
});

console.log(`\nUser "${user.username}" created as superuser.`);

console.log("\n--- TOTP Setup ---");
const { uri } = await setupTotp(db, user.id, totpEncryptionKey);
console.log("\nScan this URI with your authenticator app:");
console.log(uri);

let totpVerified = false;
for (let attempt = 0; attempt < 3; attempt++) {
  const totpToken = prompt("\nEnter TOTP code from your app: ");
  if (!totpToken?.trim()) continue;

  try {
    await verifyAndEnableTotp(db, user.id, totpToken.trim(), totpEncryptionKey);
    totpVerified = true;
    console.log("TOTP verified and enabled.");
    break;
  } catch {
    console.log(`Invalid code. ${2 - attempt} attempts remaining.`);
  }
}

if (!totpVerified) {
  console.error("TOTP setup failed. User created but TOTP not enabled.");
  process.exit(1);
}

console.log("\n--- Recovery Codes ---");
const codes = await generateAndStoreRecoveryCodes(db, user.id);
console.log("\nSave these recovery codes in a secure location.");
console.log("Each code can only be used once.\n");
for (const code of codes) {
  console.log(`  ${code}`);
}

const { token, expiresAt } = await createSession(db, user.id, user.role, jwtSecret, "7d");
console.log("\n--- Session Token (valid 7 days) ---");
console.log(token);
console.log(`Expires: ${expiresAt.toISOString()}`);

console.log("\n=== Setup complete ===\n");
process.exit(0);
