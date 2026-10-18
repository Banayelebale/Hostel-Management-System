import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "./db.js";

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "schema.sql");
const schema = fs.readFileSync(schemaPath, "utf8");

const existingUserColumns = db.prepare("PRAGMA table_info(users)").all();
const hadRoleCode = existingUserColumns.some((column) => column.name === "role_code");
const existingArchivedColumns = db.prepare("PRAGMA table_info(archived_users)").all();
const hadArchivedRoleCode = existingArchivedColumns.some((column) => column.name === "role_code");
db.exec(schema);
const userColumns = db.prepare("PRAGMA table_info(users)").all();
if (!userColumns.some((column) => column.name === "password_salt")) {
  db.exec("ALTER TABLE users ADD COLUMN password_salt TEXT NOT NULL DEFAULT ''");
}
if (!userColumns.some((column) => column.name === "role_code")) {
  db.exec("ALTER TABLE users ADD COLUMN role_code TEXT");
}
if (!userColumns.some((column) => column.name === "requested_role")) {
  db.exec("ALTER TABLE users ADD COLUMN requested_role TEXT");
}
if (!hadRoleCode) {
  db.exec(
    `UPDATE users SET role_code = CASE role
       WHEN 'admin' THEN 'main_admin'
       WHEN 'portal' THEN 'hall_master'
       ELSE 'student'
     END`
  );
}
const archivedUserColumns = db.prepare("PRAGMA table_info(archived_users)").all();
if (!archivedUserColumns.some((column) => column.name === "password_salt")) {
  db.exec("ALTER TABLE archived_users ADD COLUMN password_salt TEXT NOT NULL DEFAULT ''");
}
if (!archivedUserColumns.some((column) => column.name === "role_code")) {
  db.exec("ALTER TABLE archived_users ADD COLUMN role_code TEXT");
}
if (!hadArchivedRoleCode) {
  db.exec(
    `UPDATE archived_users SET role_code = CASE role
       WHEN 'admin' THEN 'main_admin'
       WHEN 'portal' THEN 'hall_master'
       ELSE 'student'
     END`
  );
}
const roomColumns = db.prepare("PRAGMA table_info(rooms)").all();
if (!roomColumns.some((column) => column.name === "gender")) {
  db.exec("ALTER TABLE rooms ADD COLUMN gender TEXT NOT NULL DEFAULT 'female'");
  db.exec(
    `UPDATE rooms SET gender = CASE
       WHEN CAST(substr(room_number, instr(room_number, '-') + 1) AS INTEGER) % 2 = 0 THEN 'female'
       ELSE 'male'
     END`
  );
}
const registrationColumns = db.prepare("PRAGMA table_info(hostel_registrations)").all();
const registrationMigrations = [
  ["student_phone", "TEXT"],
  ["gender", "TEXT"],
  ["hall_name", "TEXT NOT NULL DEFAULT 'Haven Hall'"],
  ["emergency_contact_name", "TEXT"],
  ["emergency_contact_phone", "TEXT"],
  ["notes", "TEXT"]
];
for (const [name, definition] of registrationMigrations) {
  if (!registrationColumns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE hostel_registrations ADD COLUMN ${name} ${definition}`);
  }
}
console.log("Database schema is up to date.");
db.close();
