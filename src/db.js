import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(path.join(projectRoot, ".env"));
} catch (error) {
  if (error.code !== "ENOENT") {
    throw error;
  }
}

const configuredPath = process.env.DATABASE_PATH ?? "./data/hostel.sqlite";
const databasePath = path.resolve(projectRoot, configuredPath);

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 15000");
db.exec("PRAGMA journal_mode = WAL");

export default db;
