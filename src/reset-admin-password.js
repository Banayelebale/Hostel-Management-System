import readline from "node:readline";
import { resetAdminPassword } from "./auth.js";
import db from "./db.js";

function prompt(label, hidden = false) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const output = process.stdout;
    output.write(label);
    if (hidden && (!input.isTTY || typeof input.setRawMode !== "function")) {
      reject(new Error("Run this command in an interactive terminal so the password is not exposed."));
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
          reject(new Error("Password reset cancelled."));
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
  const email = (await prompt("Admin email: ")).trim().toLowerCase();
  const password = await prompt("New password (hidden): ", true);
  const confirmation = await prompt("Confirm new password (hidden): ", true);
  if (password !== confirmation) {
    throw new Error("Passwords do not match. No changes were made.");
  }

  const resetAdmin = await resetAdminPassword(
    db,
    email,
    password,
    process.env.AUTH_PEPPER
  );
  if (!resetAdmin) {
    throw new Error("No active administrator found with that email. No changes were made.");
  }
  console.log(`Password reset for ${resetAdmin.email}. Sign in with your new password.`);
} finally {
  db.close();
}
