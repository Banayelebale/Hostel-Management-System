import { effectiveRole } from "./roles.js";

function getActiveUser(db, userId) {
  const user = db.prepare(
    "SELECT id, email, role, role_code FROM users WHERE id = ? AND is_active = 1"
  ).get(userId);
  return user ? { ...user, role: effectiveRole(user) } : null;
}

function canManageResidents(user) {
  return ["main_admin", "hall_master"].includes(user?.role);
}

function canViewOperations(user) {
  return ["main_admin", "hall_master", "hall_president"].includes(user?.role);
}

function residentQuery(db, where = "", ...params) {
  return db.prepare(
    `SELECT r.id, r.student_name, r.student_email, r.student_phone, r.gender,
            r.hall_name, r.emergency_contact_name, r.emergency_contact_phone,
            r.notes, r.status, r.check_in_at, r.check_out_at, r.created_at, r.room_id,
            rooms.room_number
     FROM hostel_registrations AS r
     LEFT JOIN rooms ON rooms.id = r.room_id
     ${where}
     ORDER BY r.student_name COLLATE NOCASE, r.id DESC`
  ).all(...params);
}

export function createOperations(db) {
  function dashboard(userId) {
    const user = getActiveUser(db, userId);
    if (!user) return { status: 401, body: { error: "Sign in required." } };
    if (user.role === "student") {
      const registration = residentQuery(
        db,
        "WHERE r.student_email = ? COLLATE NOCASE",
        user.email
      )[0] ?? null;
      return { status: 200, body: { role: user.role, registration } };
    }
    if (!canViewOperations(user)) {
      return { status: 403, body: { error: "This role cannot view hostel operations." } };
    }

    const stats = db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM rooms WHERE is_active = 1) AS active_rooms,
         (SELECT COALESCE(SUM(capacity), 0) FROM rooms WHERE is_active = 1) AS total_capacity,
         (SELECT COUNT(*) FROM hostel_registrations WHERE status = 'checked_in') AS checked_in,
         (SELECT COUNT(*) FROM hostel_registrations WHERE status = 'pending') AS pending,
         (SELECT COUNT(*) FROM hostel_registrations) AS total_registrations,
         (SELECT COUNT(*) FROM hostel_registrations WHERE status = 'checked_out') AS checked_out`
    ).get();
    const rooms = db.prepare(
      `SELECT rooms.id, rooms.room_number, rooms.gender, rooms.capacity,
              rooms.monthly_rate_cents,
              SUM(CASE WHEN r.status = 'checked_in' THEN 1 ELSE 0 END) AS occupied,
              SUM(CASE WHEN r.status = 'pending' THEN 1 ELSE 0 END) AS pending
       FROM rooms
       LEFT JOIN hostel_registrations AS r ON r.room_id = rooms.id
       WHERE rooms.is_active = 1
       GROUP BY rooms.id
       ORDER BY rooms.room_number`
    ).all().map((room) => ({
      ...room,
      occupied: Number(room.occupied),
      pending: Number(room.pending),
      available: Math.max(0, room.capacity - Number(room.occupied))
    }));
    const registrations = residentQuery(db);
    const occupiedRoomIds = rooms.filter((room) => room.occupied > 0).map((room) => room.id);
    const monthlyValue = occupiedRoomIds.length
      ? db.prepare(
          `SELECT COALESCE(SUM(monthly_rate_cents), 0) AS cents
           FROM rooms WHERE id IN (${occupiedRoomIds.map(() => "?").join(",")})`
        ).get(...occupiedRoomIds).cents
      : 0;
    return {
      status: 200,
      body: {
        role: user.role,
        readOnly: !canManageResidents(user),
        stats: {
          ...stats,
          available_beds: Math.max(0, stats.total_capacity - stats.checked_in),
          occupancy_percent: stats.total_capacity
            ? Math.round((stats.checked_in / stats.total_capacity) * 100)
            : 0,
          vacant_rooms: rooms.filter((room) => room.occupied === 0).length,
          rooms_with_vacancies: rooms.filter((room) => room.available > 0).length,
          estimated_monthly_room_value_cents: monthlyValue
        },
        rooms,
        residents: registrations.filter((resident) => resident.status === "checked_in"),
        pending: registrations.filter((resident) => resident.status === "pending"),
        checkedOut: registrations.filter((resident) => resident.status === "checked_out"),
        recent: registrations
          .slice()
          .sort((a, b) => String(b.created_at ?? b.check_in_at ?? "").localeCompare(String(a.created_at ?? a.check_in_at ?? "")))
      }
    };
  }

  function roomDetails(userId, roomId) {
    const user = getActiveUser(db, userId);
    if (!user) return { status: 401, body: { error: "Sign in required." } };
    if (!canViewOperations(user)) {
      return { status: 403, body: { error: "Room details are not available to this role." } };
    }
    if (!Number.isSafeInteger(roomId) || roomId < 1) {
      return { status: 400, body: { error: "Invalid room ID." } };
    }
    const room = db.prepare(
      `SELECT rooms.id, rooms.room_number, rooms.gender, rooms.capacity,
              rooms.monthly_rate_cents,
              SUM(CASE WHEN r.status = 'checked_in' THEN 1 ELSE 0 END) AS occupied,
              SUM(CASE WHEN r.status = 'pending' THEN 1 ELSE 0 END) AS pending
       FROM rooms LEFT JOIN hostel_registrations AS r ON r.room_id = rooms.id
       WHERE rooms.id = ? AND rooms.is_active = 1 GROUP BY rooms.id`
    ).get(roomId);
    if (!room) return { status: 404, body: { error: "Room not found." } };
    return {
      status: 200,
      body: {
        room: { ...room, occupied: Number(room.occupied), pending: Number(room.pending) },
        residents: residentQuery(db, "WHERE r.room_id = ?", roomId)
      }
    };
  }

  function reports(userId) {
    const user = getActiveUser(db, userId);
    if (!user) return { status: 401, body: { error: "Sign in required." } };
    if (!canViewOperations(user)) return { status: 403, body: { error: "Hall President, Hall Master/Mistress, or Main Admin role required." } };
    const all = residentQuery(db);
    const statusSummary = ["checked_in", "checked_out", "pending"].map((status) => ({
      status,
      count: all.filter((resident) => resident.status === status).length
    }));
    const rooms = db.prepare(
      `SELECT rooms.id, rooms.room_number, rooms.gender, rooms.capacity,
              rooms.monthly_rate_cents,
              SUM(CASE WHEN r.status = 'checked_in' THEN 1 ELSE 0 END) AS occupied
       FROM rooms LEFT JOIN hostel_registrations AS r ON r.room_id = rooms.id
       WHERE rooms.is_active = 1 GROUP BY rooms.id ORDER BY rooms.room_number`
    ).all().map((room) => ({ ...room, occupied: Number(room.occupied) }));
    const monthlyValue = rooms.filter((room) => room.occupied > 0)
      .reduce((total, room) => total + room.monthly_rate_cents, 0);
    const audit = db.prepare(
      `SELECT audit_logs.action, audit_logs.target_type, audit_logs.target_id,
              audit_logs.details_json, audit_logs.created_at, users.username AS actor
       FROM audit_logs LEFT JOIN users ON users.id = audit_logs.actor_user_id
       ORDER BY audit_logs.id DESC LIMIT 50`
    ).all();
    const checkinActivity = db.prepare(
      `SELECT date(check_in_at) AS day, COUNT(*) AS count
       FROM hostel_registrations
       WHERE check_in_at >= datetime('now', '-30 days')
       GROUP BY date(check_in_at)
       ORDER BY day DESC`
    ).all();
    return {
      status: 200,
      body: {
        statusSummary,
        residents: all.filter((resident) => resident.status === "checked_in"),
        checkins: all.filter((resident) => resident.check_in_at),
        checkouts: all.filter((resident) => resident.check_out_at),
        pending: all.filter((resident) => resident.status === "pending"),
        rooms,
        audit,
        checkinActivity,
        estimatedMonthlyRoomValueCents: monthlyValue,
        occupiedRooms: rooms.filter((room) => room.occupied > 0),
        vacantRooms: rooms.filter((room) => room.occupied === 0),
        revenueNote: "Estimated monthly value of occupied rooms, based on room rates; not collected revenue."
      }
    };
  }

  function registerResident(userId, input) {
    const user = getActiveUser(db, userId);
    if (!user) return { status: 401, body: { error: "Sign in required." } };
    if (user.role !== "student") return { status: 403, body: { error: "Only student accounts can submit a resident registration." } };
    const name = typeof input.studentName === "string" ? input.studentName.trim() : "";
    const phone = typeof input.phone === "string" ? input.phone.trim() : "";
    const gender = input.gender;
    const emergencyName = typeof input.emergencyContactName === "string" ? input.emergencyContactName.trim() : "";
    const emergencyPhone = typeof input.emergencyContactPhone === "string" ? input.emergencyContactPhone.trim() : "";
    const notes = typeof input.notes === "string" ? input.notes.trim() : "";
    if (name.length < 2 || name.length > 100 || !["male", "female", "other", "prefer_not_to_say"].includes(gender)) {
      return { status: 400, body: { error: "Enter your full name and select a valid gender." } };
    }
    if (phone.length > 40 || emergencyName.length > 100 || emergencyPhone.length > 40 || notes.length > 1000) {
      return { status: 400, body: { error: "Contact details or notes exceed the allowed length." } };
    }
    const existing = db.prepare(
      "SELECT id, status FROM hostel_registrations WHERE student_email = ? COLLATE NOCASE ORDER BY id DESC LIMIT 1"
    ).get(user.email);
    if (existing && existing.status !== "checked_out") {
      return { status: 409, body: { error: "You already have an active Haven Hall registration." } };
    }
    const result = db.prepare(
      `INSERT INTO hostel_registrations
       (student_name, student_email, student_phone, gender, hall_name,
        emergency_contact_name, emergency_contact_phone, notes, status)
       VALUES (?, ?, ?, ?, 'Haven Hall', ?, ?, ?, 'pending')`
    ).run(name, user.email, phone || null, gender, emergencyName || null, emergencyPhone || null, notes || null);
    db.prepare(
      `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details_json)
       VALUES (?, 'hostel.registration_submitted', 'registration', ?, ?)`
    ).run(userId, String(result.lastInsertRowid), JSON.stringify({ hall: "Haven Hall" }));
    return { status: 201, body: { message: "Haven Hall registration submitted. The hostel office will assign your room.", registrationId: Number(result.lastInsertRowid) } };
  }

  function assignRoom(actorId, registrationId, roomId) {
    if (!Number.isSafeInteger(registrationId) || registrationId < 1 ||
        (roomId !== null && (!Number.isSafeInteger(roomId) || roomId < 1))) {
      return { status: 400, body: { error: "Choose a valid registration and room." } };
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const actor = getActiveUser(db, actorId);
      if (!canManageResidents(actor)) {
        db.exec("ROLLBACK");
        return { status: actor ? 403 : 401, body: { error: actor ? "Hall Master/Mistress or Main Admin role required." : "Sign in required." } };
      }
      const resident = db.prepare(
        "SELECT id, student_name, room_id, gender, status FROM hostel_registrations WHERE id = ?"
      ).get(registrationId);
      if (!resident) {
        db.exec("ROLLBACK");
        return { status: 404, body: { error: "Resident registration not found." } };
      }
      if (resident.status === "checked_in" && roomId === null) {
        db.exec("ROLLBACK");
        return { status: 409, body: { error: "Check the resident out before removing their room assignment." } };
      }
      if (roomId !== null) {
        const room = db.prepare("SELECT id, room_number, gender, capacity, is_active FROM rooms WHERE id = ?").get(roomId);
        if (!room || !room.is_active) {
          db.exec("ROLLBACK");
          return { status: 404, body: { error: "Available room not found." } };
        }
        if (["male", "female"].includes(resident.gender) && resident.gender !== room.gender) {
          db.exec("ROLLBACK");
          return { status: 409, body: { error: "Room gender does not match the resident's registration." } };
        }
        const occupied = db.prepare(
          "SELECT COUNT(*) AS count FROM hostel_registrations WHERE room_id = ? AND status = 'checked_in' AND id != ?"
        ).get(roomId, registrationId).count;
        if (occupied >= room.capacity) {
          db.exec("ROLLBACK");
          return { status: 409, body: { error: "That room has no free beds." } };
        }
      }
      const previousRoom = resident.room_id;
      db.prepare("UPDATE hostel_registrations SET room_id = ? WHERE id = ?").run(roomId, registrationId);
      db.prepare(
        `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details_json)
         VALUES (?, 'hostel.room_assigned', 'registration', ?, ?)`
      ).run(actorId, String(registrationId), JSON.stringify({ fromRoomId: previousRoom, toRoomId: roomId }));
      db.exec("COMMIT");
      return { status: 200, body: { message: roomId === null ? `${resident.student_name} is now unassigned.` : `${resident.student_name} assigned to the selected room.` } };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function checkIn(actorId, registrationId) {
    if (!Number.isSafeInteger(registrationId) || registrationId < 1) return { status: 400, body: { error: "Invalid registration ID." } };
    db.exec("BEGIN IMMEDIATE");
    try {
      const actor = getActiveUser(db, actorId);
      if (!canManageResidents(actor)) {
        db.exec("ROLLBACK");
        return { status: actor ? 403 : 401, body: { error: actor ? "Hall Master/Mistress or Main Admin role required." : "Sign in required." } };
      }
      const resident = db.prepare(
        "SELECT id, student_name, room_id, gender, status FROM hostel_registrations WHERE id = ?"
      ).get(registrationId);
      if (!resident) {
        db.exec("ROLLBACK");
        return { status: 404, body: { error: "Registration not found." } };
      }
      if (resident.status === "checked_in") {
        db.exec("ROLLBACK");
        return { status: 409, body: { error: "Student is already checked in." } };
      }
      if (resident.room_id === null) {
        db.exec("ROLLBACK");
        return { status: 409, body: { error: "Assign a room before checking in." } };
      }
      const room = db.prepare("SELECT capacity, gender, is_active FROM rooms WHERE id = ?").get(resident.room_id);
      const occupancy = db.prepare(
        "SELECT COUNT(*) AS count FROM hostel_registrations WHERE room_id = ? AND status = 'checked_in'"
      ).get(resident.room_id).count;
      if (!room || !room.is_active || occupancy >= room.capacity ||
          (["male", "female"].includes(resident.gender) && resident.gender !== room.gender)) {
        db.exec("ROLLBACK");
        return { status: 409, body: { error: "The selected room is full or incompatible. Assign an available room before check-in." } };
      }
      db.prepare(
        `UPDATE hostel_registrations
         SET status = 'checked_in', check_in_at = CURRENT_TIMESTAMP, check_out_at = NULL
         WHERE id = ?`
      ).run(registrationId);
      db.prepare(
        `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details_json)
         VALUES (?, 'hostel.checked_in', 'registration', ?, ?)`
      ).run(actorId, String(registrationId), JSON.stringify({ student: resident.student_name }));
      db.exec("COMMIT");
      return { status: 200, body: { message: `${resident.student_name} checked in.` } };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function checkOut(actorId, registrationId) {
    if (!Number.isSafeInteger(registrationId) || registrationId < 1) return { status: 400, body: { error: "Invalid registration ID." } };
    db.exec("BEGIN IMMEDIATE");
    try {
      const actor = getActiveUser(db, actorId);
      if (!canManageResidents(actor)) {
        db.exec("ROLLBACK");
        return { status: actor ? 403 : 401, body: { error: actor ? "Hall Master/Mistress or Main Admin role required." : "Sign in required." } };
      }
      const resident = db.prepare(
        "SELECT id, student_name, status FROM hostel_registrations WHERE id = ?"
      ).get(registrationId);
      if (!resident) {
        db.exec("ROLLBACK");
        return { status: 404, body: { error: "Registration not found." } };
      }
      if (resident.status !== "checked_in") {
        db.exec("ROLLBACK");
        return { status: 409, body: { error: "Only checked-in students can check out." } };
      }
      db.prepare(
        "UPDATE hostel_registrations SET status = 'checked_out', check_out_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).run(registrationId);
      db.prepare(
        `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details_json)
         VALUES (?, 'hostel.checked_out', 'registration', ?, ?)`
      ).run(actorId, String(registrationId), JSON.stringify({ student: resident.student_name }));
      db.exec("COMMIT");
      return { status: 200, body: { message: `${resident.student_name} checked out.` } };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return { dashboard, roomDetails, reports, registerResident, assignRoom, checkIn, checkOut };
}
