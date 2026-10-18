import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createAuth, resetAdminPassword } from "../src/auth.js";

function createFixture(options = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../src/schema.sql", import.meta.url), "utf8"));
  const auth = createAuth(db, "test-only-pepper-with-at-least-32-bytes", {
    otpEnabled: true,
    ...options
  });
  return {
    db,
    auth,
    request: { socket: { remoteAddress: "127.0.0.1" }, headers: {} },
    close: () => db.close()
  };
}

test("registration stores salted Argon2id hashes and rejects duplicate identities", async () => {
  const fixture = createFixture();
  try {
    const input = { username: "demo_user", email: "student@example.test", password: "correct horse battery staple" };
    assert.equal((await fixture.auth.register(input)).status, 201);
    const saved = fixture.db.prepare(
      "SELECT password_hash, password_salt, role FROM users WHERE email = ?"
    ).get(input.email);
    assert.equal(saved.role, "student");
    assert.notEqual(saved.password_salt, "");
    assert.match(saved.password_hash, /^[A-Za-z0-9_-]{43}$/);
    assert.equal((await fixture.auth.register({ ...input, username: "another_user" })).status, 409);
    assert.equal((await fixture.auth.register({ ...input, email: "STUDENT@example.test" })).status, 409);
    assert.equal((await fixture.auth.register({ ...input, email: "eight@example.test", username: "eightuser", password: "12345678" })).status, 201);
    assert.equal((await fixture.auth.register({ ...input, email: "seven@example.test", username: "sevenusr", password: "1234567" })).status, 400);
    assert.equal((await fixture.auth.register({
      ...input,
      username: "Charity Werekuu",
      email: "charity@example.test",
      password: "simplepass"
    })).status, 201);
    assert.equal((await fixture.auth.register({
      ...input,
      username: "  Jane Doe  ",
      email: "jane@example.test",
      password: "simplepass"
    })).status, 201);
    assert.equal(
      fixture.db.prepare("SELECT username FROM users WHERE email = ?").get("jane@example.test").username,
      "Jane Doe"
    );
  } finally {
    fixture.close();
  }
});

test("account creation records role requests for Main Admin review without granting access", async () => {
  const fixture = createFixture();
  try {
    fixture.db.prepare(
      `INSERT INTO users (username, email, password_hash, password_salt, role)
       VALUES ('admin_user', 'admin@example.test', 'hash', 'salt', 'admin')`
    ).run();
    const result = await fixture.auth.register({
      username: "new_hall_master",
      email: "request@example.test",
      password: "correct-password",
      role: "hall_master"
    });
    assert.equal(result.status, 201);
    assert.match(result.body.message, /approval/);
    const saved = fixture.db.prepare(
      "SELECT role, role_code, requested_role FROM users WHERE email = ?"
    ).get("request@example.test");
    assert.deepEqual({ ...saved }, {
      role: "student",
      role_code: "student",
      requested_role: "hall_master"
    });
    assert.equal((await fixture.auth.register({
      username: "invalid_role",
      email: "invalid-role@example.test",
      password: "correct-password",
      role: "superuser"
    })).status, 400);
    assert.equal((await fixture.auth.register({
      username: "public_admin",
      email: "public-admin@example.test",
      password: "correct-password",
      role: "main_admin"
    })).status, 400);
    assert.equal(fixture.auth.listUsers(1).body.users[1].requested_role, "hall_master");
    assert.equal(fixture.auth.setUserRole(1, 2, "hall_master").status, 200);
    const approved = fixture.db.prepare(
      "SELECT role_code, requested_role FROM users WHERE id = 2"
    ).get();
    assert.deepEqual({ ...approved }, { role_code: "hall_master", requested_role: null });
  } finally {
    fixture.close();
  }
});

test("password login requires a valid one-time OTP and issues an HttpOnly session", async () => {
  const fixture = createFixture();
  try {
    await fixture.auth.register({
      username: "demo_user",
      email: "student@example.test",
      password: "correct horse battery staple"
    });
    assert.equal((await fixture.auth.login(
      { email: "student@example.test", password: "wrong password" },
      fixture.request
    )).status, 401);
    const challenge = await fixture.auth.login(
      { email: "STUDENT@example.test", password: "correct horse battery staple" },
      fixture.request
    );
    assert.equal(challenge.status, 200);
    assert.match(challenge.body.demoCode, /^\d{6}$/);
    assert.equal(fixture.auth.verifyOtp({ email: "student@example.test", code: "000000" }).status, 401);
    const verified = fixture.auth.verifyOtp({
      email: "student@example.test",
      code: challenge.body.demoCode
    });
    assert.equal(verified.status, 200);
    assert.match(verified.cookie, /HttpOnly; SameSite=Strict/);
    const token = verified.cookie.split(";")[0];
    const request = {
      headers: { cookie: token },
      socket: { remoteAddress: "127.0.0.1" }
    };
    assert.equal(fixture.auth.currentUser(request).role, "student");
    fixture.db.prepare("UPDATE users SET role = 'portal', role_code = 'hall_master' WHERE email = ?").run("student@example.test");
    assert.equal(fixture.auth.currentUser(request).role, "hall_master");
    assert.equal(
      fixture.auth.verifyOtp({ email: "student@example.test", code: challenge.body.demoCode }).status,
      401
    );
    const restartedAuth = createAuth(
      fixture.db,
      "test-only-pepper-with-at-least-32-bytes",
      { otpEnabled: true }
    );
    assert.equal(restartedAuth.currentUser(request).role, "hall_master");
    restartedAuth.logout(request);
    assert.equal(restartedAuth.currentUser(request), null);
  } finally {
    fixture.close();
  }
});

