import {
  argon2,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual
} from "node:crypto";
import { effectiveRole, legacyRole, ROLES } from "./roles.js";

const ARGON2_OPTIONS = {
  parallelism: 1,
  tagLength: 32,
  memory: 19456,
  passes: 2
};
const OTP_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const COOKIE_NAME = "hms_session";

function hashPassword(password, salt, pepper) {
  return new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      {
        ...ARGON2_OPTIONS,
        message: Buffer.from(password, "utf8"),
        nonce: salt,
        secret: pepper
      },
      (error, tag) => (error ? reject(error) : resolve(tag.toString("base64url")))
    );
  });
}

export async function createPasswordCredentials(password, pepperString) {
  if (typeof password !== "string" || password.length < 8 || Buffer.byteLength(password) > 128) {
    throw new Error("Password must be at least 8 characters and no more than 128 UTF-8 bytes.");
  }
  if (!pepperString || Buffer.byteLength(pepperString) < 32) {
    throw new Error("AUTH_PEPPER must be configured with at least 32 bytes.");
  }
  const salt = randomBytes(16);
  return {
    password_hash: await hashPassword(password, salt, Buffer.from(pepperString, "utf8")),
    password_salt: salt.toString("base64url")
  };
}

export async function resetAdminPassword(db, email, password, pepperString) {
  const normalizedEmail = normalizeEmail(email);
  const credentials = await createPasswordCredentials(password, pepperString);
  db.exec("BEGIN IMMEDIATE");
  try {
    const admin = db.prepare(
      "SELECT id, email FROM users WHERE email = ? AND role = 'admin' AND is_active = 1"
    ).get(normalizedEmail);
    if (!admin) {
      db.exec("ROLLBACK");
      return null;
    }

    db.prepare(
      "UPDATE users SET password_hash = ?, password_salt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(credentials.password_hash, credentials.password_salt, admin.id);
    db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(admin.id);
    db.prepare(
      "UPDATE otp_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE user_id = ? AND consumed_at IS NULL"
    ).run(admin.id);
    db.prepare(
      "INSERT INTO audit_logs (actor_user_id, action, target_type, target_id) VALUES (?, 'admin.password_reset', 'user', ?)"
    ).run(admin.id, String(admin.id));
    db.exec("COMMIT");
    return { email: admin.email };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function readCookie(request, name) {
  const cookies = request.headers.cookie?.split(";") ?? [];
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0 || cookie.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function createAuth(db, pepperString, options = {}) {
  if (!pepperString || Buffer.byteLength(pepperString) < 32) {
    throw new Error("AUTH_PEPPER must be configured with at least 32 bytes.");
  }
  const pepper = Buffer.from(pepperString, "utf8");
  const otpEnabled = options.otpEnabled ?? false;
  const sendOtpEmail = options.sendOtpEmail;
  const attemptsByKey = new Map();

  function rateLimit(key, limit, windowMs) {
    const now = Date.now();
    const current = attemptsByKey.get(key);
    if (!current || current.resetAt <= now) {
      attemptsByKey.set(key, { count: 1, resetAt: now + windowMs });
      return false;
    }
    current.count += 1;
    return current.count > limit;
  }

  function cleanExpired() {
    const now = Date.now();
    db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(new Date(now).toISOString());
    for (const [key, entry] of attemptsByKey) {
      if (entry.resetAt <= now) attemptsByKey.delete(key);
    }
  }

  async function register({ username, email, password, role = "student" }, request) {
    const address = request?.socket?.remoteAddress ?? "unknown";
    if (rateLimit(`register:ip:${address}`, 8, 60 * 60 * 1000)) {
      return { status: 429, body: { error: "Too many account creation attempts. Try again later." } };
    }
    const normalizedUsername = typeof username === "string" ? username.trim() : "";
    const normalizedEmail = normalizeEmail(email ?? "");
    if (!["student", "hall_master", "hall_president"].includes(role)) {
      return {
        status: 400,
        body: { error: "Choose Student, Hall President, or Hall Master/Mistress. Main Admin accounts are created separately." }
      };
    }
    if (
      typeof normalizedUsername !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_. -]{1,30}[a-zA-Z0-9]$/.test(normalizedUsername) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
      typeof password !== "string" ||
      password.length < 8 ||
      Buffer.byteLength(password, "utf8") > 128
    ) {
      return {
        status: 400,
        body: {
          error: "Enter a username with 3-32 letters, numbers, spaces, periods, underscores, or hyphens, a valid email, and a password of at least 8 characters."
        }
      };
    }
    const salt = randomBytes(16);
    const passwordHash = await hashPassword(password, salt, pepper);
    try {
      const result = db.prepare(
        `INSERT INTO users (username, email, password_hash, password_salt, role, role_code, requested_role)
         VALUES (?, ?, ?, ?, 'student', 'student', ?)`
      ).run(
        normalizedUsername,
        normalizedEmail,
        passwordHash,
        salt.toString("base64url"),
        role === "student" ? null : role
      );
      db.prepare(
        "INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details_json) VALUES (?, ?, ?, ?, ?)"
      ).run(
        Number(result.lastInsertRowid),
        "account.registered",
        "user",
        String(result.lastInsertRowid),
        JSON.stringify({ requestedRole: role === "student" ? null : role })
      );
      return {
        status: 201,
        body: {
          message: role === "student"
            ? "Student account created. Sign in to verify your email."
            : "Student account created. Your selected role has been sent to a Main Admin for approval. Sign in to verify your email."
        }
      };
    } catch (error) {
      if (/UNIQUE constraint failed/.test(error.message)) {
        return { status: 409, body: { error: "That username or email is already registered." } };
      }
      throw error;
    }
  }

  async function login({ email, password }, request) {
    const address = request.socket.remoteAddress ?? "unknown";
    const normalizedEmail = normalizeEmail(email ?? "");
    if (
      rateLimit(`login:ip:${address}`, 20, 15 * 60 * 1000) ||
      rateLimit(`login:email:${normalizedEmail}`, 8, 15 * 60 * 1000)
    ) {
      return { status: 429, body: { error: "Too many sign-in attempts. Try again later." } };
    }
    const user = db.prepare(
      "SELECT id, email, password_hash, password_salt, is_active FROM users WHERE email = ?"
    ).get(normalizedEmail);
    const salt = user?.password_salt ? Buffer.from(user.password_salt, "base64url") : Buffer.alloc(16);
    const actual = await hashPassword(
      typeof password === "string" ? password : "",
      salt,
      pepper
    );
    if (!user || !user.is_active || !safeEqual(actual, user.password_hash)) {
      return { status: 401, body: { error: "Invalid email or password." } };
    }
    if (!otpEnabled && !sendOtpEmail) {
      return {
        status: 503,
        body: { error: "Email verification is not configured. Sign-in is unavailable." }
      };
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
    const codeHash = createHmac("sha256", pepper).update(`${user.id}:${code}`).digest("hex");
    db.prepare(
      "UPDATE otp_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE user_id = ? AND consumed_at IS NULL"
    ).run(user.id);
    const challengeId = db.prepare(
      "INSERT INTO otp_challenges (user_id, code_hash, expires_at) VALUES (?, ?, ?)"
    ).run(user.id, codeHash, expiresAt).lastInsertRowid;
    if (sendOtpEmail) {
      try {
        await sendOtpEmail({ to: user.email, code });
      } catch (error) {
        db.prepare(
          "UPDATE otp_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).run(challengeId);
        console.error("OTP email delivery failed:", error);
        return {
          status: 503,
          body: { error: "Could not send the verification email. Check the SMTP service and try again." }
        };
      }
      return {
        status: 200,
        body: { message: "Verification code sent to your email. It expires in five minutes." }
      };
    }
    console.info(`[DEMO OTP] ${user.email}: ${code} (expires in 5 minutes)`);
    return {
      status: 200,
      body: {
        message: "Verification code sent. Check the development server terminal.",
        demoCode: code
      }
    };
  }

  function verifyOtp({ email, code }) {
    const normalizedEmail = normalizeEmail(email ?? "");
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
      return { status: 400, body: { error: "Enter the six-digit verification code." } };
    }
    const user = db.prepare(
      "SELECT id, username, email, role, role_code FROM users WHERE email = ? AND is_active = 1"
    ).get(normalizedEmail);
    if (!user) return { status: 401, body: { error: "Invalid or expired verification code." } };
    user.role = effectiveRole(user);
    const challenge = db.prepare(
      `SELECT id, code_hash, expires_at, attempts FROM otp_challenges
       WHERE user_id = ? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1`
    ).get(user.id);
    if (!challenge || challenge.attempts >= MAX_OTP_ATTEMPTS || Date.parse(challenge.expires_at) <= Date.now()) {
      return { status: 401, body: { error: "Invalid or expired verification code." } };
    }
    const submittedHash = createHmac("sha256", pepper)
      .update(`${user.id}:${code}`)
      .digest("hex");
    if (!safeEqual(submittedHash, challenge.code_hash)) {
      db.prepare("UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?").run(challenge.id);
      return { status: 401, body: { error: "Invalid or expired verification code." } };
    }
    db.prepare(
      "UPDATE otp_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(challenge.id);
    cleanExpired();
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    db.prepare(
      "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)"
    ).run(tokenHash, user.id, expiresAt);
    db.prepare(
      "INSERT INTO audit_logs (actor_user_id, action, target_type, target_id) VALUES (?, ?, ?, ?)"
    ).run(user.id, "auth.login", "user", String(user.id));
    return {
      status: 200,
      body: { message: "Signed in.", user },
      cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
    };
  }

  function currentUser(request) {
    cleanExpired();
    const token = readCookie(request, COOKIE_NAME);
    if (!token) return null;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const user = db.prepare(
      `SELECT users.id, users.username, users.email, users.role, users.role_code
       FROM auth_sessions
       JOIN users ON users.id = auth_sessions.user_id
       WHERE auth_sessions.token_hash = ?
         AND auth_sessions.expires_at > ?
         AND users.is_active = 1`
    ).get(tokenHash, new Date().toISOString());
    if (user) user.role = effectiveRole(user);
    return user ?? null;
  }

  function listUsers(actorId) {
    const actor = db.prepare("SELECT role, role_code FROM users WHERE id = ? AND is_active = 1").get(actorId);
    if (effectiveRole(actor) !== "main_admin") return { status: 403, body: { error: "Main Admin role required." } };
    const users = db.prepare(
      "SELECT id, username, email, role, role_code, requested_role, created_at FROM users ORDER BY id"
    ).all().map((user) => ({ ...user, role: effectiveRole(user) }));
    return { status: 200, body: { users } };
  }

  function listArchivedUsers(actorId) {
    const actor = db.prepare("SELECT role, role_code FROM users WHERE id = ? AND is_active = 1").get(actorId);
    if (effectiveRole(actor) !== "main_admin") return { status: 403, body: { error: "Main Admin role required." } };
    const users = db.prepare(
      "SELECT id, original_user_id, username, email, role, role_code, archived_at FROM archived_users ORDER BY archived_at DESC, id DESC"
    ).all().map((user) => ({ ...user, role: effectiveRole(user) }));
    return { status: 200, body: { users } };
  }

  function archiveUser(actorId, targetId) {
    if (!Number.isSafeInteger(targetId) || targetId < 1) {
      return { status: 400, body: { error: "Invalid user ID." } };
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const actor = db.prepare("SELECT role, role_code FROM users WHERE id = ? AND is_active = 1").get(actorId);
      if (effectiveRole(actor) !== "main_admin") {
        db.exec("ROLLBACK");
        return { status: 403, body: { error: "Admin role required." } };
      }
      if (actorId === targetId) {
        db.exec("ROLLBACK");
        return { status: 409, body: { error: "You cannot archive your own active admin account." } };
      }
      const target = db.prepare(
        `SELECT id, username, email, password_hash, password_salt, role, role_code
         FROM users WHERE id = ? AND is_active = 1`
      ).get(targetId);
      if (!target) {
        db.exec("ROLLBACK");
        return { status: 404, body: { error: "Active user not found." } };
      }
      if (effectiveRole(target) === "main_admin") {
        db.exec("ROLLBACK");
        return { status: 409, body: { error: "Main Admin accounts are protected and cannot be archived." } };
      }
      const archived = db.prepare(
        `INSERT INTO archived_users
           (original_user_id, username, email, password_hash, password_salt, role, role_code, archived_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(target.id, target.username, target.email, target.password_hash, target.password_salt,
        legacyRole(effectiveRole(target)), effectiveRole(target), actorId);
      db.prepare(
        `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details_json)
         VALUES (?, 'user.archived', 'user', ?, ?)`
      ).run(actorId, String(target.id), JSON.stringify({ archiveId: Number(archived.lastInsertRowid) }));
      db.prepare("DELETE FROM users WHERE id = ?").run(target.id);
      db.exec("COMMIT");
      return { status: 200, body: { message: `${target.username} was archived.` } };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function deleteUser(actorId, targetId) {
    if (!Number.isSafeInteger(targetId) || targetId < 1) {
      return { status: 400, body: { error: "Invalid user ID." } };
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const actor = db.prepare("SELECT role, role_code FROM users WHERE id = ? AND is_active = 1").get(actorId);
      if (effectiveRole(actor) !== "main_admin") {
        db.exec("ROLLBACK");
        return { status: 403, body: { error: "Main Admin role required." } };
      }
      if (actorId === targetId) {
        db.exec("ROLLBACK");
        return { status: 409, body: { error: "You cannot permanently delete your own active account." } };
      }
      const target = db.prepare(
        "SELECT id, username, email, role, role_code FROM users WHERE id = ? AND is_active = 1"
      ).get(targetId);
      if (!target) {
        db.exec("ROLLBACK");
        return { status: 404, body: { error: "Active user not found." } };
      }
      if (effectiveRole(target) === "main_admin") {
        db.exec("ROLLBACK");
        return { status: 409, body: { error: "Main Admin accounts are protected and cannot be deleted." } };
      }
      db.prepare(
        `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details_json)
         VALUES (?, 'user.deleted', 'user', ?, ?)`
      ).run(actorId, String(target.id), JSON.stringify({
        username: target.username,
        email: target.email,
        role: effectiveRole(target),
        hostelRecordsPreserved: true
      }));
      db.prepare("DELETE FROM users WHERE id = ?").run(target.id);
      db.exec("COMMIT");
      return { status: 200, body: { message: `${target.username}'s account was permanently deleted. Hostel records were preserved.` } };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function restoreUser(actorId, archiveId) {
    if (!Number.isSafeInteger(archiveId) || archiveId < 1) {
      return { status: 400, body: { error: "Invalid archive ID." } };
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const actor = db.prepare("SELECT role, role_code FROM users WHERE id = ? AND is_active = 1").get(actorId);
      if (effectiveRole(actor) !== "main_admin") {
        db.exec("ROLLBACK");
        return { status: 403, body: { error: "Admin role required." } };
      }
      const archived = db.prepare(
        `SELECT id, original_user_id, username, email, password_hash, password_salt, role, role_code
         FROM archived_users WHERE id = ?`
      ).get(archiveId);
      if (!archived) {
        db.exec("ROLLBACK");
        return { status: 404, body: { error: "Archived user not found." } };
      }
      const conflict = db.prepare(
        "SELECT username, email FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE LIMIT 1"
      ).get(archived.username, archived.email);
      if (conflict) {
        db.exec("ROLLBACK");
        return {
          status: 409,
          body: { error: "Cannot restore: an active account now uses that username or email. Rename the active account first." }
        };
      }
      const restored = db.prepare(
        `INSERT INTO users (username, email, password_hash, password_salt, role, role_code)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(archived.username, archived.email, archived.password_hash, archived.password_salt,
        legacyRole(effectiveRole(archived)), effectiveRole(archived));
      db.prepare(
        `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details_json)
         VALUES (?, 'user.restored', 'user', ?, ?)`
      ).run(actorId, String(archived.original_user_id), JSON.stringify({ archiveId, restoredUserId: Number(restored.lastInsertRowid) }));
      db.prepare("DELETE FROM archived_users WHERE id = ?").run(archiveId);
      db.exec("COMMIT");
      return { status: 200, body: { message: `${archived.username} was restored.` } };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function setUserRole(actorId, targetId, role) {
    if (!ROLES.includes(role)) {
      return { status: 400, body: { error: "Choose Main Admin, Hall Master/Mistress, Hall President, or Student." } };
    }
    if (!Number.isSafeInteger(targetId) || targetId < 1) {
      return { status: 400, body: { error: "Invalid user ID." } };
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const actor = db.prepare("SELECT role, role_code FROM users WHERE id = ? AND is_active = 1").get(actorId);
      if (effectiveRole(actor) !== "main_admin") {
        db.exec("ROLLBACK");
        return { status: 403, body: { error: "Admin role required." } };
      }
      const target = db.prepare(
        "SELECT id, username, role, role_code, requested_role FROM users WHERE id = ? AND is_active = 1"
      ).get(targetId);
      if (!target) {
        db.exec("ROLLBACK");
        return { status: 404, body: { error: "Active user not found." } };
      }
      const currentRole = effectiveRole(target);
      if (currentRole === "main_admin") {
        db.exec("ROLLBACK");
        return { status: 409, body: { error: "Main Admin accounts are protected and their role cannot be changed." } };
      }
      if (currentRole !== role || target.requested_role) {
        db.prepare("UPDATE users SET role = ?, role_code = ?, requested_role = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .run(legacyRole(role), role, targetId);
        db.prepare(
          `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details_json)
           VALUES (?, 'user.role_changed', 'user', ?, ?)`
        ).run(actorId, String(targetId), JSON.stringify({
          from: currentRole,
          to: role,
          approvedRequest: target.requested_role === role,
          deniedRequest: target.requested_role && target.requested_role !== role ? target.requested_role : null
        }));
      }
      db.exec("COMMIT");
      return { status: 200, body: { user: { ...target, role, role_code: role, requested_role: null } } };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async function updateUser(actorId, targetId, input) {
    if (!Number.isSafeInteger(targetId) || targetId < 1) {
      return { status: 400, body: { error: "Invalid user ID." } };
    }
    const actor = db.prepare("SELECT role, role_code FROM users WHERE id = ? AND is_active = 1").get(actorId);
    if (effectiveRole(actor) !== "main_admin") return { status: 403, body: { error: "Main Admin role required." } };
    const target = db.prepare(
      "SELECT id, username, email, role, role_code FROM users WHERE id = ? AND is_active = 1"
    ).get(targetId);
    if (!target) return { status: 404, body: { error: "Active user not found." } };
    if (effectiveRole(target) === "main_admin") {
      return { status: 409, body: { error: "Main Admin accounts are protected and cannot be modified." } };
    }

    const username = input.username === undefined ? target.username : String(input.username).trim();
    const email = input.email === undefined ? target.email : normalizeEmail(input.email);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_. -]{1,30}[a-zA-Z0-9]$/.test(username) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { status: 400, body: { error: "Enter a valid name and email address." } };
    }
    let credentials = null;
    if (input.password !== undefined && input.password !== "") {
      try {
        credentials = await createPasswordCredentials(input.password, pepperString);
      } catch (error) {
        return { status: 400, body: { error: error.message } };
      }
    }
    try {
      db.prepare(
        `UPDATE users SET username = ?, email = ?,
         password_hash = COALESCE(?, password_hash),
         password_salt = COALESCE(?, password_salt),
         updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(username, email, credentials?.password_hash ?? null, credentials?.password_salt ?? null, targetId);
      if (credentials) {
        db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(targetId);
        db.prepare(
          "UPDATE otp_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE user_id = ? AND consumed_at IS NULL"
        ).run(targetId);
      }
      db.prepare(
        `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details_json)
         VALUES (?, 'user.profile_updated', 'user', ?, ?)`
      ).run(actorId, String(targetId), JSON.stringify({
        usernameChanged: username !== target.username,
        emailChanged: email !== target.email,
        passwordChanged: Boolean(credentials)
      }));
      const updated = db.prepare(
        "SELECT id, username, email, role, role_code FROM users WHERE id = ?"
      ).get(targetId);
      updated.role = effectiveRole(updated);
      return { status: 200, body: { user: updated, message: `${username}'s account was updated.` } };
    } catch (error) {
      if (/UNIQUE constraint failed/.test(error.message)) {
        return { status: 409, body: { error: "That username or email is already in use." } };
      }
      throw error;
    }
  }

  function securityInfo(actorId) {
    const actor = db.prepare("SELECT role, role_code FROM users WHERE id = ? AND is_active = 1").get(actorId);
    if (effectiveRole(actor) !== "main_admin") return { status: 403, body: { error: "Main Admin role required." } };
    return {
      status: 200,
      body: {
        algorithm: "Argon2id",
        salt: "Unique random 16-byte salt per account, stored with the account record.",
        pepperConfigured: Buffer.byteLength(pepperString) >= 32,
        pepper: "Secret value is stored in the local environment and is never displayed.",
        paymentData: "No payment card details are stored by this demo."
      }
    };
  }

  function logout(request) {
    const token = readCookie(request, COOKIE_NAME);
    if (token) {
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const session = db.prepare(
        "SELECT user_id FROM auth_sessions WHERE token_hash = ?"
      ).get(tokenHash);
      if (session) {
        db.prepare(
          "INSERT INTO audit_logs (actor_user_id, action, target_type, target_id) VALUES (?, ?, ?, ?)"
        ).run(session.user_id, "auth.logout", "user", String(session.user_id));
      }
      db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(tokenHash);
    }
    return {
      status: 200,
      body: { message: "Signed out." },
      cookie: `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
    };
  }

  return {
    register,
    login,
    verifyOtp,
    currentUser,
    listUsers,
    listArchivedUsers,
    setUserRole,
    updateUser,
    securityInfo,
    archiveUser,
    deleteUser,
    restoreUser,
    logout
  };
}
