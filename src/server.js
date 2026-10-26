import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAuth } from "./auth.js";
import { createConfigBackupStore } from "./backups.js";
import { bootstrapInitialAdmin } from "./bootstrap-admin.js";
import { createOtpEmailSender } from "./email.js";
import { createOperations } from "./operations.js";
import db from "./db.js";

const port = Number(process.env.PORT ?? 3000);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDirectory = path.join(projectRoot, "public");
const backupDirectory = path.resolve(projectRoot, process.env.BACKUP_DIRECTORY ?? "./backups");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};
const auth = createAuth(db, process.env.AUTH_PEPPER, {
  otpEnabled: process.env.NODE_ENV !== "production" && process.env.DEMO_OTP === "true",
  sendOtpEmail: createOtpEmailSender()
});
const backups = createConfigBackupStore(db, process.env.BACKUP_ENCRYPTION_KEY, backupDirectory);
const operations = createOperations(db);

function sendJson(response, result) {
  response.writeHead(result.status, {
    "Content-Type": "application/json; charset=utf-8",
    ...(result.cookie ? { "Set-Cookie": result.cookie } : {})
  });
  response.end(JSON.stringify(result.body));
}

async function readJson(request) {
  if (!request.headers["content-type"]?.startsWith("application/json")) {
    return { error: "Content-Type must be application/json.", status: 415 };
  }
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 16_384) {
      return { error: "Request body is too large.", status: 413 };
    }
  }
  try {
    const data = JSON.parse(body);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Expected a JSON object.");
    return data;
  } catch {
    return { error: "Request body must be a valid JSON object.", status: 400 };
  }
}

