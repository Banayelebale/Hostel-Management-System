import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { effectiveRole, legacyRole, ROLES } from "./roles.js";

const FORMAT_VERSION = 2;
const FILE_PATTERN = /^config-([a-f0-9-]{36})\.hmsb$/;

function encryptionKey(secret) {
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("BACKUP_ENCRYPTION_KEY must contain at least 32 bytes.");
  }
  return createHash("sha256").update(`haven-config-backup-v1:${secret}`).digest();
}

function encryptSnapshot(snapshot, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(snapshot), "utf8"),
    cipher.final()
  ]);
  return JSON.stringify({
    version: FORMAT_VERSION,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    data: encrypted.toString("base64url")
  });
}

function decryptSnapshot(contents, key) {
  const envelope = JSON.parse(contents);
  if (
    envelope.version !== FORMAT_VERSION ||
    typeof envelope.iv !== "string" ||
    typeof envelope.tag !== "string" ||
    typeof envelope.data !== "string"
  ) {
    throw new Error("Unsupported or malformed backup file.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64url")),
    decipher.final()
  ]).toString("utf8");
  return JSON.parse(plain);
}

function validateSnapshot(snapshot) {
  if (
    ![1, FORMAT_VERSION].includes(snapshot?.version) ||
    typeof snapshot.createdAt !== "string" ||
    !Number.isFinite(Date.parse(snapshot.createdAt)) ||
    !Array.isArray(snapshot.roles) ||
    !Array.isArray(snapshot.settings)
  ) {
    throw new Error("Backup content failed validation.");
  }
  for (const item of snapshot.roles) {
    if (
      !item ||
      typeof item.username !== "string" ||
      typeof item.email !== "string" ||
      !(ROLES.includes(item.role) ||
        (snapshot.version === 1 && ["admin", "portal", "student"].includes(item.role)))
    ) {
      throw new Error("Backup contains an invalid user role.");
    }
  }
  for (const item of snapshot.settings) {
    if (!item || typeof item.key !== "string" || typeof item.value !== "string") {
      throw new Error("Backup contains an invalid system setting.");
    }
  }
  if (
    new Set(snapshot.roles.map((item) => item.email.toLowerCase())).size !== snapshot.roles.length ||
    new Set(snapshot.settings.map((item) => item.key)).size !== snapshot.settings.length
  ) {
    throw new Error("Backup contains duplicate configuration entries.");
  }
}