test("email OTP is delivered without exposing the code in the login response", async () => {
  const delivered = [];
  const fixture = createFixture({
    sendOtpEmail: async (email) => delivered.push(email)
  });
  try {
    await fixture.auth.register({
      username: "mailpit_user",
      email: "mailpit@example.test",
      password: "correct horse battery staple"
    });
    const result = await fixture.auth.login(
      { email: "mailpit@example.test", password: "correct horse battery staple" },
      fixture.request
    );
    assert.equal(result.status, 200);
    assert.equal("demoCode" in result.body, false);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].to, "mailpit@example.test");
    assert.match(delivered[0].code, /^\d{6}$/);
    assert.equal(fixture.auth.verifyOtp({
      email: "mailpit@example.test",
      code: delivered[0].code
    }).status, 200);
  } finally {
    fixture.close();
  }
});

test("refuses to initialize without a sufficiently long pepper", () => {
  const db = new DatabaseSync(":memory:");
  try {
    assert.throws(() => createAuth(db, "too-short"), /AUTH_PEPPER/);
  } finally {
    db.close();
  }
});

test("admin password credential creation accepts eight characters and rejects seven", async () => {
  const { createPasswordCredentials } = await import("../src/auth.js");
  const pepper = "test-only-pepper-with-at-least-32-bytes";
  const credentials = await createPasswordCredentials("12345678", pepper);
  assert.ok(credentials.password_hash);
  assert.ok(credentials.password_salt);
  await assert.rejects(createPasswordCredentials("1234567", pepper), /at least 8 characters/);
});

test("admin password reset uses a new salted hash and revokes sessions and OTPs", async () => {
  const fixture = createFixture();
  try {
    const credentials = await import("../src/auth.js").then(({ createPasswordCredentials }) =>
      createPasswordCredentials("oldpassword", "test-only-pepper-with-at-least-32-bytes")
    );
    fixture.db.prepare(
      `INSERT INTO users (username, email, password_hash, password_salt, role)
       VALUES ('admin_user', 'admin@example.test', ?, ?, 'admin')`
    ).run(credentials.password_hash, credentials.password_salt);
    fixture.db.prepare(
      "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ('session-hash', 1, ?)"
    ).run(new Date(Date.now() + 60_000).toISOString());
    fixture.db.prepare(
      `INSERT INTO otp_challenges (user_id, code_hash, expires_at)
       VALUES (1, 'challenge-hash', ?)`
    ).run(new Date(Date.now() + 60_000).toISOString());

    const result = await resetAdminPassword(
      fixture.db,
      "ADMIN@example.test",
      "newpassword",
      "test-only-pepper-with-at-least-32-bytes"
    );
    assert.deepEqual(result, { email: "admin@example.test" });
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM auth_sessions").get().count, 0);
    assert.ok(fixture.db.prepare(
      "SELECT consumed_at FROM otp_challenges WHERE user_id = 1"
    ).get().consumed_at);
    assert.equal(
      fixture.db.prepare("SELECT action FROM audit_logs WHERE actor_user_id = 1").get().action,
      "admin.password_reset"
    );
    assert.equal((await fixture.auth.login(
      { email: "admin@example.test", password: "oldpassword" },
      fixture.request
    )).status, 401);
    assert.equal((await fixture.auth.login(
      { email: "admin@example.test", password: "newpassword" },
      fixture.request
    )).status, 200);
  } finally {
    fixture.close();
  }
});

test("admin password reset refuses unknown and non-admin accounts", async () => {
  const fixture = createFixture();
  try {
    fixture.db.prepare(
      `INSERT INTO users (username, email, password_hash, password_salt, role)
       VALUES ('student_user', 'student@example.test', 'hash', 'salt', 'student')`
    ).run();
    assert.equal(await resetAdminPassword(
      fixture.db,
      "student@example.test",
      "newpassword",
      "test-only-pepper-with-at-least-32-bytes"
    ), null);
    assert.equal(await resetAdminPassword(
      fixture.db,
      "missing@example.test",
      "newpassword",
      "test-only-pepper-with-at-least-32-bytes"
    ), null);
    assert.equal(
      fixture.db.prepare("SELECT password_hash FROM users WHERE id = 1").get().password_hash,
      "hash"
    );
  } finally {
    fixture.close();
  }
});

