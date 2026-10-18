import readline from "node:readline";
import { createPasswordCredentials } from "./auth.js";
import db from "./db.js";

function prompt(label, hidden = false) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const output = process.stdout;
    output.write(label);
    if (hidden && (!input.isTTY || typeof input.setRawMode !== "function")) {
      reject(new Error("Run admin:create in an interactive terminal so the password is not exposed."));
      return;
    }
    if (!hidden) {
      const rl = readline.createInterface({ input, output });
      rl.once("line", (answer) => {
        rl.close();
        resolve(answer);
      });
      rl.once("error", reject);
      return;
    }
    let answer = "";
    input.setRawMode(true);
    input.resume();
    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          input.setRawMode(false);
          input.off("data", onData);
          reject(new Error("Admin creation cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          input.setRawMode(false);
          input.off("data", onData);
          output.write("\n");
          resolve(answer);
          return;
        }
        if (character === "\u007f" || character === "\b") answer = answer.slice(0, -1);
        else if (character >= " ") answer += character;
      }
    };
    input.on("data", onData);
  });
}

try {
  if (db.prepare("SELECT 1 FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1").get()) {
    throw new Error("An active admin already exists. Use the admin screen to manage roles.");
  }
  const username = (await prompt("Admin username: ")).trim();
  const email = (await prompt("Admin email: ")).trim().toLowerCase();
  const password = await prompt("Admin password (hidden): ", true);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_. -]{1,30}[a-zA-Z0-9]$/.test(username)) {
    throw new Error("Name must be 3-32 letters, numbers, spaces, periods, underscores, or hyphens.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }
  const credentials = await createPasswordCredentials(password, process.env.AUTH_PEPPER);
  const result = db.prepare(
    `INSERT INTO users (username, email, password_hash, password_salt, role, role_code)
     VALUES (?, ?, ?, ?, 'admin', 'main_admin')`
  ).run(username, email, credentials.password_hash, credentials.password_salt);
  db.prepare(
    "INSERT INTO audit_logs (actor_user_id, action, target_type, target_id) VALUES (?, 'admin.bootstrap', 'user', ?)"
  ).run(Number(result.lastInsertRowid), String(result.lastInsertRowid));
  console.log(`Admin account created for ${email}. Sign in with email OTP enabled in local demo mode.`);
} finally {
  db.close();
}
