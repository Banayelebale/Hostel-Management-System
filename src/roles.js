export const ROLES = Object.freeze([
  "main_admin",
  "hall_master",
  "hall_president",
  "student"
]);

export function effectiveRole(user) {
  if (ROLES.includes(user?.role_code)) return user.role_code;
  if (user?.role === "admin") return "main_admin";
  if (user?.role === "portal") return "hall_master";
  return "student";
}

export function legacyRole(role) {
  if (role === "main_admin") return "admin";
  if (role === "hall_master" || role === "hall_president") return "portal";
  return "student";
}

export function roleLabel(role) {
  return {
    main_admin: "Main Admin (Porter)",
    hall_master: "Hall Master / Mistress",
    hall_president: "Hall President",
    student: "Student"
  }[role] ?? "Student";
}