const server = http.createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
  );

  try {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (["POST", "PATCH", "DELETE"].includes(request.method) && request.headers.origin) {
      const origin = new URL(request.headers.origin);
      if (origin.host !== request.headers.host) {
        sendJson(response, { status: 403, body: { error: "Cross-origin request rejected." } });
        return;
      }
    }

    if (pathname === "/api/health" && request.method === "GET") {
      db.prepare("SELECT 1").get();
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ status: "ok", database: "connected" }));
      return;
    }

    if (request.method === "GET" && pathname === "/api/dashboard") {
      const user = auth.currentUser(request);
      sendJson(response, user
        ? operations.dashboard(user.id)
        : { status: 401, body: { error: "Sign in required." } });
      return;
    }

    const roomRoute = pathname.match(/^\/api\/rooms\/(\d+)$/);
    if (request.method === "GET" && roomRoute) {
      const user = auth.currentUser(request);
      sendJson(response, user
        ? operations.roomDetails(user.id, Number(roomRoute[1]))
        : { status: 401, body: { error: "Sign in required." } });
      return;
    }

    if (request.method === "GET" && pathname === "/api/reports") {
      const user = auth.currentUser(request);
      sendJson(response, user
        ? operations.reports(user.id)
        : { status: 401, body: { error: "Sign in required." } });
      return;
    }

    if (request.method === "POST" && pathname === "/api/registrations") {
      const user = auth.currentUser(request);
      if (!user) {
        sendJson(response, { status: 401, body: { error: "Sign in required." } });
        return;
      }
      const body = await readJson(request);
      if (body.error) {
        sendJson(response, { status: body.status, body: { error: body.error } });
        return;
      }
      sendJson(response, operations.registerResident(user.id, body));
      return;
    }

    const assignRoomRoute = pathname.match(/^\/api\/registrations\/(\d+)\/room$/);
    if (request.method === "PATCH" && assignRoomRoute) {
      const user = auth.currentUser(request);
      if (!user) {
        sendJson(response, { status: 401, body: { error: "Sign in required." } });
        return;
      }
      const body = await readJson(request);
      if (body.error) {
        sendJson(response, { status: body.status, body: { error: body.error } });
        return;
      }
      const roomId = body.roomId === null ? null : Number(body.roomId);
      sendJson(response, operations.assignRoom(user.id, Number(assignRoomRoute[1]), roomId));
      return;
    }

    const checkInRoute = pathname.match(/^\/api\/registrations\/(\d+)\/check-in$/);
    if (request.method === "POST" && checkInRoute) {
      const user = auth.currentUser(request);
      sendJson(response, user
        ? operations.checkIn(user.id, Number(checkInRoute[1]))
        : { status: 401, body: { error: "Sign in required." } });
      return;
    }

    const checkOutRoute = pathname.match(/^\/api\/registrations\/(\d+)\/check-out$/);
    if (request.method === "POST" && checkOutRoute) {
      const user = auth.currentUser(request);
      sendJson(response, user
        ? operations.checkOut(user.id, Number(checkOutRoute[1]))
        : { status: 401, body: { error: "Sign in required." } });
      return;
    }

    if (request.method === "POST" && pathname.startsWith("/api/auth/")) {
      const body = await readJson(request);
      if (body.error) {
        sendJson(response, { status: body.status, body: { error: body.error } });
        return;
      }

      let result;
      if (pathname === "/api/auth/register") result = await auth.register(body, request);
      else if (pathname === "/api/auth/login") result = await auth.login(body, request);
      else if (pathname === "/api/auth/verify-otp") result = auth.verifyOtp(body);
      else if (pathname === "/api/auth/logout") result = auth.logout(request);
      else {
        sendJson(response, { status: 404, body: { error: "Not found." } });
        return;
      }
      sendJson(response, result);
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/users") {
      const user = auth.currentUser(request);
      const result = user
        ? auth.listUsers(user.id)
        : { status: 401, body: { error: "Sign in required." } };
      sendJson(response, result);
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/security") {
      const user = auth.currentUser(request);
      sendJson(response, user
        ? auth.securityInfo(user.id)
        : { status: 401, body: { error: "Sign in required." } });
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/archived-users") {
      const user = auth.currentUser(request);
      const result = user
        ? auth.listArchivedUsers(user.id)
        : { status: 401, body: { error: "Sign in required." } };
      sendJson(response, result);
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/backups") {
      const user = auth.currentUser(request);
      sendJson(response, user
        ? backups.list(user.id)
        : { status: 401, body: { error: "Sign in required." } });
      return;
    }

    if (request.method === "POST" && pathname === "/api/admin/backups") {
      const user = auth.currentUser(request);
      sendJson(response, user
        ? backups.create(user.id)
        : { status: 401, body: { error: "Sign in required." } });
      return;
    }

    const backupRestoreRoute = pathname.match(/^\/api\/admin\/backups\/([a-f0-9-]{36})\/restore$/);
    if (request.method === "POST" && backupRestoreRoute) {
      const user = auth.currentUser(request);
      sendJson(response, user
        ? backups.restore(user.id, backupRestoreRoute[1])
        : { status: 401, body: { error: "Sign in required." } });
      return;
    }

    const archiveRoute = pathname.match(/^\/api\/admin\/users\/(\d+)\/archive$/);
    if (request.method === "POST" && archiveRoute) {
      const user = auth.currentUser(request);
      if (!user) {
        sendJson(response, { status: 401, body: { error: "Sign in required." } });
        return;
      }
      sendJson(response, auth.archiveUser(user.id, Number(archiveRoute[1])));
      return;
    }

    const deleteUserRoute = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
    if (request.method === "DELETE" && deleteUserRoute) {
      const user = auth.currentUser(request);
      if (!user) {
        sendJson(response, { status: 401, body: { error: "Sign in required." } });
        return;
      }
      sendJson(response, auth.deleteUser(user.id, Number(deleteUserRoute[1])));
      return;
    }

    const restoreRoute = pathname.match(/^\/api\/admin\/archived-users\/(\d+)\/restore$/);
    if (request.method === "POST" && restoreRoute) {
      const user = auth.currentUser(request);
      if (!user) {
        sendJson(response, { status: 401, body: { error: "Sign in required." } });
        return;
      }
      sendJson(response, auth.restoreUser(user.id, Number(restoreRoute[1])));
      return;
    }

    const roleRoute = pathname.match(/^\/api\/admin\/users\/(\d+)\/role$/);
    if (request.method === "PATCH" && roleRoute) {
      const user = auth.currentUser(request);
      if (!user) {
        sendJson(response, { status: 401, body: { error: "Sign in required." } });
        return;
      }
      const body = await readJson(request);
      if (body.error) {
        sendJson(response, { status: body.status, body: { error: body.error } });
        return;
      }
      sendJson(response, auth.setUserRole(user.id, Number(roleRoute[1]), body.role));
      return;
    }

    const accountRoute = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
    if (request.method === "PATCH" && accountRoute) {
      const user = auth.currentUser(request);
      if (!user) {
        sendJson(response, { status: 401, body: { error: "Sign in required." } });
        return;
      }
      const body = await readJson(request);
      if (body.error) {
        sendJson(response, { status: body.status, body: { error: body.error } });
        return;
      }
      sendJson(response, await auth.updateUser(user.id, Number(accountRoute[1]), body));
      return;
    }

    if (request.method === "GET" && pathname === "/api/auth/me") {
      const user = auth.currentUser(request);
      sendJson(response, { status: 200, body: { user } });
      return;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      const appRoutes = new Set(["/", "/dashboard", "/reports", "/admin", "/implementation-report"]);
      const fileName = appRoutes.has(pathname) ? "index.html" : pathname.slice(1);
      if (!["index.html", "styles.css", "app.js"].includes(fileName)) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      const filePath = path.join(publicDirectory, fileName);
      fs.readFile(filePath, (error, content) => {
        if (error) {
          console.error(`Failed to serve ${fileName}:`, error);
          response.writeHead(500);
          response.end("Internal server error");
          return;
        }
        response.writeHead(200, {
          "Content-Type": contentTypes[path.extname(filePath)],
          "Cache-Control": "no-cache"
        });
        response.end(request.method === "HEAD" ? undefined : content);
      });
      return;
    }

    response.writeHead(405, { Allow: "GET, HEAD, POST, PATCH" });
    response.end();
  } catch (error) {
    console.error("Request failed:", error);
    if (!response.headersSent) {
      sendJson(response, { status: 500, body: { error: "Internal server error." } });
    } else {
      response.destroy();
    }
  }
});

await bootstrapInitialAdmin(db);
server.listen(port, () => {
  console.log(`Hostel Management System is running on port ${port}`);
});

function closeServer() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", closeServer);
process.on("SIGTERM", closeServer);
app.use(session({
  secret: process.env.SESSION_SECRET || "your-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true, // Required for Render's HTTPS
    sameSite: 'none', // Allows cookie persistence across browser requests
    maxAge: 1000 * 60 * 60 * 24 // 1 day session duration
  }
}));
