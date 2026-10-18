import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createOperations } from "../src/operations.js";

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
    `INSERT INTO users (username, email, password_hash, password_salt, role)
     VALUES ('student_user', 'student@example.test', 'hash', 'salt', 'student')`
  ).run();
  db.prepare(
    "INSERT INTO rooms (room_number, capacity, monthly_rate_cents) VALUES ('A-101', 1, 45000)"
  ).run();
  db.prepare(
    `INSERT INTO hostel_registrations
      (student_name, student_email, room_id, status, check_in_at)
     VALUES ('Resident One', 'resident1@example.test', 1, 'checked_in', CURRENT_TIMESTAMP)`
  ).run();
  db.prepare(
    `INSERT INTO hostel_registrations (student_name, student_email, room_id, status)
     VALUES ('Resident Two', 'resident2@example.test', 1, 'pending')`
  ).run();
  db.prepare(
    `INSERT INTO hostel_registrations (student_name, student_email, room_id, status)
     VALUES ('Student Account', 'student@example.test', NULL, 'pending')`
  ).run();
  return { db, operations: createOperations(db), close: () => db.close() };
}

test("dashboard and reports enforce roles and only expose a student's own record", () => {
  const fixture = createFixture();
  try {
    const dashboard = fixture.operations.dashboard(1);
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.stats.checked_in, 1);
    assert.equal(dashboard.body.stats.available_beds, 0);
    assert.equal(dashboard.body.rooms[0].occupied, 1);
    assert.equal(dashboard.body.stats.estimated_monthly_room_value_cents, 45000);
    assert.equal(fixture.operations.reports(2).status, 200);
    assert.equal(fixture.operations.reports(3).status, 403);
    assert.equal(fixture.operations.dashboard(3).body.registration.student_email, "student@example.test");
  } finally {
    fixture.close();
  }
});

test("only Main Admin and Hall Master can check students in/out and room capacity is enforced", () => {
  const fixture = createFixture();
  try {
    assert.equal(fixture.operations.checkIn(3, 2).status, 403);
    assert.equal(fixture.operations.checkIn(2, 2).status, 409);
    assert.equal(fixture.operations.checkOut(2, 2).status, 409);
    assert.equal(fixture.operations.checkOut(2, 1).status, 200);
    assert.equal(fixture.operations.checkIn(2, 2).status, 200);
    assert.equal(fixture.operations.checkIn(2, 2).status, 409);
    assert.equal(fixture.operations.checkOut(2, 2).status, 200);
    assert.equal(
      fixture.db.prepare(
        `SELECT COUNT(*) AS count FROM audit_logs
         WHERE action IN ('hostel.checked_in', 'hostel.checked_out')`
      ).get().count,
      3
    );
  } finally {
    fixture.close();
  }
});

test("students submit Haven Hall registrations and staff allocate, move, and view residents", () => {
  const fixture = createFixture();
  try {
    fixture.db.prepare(
      `INSERT INTO users (username, email, password_hash, password_salt, role, role_code)
       VALUES ('new_student', 'newstudent@example.test', 'hash', 'salt', 'student', 'student')`
    ).run();
    fixture.db.prepare(
      "INSERT INTO rooms (room_number, capacity, monthly_rate_cents, gender) VALUES ('B-202', 4, 50000, 'male')"
    ).run();
    fixture.db.prepare(
      "INSERT INTO rooms (room_number, capacity, monthly_rate_cents, gender) VALUES ('B-204', 4, 50000, 'male')"
    ).run();

    const registration = fixture.operations.registerResident(4, {
      studentName: "New Student",
      gender: "male",
      phone: "555-0100",
      emergencyContactName: "Emergency Contact",
      emergencyContactPhone: "555-0101",
      notes: "First year"
    });
    assert.equal(registration.status, 201);
    const registrationId = registration.body.registrationId;
    assert.equal(fixture.operations.registerResident(4, {
      studentName: "Duplicate",
      gender: "male"
    }).status, 409);
    assert.equal(fixture.operations.registerResident(2, {
      studentName: "Not a student",
      gender: "male"
    }).status, 403);

    assert.equal(fixture.operations.assignRoom(2, registrationId, 1).status, 409);
    assert.equal(fixture.operations.assignRoom(2, registrationId, 2).status, 200);
    assert.equal(fixture.operations.checkIn(2, registrationId).status, 200);
    const roomDetails = fixture.operations.roomDetails(2, 2);
    assert.equal(roomDetails.status, 200);
    assert.equal(roomDetails.body.room.occupied, 1);
    assert.equal(roomDetails.body.residents.some((resident) => resident.student_name === "New Student"), true);

    assert.equal(fixture.operations.assignRoom(2, registrationId, null).status, 409);
    assert.equal(fixture.operations.assignRoom(2, registrationId, 3).status, 200);
    assert.equal(fixture.operations.checkOut(2, registrationId).status, 200);
    const dashboard = fixture.operations.dashboard(2).body;
    assert.equal(dashboard.stats.checked_in, 1);
    assert.equal(dashboard.rooms.find((room) => room.id === 3).occupied, 0);
  } finally {
    fixture.close();
  }
});

test("Hall President can view operations but cannot modify residents", () => {
  const fixture = createFixture();
  try {
    fixture.db.prepare(
      `INSERT INTO users (username, email, password_hash, password_salt, role, role_code)
       VALUES ('president', 'president@example.test', 'hash', 'salt', 'portal', 'hall_president')`
    ).run();
    assert.equal(fixture.operations.dashboard(4).body.readOnly, true);
    assert.equal(fixture.operations.reports(4).status, 200);
    assert.equal(fixture.operations.assignRoom(4, 2, 1).status, 403);
    assert.equal(fixture.operations.checkOut(4, 1).status, 403);
  } finally {
    fixture.close();
  }
});

test("check-in rejects missing and unassigned registrations", () => {
  const fixture = createFixture();
  try {
    assert.equal(fixture.operations.checkIn(1, 999).status, 404);
    assert.equal(fixture.operations.checkIn(1, 3).status, 409);
    assert.equal(
      fixture.db.prepare("SELECT status FROM hostel_registrations WHERE id = 3").get().status,
      "pending"
    );
  } finally {
    fixture.close();
  }
});