export function createConfigBackupStore(db, secret, directory) {
  const key = encryptionKey(secret);
  fs.mkdirSync(directory, { recursive: true });
  const safeDirectory = path.resolve(directory);

  function isAdmin(actorId) {
    const actor = db.prepare(
      "SELECT role, role_code FROM users WHERE id = ? AND is_active = 1"
    ).get(actorId);
    return effectiveRole(actor) === "main_admin";
  }

  function list(actorId) {
    if (!isAdmin(actorId)) return { status: 403, body: { error: "Admin role required." } };
    const files = fs.readdirSync(safeDirectory)
      .filter((file) => FILE_PATTERN.test(file))
      .map((file) => {
        const filePath = path.join(safeDirectory, file);
        const stat = fs.lstatSync(filePath);
        if (!stat.isFile()) return null;
        return {
          id: file.slice("config-".length, -".hmsb".length),
          createdAt: stat.birthtime.toISOString(),
          sizeBytes: stat.size
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return { status: 200, body: { backups: files } };
  }

  function create(actorId) {
    if (!isAdmin(actorId)) return { status: 403, body: { error: "Admin role required." } };
    db.exec("BEGIN");
    let snapshot;
    try {
      snapshot = {
        version: FORMAT_VERSION,
        createdAt: new Date().toISOString(),
        roles: db.prepare(
          "SELECT username, email, role, role_code FROM users WHERE is_active = 1 ORDER BY id"
        ).all().map((user) => ({ username: user.username, email: user.email, role: effectiveRole(user) })),
        settings: db.prepare(
          "SELECT key, value FROM system_settings ORDER BY key"
        ).all()
      };
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const id = randomUUID();
    const fileName = `config-${id}.hmsb`;
    const filePath = path.resolve(safeDirectory, fileName);
    if (!filePath.startsWith(`${safeDirectory}${path.sep}`)) {
      throw new Error("Invalid backup path.");
    }
    fs.writeFileSync(filePath, encryptSnapshot(snapshot, key), { flag: "wx", mode: 0o600 });
    db.prepare(
      "INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details_json) VALUES (?, 'config.backup_created', 'backup', ?, ?)"
    ).run(actorId, id, JSON.stringify({
      userRoles: snapshot.roles.length,
      settings: snapshot.settings.length
    }));
    return {
      status: 201,
      body: {
        backup: { id, createdAt: snapshot.createdAt, userRoles: snapshot.roles.length, settings: snapshot.settings.length },
        message: "Encrypted configuration backup created. Hostel business data is not included."
      }
    };
  }

  function restore(actorId, id) {
    if (!isAdmin(actorId)) return { status: 403, body: { error: "Admin role required." } };
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) {
      return { status: 400, body: { error: "Invalid backup ID." } };
    }
    const filePath = path.resolve(safeDirectory, `config-${id}.hmsb`);
    if (!filePath.startsWith(`${safeDirectory}${path.sep}`) || !fs.existsSync(filePath)) {
      return { status: 404, body: { error: "Backup not found." } };
    }
    if (!fs.lstatSync(filePath).isFile()) {
      return { status: 404, body: { error: "Backup not found." } };
    }

    let snapshot;
    try {
      snapshot = decryptSnapshot(fs.readFileSync(filePath, "utf8"), key);
      validateSnapshot(snapshot);
      if (snapshot.version === 1) {
        snapshot.roles = snapshot.roles.map((item) => ({
          ...item,
          role: item.role === "admin" ? "main_admin" : item.role === "portal" ? "hall_master" : "student"
        }));
      }
    } catch (error) {
      if (error.code === "ENOENT") return { status: 404, body: { error: "Backup not found." } };
      return { status: 400, body: { error: "Backup could not be decrypted or failed validation." } };
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      if (!isAdmin(actorId)) {
        db.exec("ROLLBACK");
        return { status: 403, body: { error: "Admin role required." } };
      }
      const activeUsers = db.prepare("SELECT id, username, email, role, role_code FROM users WHERE is_active = 1")
        .all().map((user) => ({ ...user, role: effectiveRole(user) }));
      const activeByIdentity = new Map(activeUsers.map((user) => [user.email.toLowerCase(), user]));
      const snapshotByIdentity = new Map(snapshot.roles.map((item) => [item.email.toLowerCase(), item]));
      const roleChanges = [];
      for (const item of snapshot.roles) {
        const user = activeByIdentity.get(item.email.toLowerCase());
        if (!user) continue;
        if (user.username.toLowerCase() !== item.username.toLowerCase()) {
          throw new Error(`Cannot restore roles: active account ${item.username} has changed identity.`);
        }
        if (user.role !== item.role) roleChanges.push({ id: user.id, from: user.role, to: item.role });
      }
      const adminCount = activeUsers.reduce((count, user) => {
        const restoredRole = snapshotByIdentity.get(user.email.toLowerCase())?.role ?? user.role;
        return count + (restoredRole === "main_admin" ? 1 : 0);
      }, 0);
      if (adminCount < 1) throw new Error("Restore would remove all active administrators.");

      const updateRole = db.prepare("UPDATE users SET role = ?, role_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
      for (const change of roleChanges) updateRole.run(legacyRole(change.to), change.to, change.id);
      const settingKeys = new Set(snapshot.settings.map((setting) => setting.key));
      for (const current of db.prepare("SELECT key FROM system_settings").all()) {
        if (!settingKeys.has(current.key)) {
          db.prepare("DELETE FROM system_settings WHERE key = ?").run(current.key);
        }
      }
      const putSetting = db.prepare(
        `INSERT INTO system_settings (key, value, updated_at, updated_by)
         VALUES (?, ?, CURRENT_TIMESTAMP, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP, updated_by = excluded.updated_by`
      );
      for (const setting of snapshot.settings) putSetting.run(setting.key, setting.value, actorId);
      db.prepare(
        "INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details_json) VALUES (?, 'config.backup_restored', 'backup', ?, ?)"
      ).run(actorId, id, JSON.stringify({
        userRolesChanged: roleChanges.length,
        settingsRestored: snapshot.settings.length,
        businessDataRestored: false
      }));
      db.exec("COMMIT");
      return {
        status: 200,
        body: {
          message: "Roles and system settings restored. Hostel rooms and registrations were not changed.",
          userRolesChanged: roleChanges.length,
          settingsRestored: snapshot.settings.length,
          businessDataRestored: false
        }
      };
    } catch (error) {
      db.exec("ROLLBACK");
      if (error.message.startsWith("Cannot restore") || error.message === "Restore would remove all active administrators.") {
        return { status: 409, body: { error: error.message } };
      }
      throw error;
    }
  }

  return { create, list, restore };
}
