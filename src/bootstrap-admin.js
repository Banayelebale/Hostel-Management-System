import { createPasswordCredentials } from "./auth.js";

const INITIAL_ADMIN_FIELDS = [
  "INITIAL_ADMIN_USERNAME",
  "INITIAL_ADMIN_EMAIL",
  "INITIAL_ADMIN_PASSWORD"
];

export async function bootstrapInitialAdmin(db, env = process.env) {
  const values = INITIAL_ADMIN_FIELDS.map((field) => env[field] ?? "");
  if (values.every((value) => !value)) return false;
  if (values.some((value) => !value)) {
    throw new Error("Set all INITIAL_ADMIN_USERNAME, INITIAL_ADMIN_EMAIL, and INITIAL_ADMIN_PASSWORD values.");
  }

  const [rawUsername, rawEmail, password] = values;
  const username = rawUsername.trim();
  const email = rawEmail.trim();
  const normalizedEmail = email.toLowerCase();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_. -]{1,30}[a-zA-Z0-9]$/.test(username)) {
    throw new Error("INITIAL_ADMIN_USERNAME must contain 3-32 supported characters.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error("INITIAL_ADMIN_EMAIL must be a valid email address.");
  }

  const credentials = await createPasswordCredentials(password, env.AUTH_PEPPER);
  db.exec("BEGIN IMMEDIATE");
  try {
    const existingAdmin = db.prepare(
      "SELECT id FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1"
    ).get();
    if (existingAdmin) {
      db.exec("COMMIT");
      return false;
    }

    const identityConflict = db.prepare(
      "SELECT id FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE LIMIT 1"
    ).get(username, normalizedEmail);
    if (identityConflict) {
      throw new Error("Initial admin username or email is already used by another account.");
    }

    const result = db.prepare(
      `INSERT INTO users (username, email, password_hash, password_salt, role, role_code)
       VALUES (?, ?, ?, ?, 'admin', 'main_admin')`
    ).run(username, normalizedEmail, credentials.password_hash, credentials.password_salt);
    db.prepare(
      "INSERT INTO audit_logs (actor_user_id, action, target_type, target_id) VALUES (?, 'admin.bootstrap', 'user', ?)"
    ).run(Number(result.lastInsertRowid), String(result.lastInsertRowid));
    db.exec("COMMIT");
    console.info("Initial Main Admin account created from deployment configuration.");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