test("only admins can change roles and the last active admin cannot be demoted", () => {
  const fixture = createFixture();
  try {
    fixture.db.prepare(
      `INSERT INTO users (username, email, password_hash, password_salt, role)
       VALUES ('admin_user', 'admin@example.test', 'test', 'test', 'admin')`
    ).run();
    fixture.db.prepare(
      `INSERT INTO users (username, email, password_hash, password_salt, role)
       VALUES ('student_user', 'other@example.test', 'test', 'test', 'student')`
    ).run();

    assert.equal(fixture.auth.listUsers(2).status, 403);
    assert.equal(fixture.auth.setUserRole(2, 2, "main_admin").status, 403);
    assert.equal(fixture.auth.setUserRole(1, 1, "hall_master").status, 409);
    assert.equal(fixture.auth.setUserRole(1, 2, "hall_president").status, 200);
    assert.equal(fixture.auth.listUsers(1).body.users[1].role, "hall_president");
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'user.role_changed'").get().count, 1);
    assert.equal(fixture.auth.setUserRole(1, 2, "superuser").status, 400);
  } finally {
    fixture.close();
  }
});

test("all Main Admin accounts are protected from role changes, archive, and account edits", async () => {
  const fixture = createFixture();
  try {
    fixture.db.prepare(
      `INSERT INTO users (username, email, password_hash, password_salt, role)
       VALUES ('admin_one', 'admin-one@example.test', 'one-hash', 'one-salt', 'admin')`
    ).run();
    fixture.db.prepare(
      `INSERT INTO users (username, email, password_hash, password_salt, role)
       VALUES ('admin_two', 'admin-two@example.test', 'two-hash', 'two-salt', 'admin')`
    ).run();

    assert.equal(fixture.auth.setUserRole(1, 2, "hall_master").status, 409);
    assert.equal(fixture.auth.archiveUser(1, 2).status, 409);
    assert.equal((await fixture.auth.updateUser(1, 2, {
      username: "changed_admin",
      email: "changed@example.test",
      password: "changed-password"
    })).status, 409);
    assert.deepEqual({ ...fixture.db.prepare(
      "SELECT username, email, password_hash, password_salt, role FROM users WHERE id = 2"
    ).get() }, {
      username: "admin_two",
      email: "admin-two@example.test",
      password_hash: "two-hash",
      password_salt: "two-salt",
      role: "admin"
    });
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM archived_users").get().count, 0);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM audit_logs").get().count, 0);
  } finally {
    fixture.close();
  }
});

test("Main Admin can permanently delete a non-admin account without deleting hostel records", () => {
  const fixture = createFixture();
  try {
    fixture.db.prepare(
      `INSERT INTO users (username, email, password_hash, password_salt, role)
       VALUES ('admin_user', 'admin@example.test', 'admin-hash', 'admin-salt', 'admin')`
    ).run();
    fixture.db.prepare(
      `INSERT INTO users (username, email, password_hash, password_salt, role)
       VALUES ('student_user', 'student@example.test', 'student-hash', 'student-salt', 'student')`
    ).run();
    fixture.db.prepare(
      "INSERT INTO rooms (room_number, capacity, monthly_rate_cents) VALUES ('T-101', 2, 10000)"
    ).run();
    fixture.db.prepare(
      `INSERT INTO hostel_registrations (student_name, student_email, room_id, status)
       VALUES ('Student User', 'student@example.test', 1, 'checked_in')`
    ).run();
    fixture.db.prepare(
      "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ('student-session', 2, '2099-01-01T00:00:00Z')"
    ).run();

    assert.equal(fixture.auth.deleteUser(2, 2).status, 403);
    assert.equal(fixture.auth.deleteUser(1, 1).status, 409);
    assert.equal(fixture.auth.deleteUser(1, 3).status, 404);
    assert.equal(fixture.auth.deleteUser(1, 2).status, 200);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM users WHERE id = 2").get().count, 0);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM auth_sessions WHERE user_id = 2").get().count, 0);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM hostel_registrations WHERE student_email = 'student@example.test'").get().count, 1);
    const deletionAudit = fixture.db.prepare(
      "SELECT action, details_json FROM audit_logs WHERE action = 'user.deleted'"
    ).get();
    assert.equal(deletionAudit.action, "user.deleted");
    assert.equal(JSON.parse(deletionAudit.details_json).hostelRecordsPreserved, true);
  } finally {
    fixture.close();
  }
});

