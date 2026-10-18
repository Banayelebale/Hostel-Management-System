import db from "./db.js";

function seed() {
  db.exec("BEGIN IMMEDIATE");
  try {
    const insertRoom = db.prepare(
      `INSERT OR IGNORE INTO rooms (room_number, capacity, monthly_rate_cents, gender)
       VALUES (?, ?, ?, ?)`
    );
    for (let room = 1; room <= 15; room += 1) {
      insertRoom.run(`A-${String(room).padStart(3, "0")}`, 4, 45000, room % 2 ? "male" : "female");
    }

    const hasDemoData = db.prepare(
      "SELECT 1 FROM hostel_registrations WHERE student_email = ? LIMIT 1"
    ).get("student01@example.test");
    if (!hasDemoData) {
      const insertRegistration = db.prepare(
        `INSERT INTO hostel_registrations
           (student_name, student_email, room_id, status, check_in_at, gender)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      const rooms = db.prepare("SELECT id, gender FROM rooms ORDER BY id").all();
      for (let student = 1; student <= 50; student += 1) {
        const room = rooms[Math.floor((student - 1) / 4) % rooms.length];
        insertRegistration.run(
          `Demo Student ${String(student).padStart(2, "0")}`,
          `student${String(student).padStart(2, "0")}@example.test`,
          room.id,
          student <= 36 ? "checked_in" : "pending",
          student <= 36 ? new Date(Date.UTC(2026, 0, 1 + (student % 28))).toISOString() : null,
          room.gender
        );
      }
    } else {
      db.prepare(
        `UPDATE hostel_registrations SET gender = (
           SELECT gender FROM rooms WHERE rooms.id = hostel_registrations.room_id
         )
         WHERE student_email LIKE 'student__@example.test' AND gender IS NULL`
      ).run();
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

seed();
console.log("Demo data is ready (15 rooms and 50 sample registrations).");
db.close();
