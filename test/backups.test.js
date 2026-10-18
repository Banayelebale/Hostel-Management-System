import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createConfigBackupStore } from "../src/backups.js";

function createFixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../src/schema.sql", import.meta.url), "utf8"));
  db.prepare(
    `INSERT INTO users (username, email, password_hash, password_salt, role)
     VALUES ('admin_user', 'admin@example.test', 'hash', 'salt', 'admin')`
  ).run();
  db.prepare(
    `INSERT INTO users (username, email, password_hash, password_salt, role)
     VALUES ('portal_user', 'portal@example.test', 'hash', 'salt', 'portal')`
  ).run();
  db.prepare(
    "INSERT INTO rooms (room_number, capacity, monthly_rate_cents) VALUES ('A-101', 2, 10000)"
  ).run();
  db.prepare(
    `INSERT INTO hostel_registrations (student_name, student_email, room_id, status)
     VALUES ('Resident One', 'resident@example.test', 1, 'checked_in')`
  ).run();
  db.prepare("INSERT INTO system_settings (key, value) VALUES ('checkin_time', '14:00')").run();
  const directory = mkdtempSync(path.join(os.tmpdir(), "hms-backups-"));
  const backups = createConfigBackupStore(
    db,
    "test-backup-encryption-key-with-at-least-32-bytes",
    directory
  );
  return {
    db,
    backups,
    directory,
    close() {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

test("encrypted backup restores roles and settings without changing hostel records", () => {
  const fixture = createFixture();
  try {
    assert.equal(fixture.backups.list(2).status, 403);
    assert.equal(fixture.backups.create(2).status, 403);
    fixture.db.prepare("INSERT INTO system_settings (key, value) VALUES ('quiet_hours', '22:00')").run();
    const created = fixture.backups.create(1);
    assert.equal(created.status, 201);
    assert.equal(created.body.backup.userRoles, 2);
    assert.equal(created.body.backup.settings, 2);

    const backupFile = path.join(fixture.directory, `config-${created.body.backup.id}.hmsb`);
    const encryptedFile = readFileSync(backupFile, "utf8");
    assert.equal(encryptedFile.includes("admin@example.test"), false);
    assert.equal(encryptedFile.includes("14:00"), false);

    fixture.db.prepare("UPDATE users SET role = 'student' WHERE email = 'portal@example.test'").run();
    fixture.db.prepare("UPDATE system_settings SET value = '09:00' WHERE key = 'checkin_time'").run();
    fixture.db.prepare("DELETE FROM system_settings WHERE key = 'quiet_hours'").run();
    fixture.db.prepare("INSERT INTO system_settings (key, value) VALUES ('new_setting', 'ignored')").run();
    fixture.db.prepare("UPDATE hostel_registrations SET status = 'checked_out'").run();
    fixture.db.prepare(
      `INSERT INTO hostel_registrations (student_name, student_email, room_id, status)
       VALUES ('Resident Two', 'resident2@example.test', 1, 'pending')`
    ).run();

    const restored = fixture.backups.restore(1, created.body.backup.id);
    assert.equal(restored.status, 200);
    assert.equal(restored.body.businessDataRestored, false);
    assert.equal(
      fixture.db.prepare("SELECT role FROM users WHERE email = 'portal@example.test'").get().role,
      "portal"
    );
    assert.deepEqual(
      fixture.db.prepare("SELECT key, value FROM system_settings ORDER BY key").all().map((setting) => ({ ...setting })),
      [{ key: "checkin_time", value: "14:00" }, { key: "quiet_hours", value: "22:00" }]
    );
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM hostel_registrations").get().count, 2);
    assert.equal(
      fixture.db.prepare("SELECT status FROM hostel_registrations WHERE student_email = 'resident@example.test'").get().status,
      "checked_out"
    );
  } finally {
    fixture.close();
  }
});

test("restore refuses snapshots that would remove the last admin", () => {
  const fixture = createFixture();
  try {
    const created = fixture.backups.create(1);
    fixture.db.prepare("UPDATE users SET role = 'admin' WHERE email = 'portal@example.test'").run();
    fixture.db.prepare(
      `INSERT INTO archived_users
         (original_user_id, username, email, password_hash, password_salt, role, archived_by)
       SELECT id, username, email, password_hash, password_salt, role, id FROM users
       WHERE email = 'admin@example.test'`
    ).run();
    fixture.db.prepare("DELETE FROM users WHERE email = 'admin@example.test'").run();
    const result = fixture.backups.restore(2, created.body.backup.id);
    assert.equal(result.status, 409);
    assert.equal(fixture.db.prepare("SELECT role FROM users WHERE email = 'portal@example.test'").get().role, "admin");
  } finally {
    fixture.close();
  }
});

test("rejects corrupted or unknown backup files without modifying configuration", () => {
  const fixture = createFixture();
  try {
    const created = fixture.backups.create(1);
    const backupFile = path.join(fixture.directory, `config-${created.body.backup.id}.hmsb`);
    writeFileSync(backupFile, "tampered");
    assert.equal(fixture.backups.restore(1, created.body.backup.id).status, 400);
    assert.equal(fixture.backups.restore(1, "00000000-0000-0000-0000-000000000000").status, 404);
    assert.equal(fixture.db.prepare("SELECT role FROM users WHERE email = 'admin@example.test'").get().role, "admin");
  } finally {
    fixture.close();
  }
});