test("Main Admin can edit account details and reset a user's password safely", async () => {
  const fixture = createFixture();
  try {
    fixture.db.prepare(
      `INSERT INTO users (username, email, password_hash, password_salt, role)
       VALUES ('admin_user', 'admin@example.test', 'admin-hash', 'admin-salt', 'admin')`
    ).run();
    fixture.db.prepare(
      `INSERT INTO users (username, email, password_hash, password_salt, role)
       VALUES ('student_user', 'student@example.test', 'student-hash', 'student-salt', 'student')`
    ).run();
    fixture.db.prepare(
      "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ('session-hash', 2, '2099-01-01T00:00:00Z')"
    ).run();

    assert.equal((await fixture.auth.updateUser(2, 2, { username: "updated_user" })).status, 403);
    assert.equal((await fixture.auth.updateUser(1, 2, { password: "short" })).status, 400);
    const updated = await fixture.auth.updateUser(1, 2, {
      username: "updated_user",
      email: "updated@example.test",
      password: "updated-pass-8"
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.user.username, "updated_user");
    assert.equal(updated.body.user.email, "updated@example.test");
    assert.equal(updated.body.user.role, "student");
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM auth_sessions WHERE user_id = 2").get().count, 0);
    const stored = fixture.db.prepare("SELECT password_hash, password_salt FROM users WHERE id = 2").get();
    assert.notEqual(stored.password_hash, "student-hash");
    assert.notEqual(stored.password_salt, "student-salt");
  } finally {
    fixture.close();
  }
});

test("admins can archive and restore users without changing hostel records", async () => {
  const fixture = createFixture();
  try {
    fixture.db.prepare(
      `INSERT INTO users (username, email, password_hash, password_salt, role)
       VALUES ('admin_user', 'admin@example.test', 'admin-hash', 'admin-salt', 'admin')`
    ).run();
    fixture.db.prepare(
      `INSERT INTO users (username, email, password_hash, password_salt, role)
       VALUES ('student_user', 'student@example.test', 'student-hash', 'student-salt', 'student')`
    ).run();
    fixture.db.prepare(
      `INSERT INTO rooms (room_number, capacity, monthly_rate_cents) VALUES ('T-101', 2, 10000)`
    ).run();
    fixture.db.prepare(
      `INSERT INTO hostel_registrations (student_name, student_email, room_id, status)
       VALUES ('Test Resident', 'resident@example.test', 1, 'checked_in')`
    ).run();

    assert.equal(fixture.auth.listArchivedUsers(2).status, 403);
    assert.equal(fixture.auth.archiveUser(2, 2).status, 403);
    assert.equal(fixture.auth.archiveUser(1, 1).status, 409);
    assert.equal(fixture.auth.archiveUser(1, 2).status, 200);
    const archived = fixture.auth.listArchivedUsers(1).body.users;
    assert.equal(archived.length, 1);
    assert.equal(archived[0].username, "student_user");
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM users WHERE id = 2").get().count, 0);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM hostel_registrations").get().count, 1);

    assert.equal(fixture.auth.restoreUser(1, archived[0].id).status, 200);
    const restored = { ...fixture.db.prepare(
      "SELECT username, email, password_hash, password_salt, role FROM users WHERE email = ?"
    ).get("student@example.test") };
    assert.deepEqual(restored, {
      username: "student_user",
      email: "student@example.test",
      password_hash: "student-hash",
      password_salt: "student-salt",
      role: "student"
    });
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM archived_users").get().count, 0);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM hostel_registrations").get().count, 1);
    assert.equal(
      fixture.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action IN ('user.archived', 'user.restored')").get().count,
      2
    );
  } finally {
    fixture.close();
  }
});

test("restore refuses active username or email collisions without losing the archive", () => {
  const fixture = createFixture();
  try {
    fixture.db.prepare(
      `INSERT INTO users (username, email, password_hash, password_salt, role)
       VALUES ('admin_user', 'admin@example.test', 'test', 'test', 'admin')`
    ).run();
    fixture.db.prepare(
      `INSERT INTO users (username, email, password_hash, password_salt, role)
       VALUES ('old_name', 'old@example.test', 'old-hash', 'old-salt', 'student')`
    ).run();
    assert.equal(fixture.auth.archiveUser(1, 2).status, 200);
    const archiveId = fixture.auth.listArchivedUsers(1).body.users[0].id;
    fixture.db.prepare(
      `INSERT INTO users (username, email, password_hash, password_salt, role)
       VALUES ('old_name', 'new@example.test', 'new-hash', 'new-salt', 'student')`
    ).run();
    assert.equal(fixture.auth.restoreUser(1, archiveId).status, 409);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM archived_users WHERE id = ?").get(archiveId).count, 1);
  } finally {
    fixture.close();
  }
});
