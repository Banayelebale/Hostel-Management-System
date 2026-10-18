import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(projectRoot, ".env");

if (fs.existsSync(envPath)) {
  let envContent = fs.readFileSync(envPath, "utf8");
  let changed = false;
  if (!/^BACKUP_DIRECTORY=/m.test(envContent)) {
    envContent += "\nBACKUP_DIRECTORY=./backups";
    changed = true;
  }
  if (!/^BACKUP_ENCRYPTION_KEY=/m.test(envContent)) {
    envContent += `\nBACKUP_ENCRYPTION_KEY=${randomBytes(48).toString("base64url")}`;
    changed = true;
  }
  for (const [name, value] of [
    ["SMTP_HOST", "127.0.0.1"],
    ["SMTP_PORT", "1025"],
    ["SMTP_SECURE", "false"],
    ["MAIL_FROM", "Haven Hostel <no-reply@haven-hostel.test>"]
  ]) {
    if (!new RegExp(`^${name}=`, "m").test(envContent)) {
      envContent += `\n${name}=${value}`;
      changed = true;
    }
  }
  if (changed) fs.writeFileSync(envPath, `${envContent.trimEnd()}\n`, { mode: 0o600 });
  console.log(changed
    ? "Added missing local settings and generated secrets in .env."
    : "Keeping existing .env; no secrets were changed.");
} else {
  const envContent = [
    "NODE_ENV=development",
    "PORT=3000",
    "DATABASE_PATH=./data/hostel.sqlite",
    "BACKUP_DIRECTORY=./backups",
    "DEMO_OTP=true",
    "SMTP_HOST=127.0.0.1",
    "SMTP_PORT=1025",
    "SMTP_SECURE=false",
    "MAIL_FROM=Haven Hostel <no-reply@haven-hostel.test>",
    `AUTH_PEPPER=${randomBytes(48).toString("base64url")}`,
    `BACKUP_ENCRYPTION_KEY=${randomBytes(48).toString("base64url")}`,
    ""
  ].join("\n");
  fs.writeFileSync(envPath, envContent, { flag: "wx", mode: 0o600 });
  console.log("Created .env with a randomly generated local authentication pepper.");
}
