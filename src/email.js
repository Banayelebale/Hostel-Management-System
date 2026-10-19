import nodemailer from "nodemailer";

export function createOtpEmailSender(env = process.env) {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;

  const configuredPort = env.SMTP_PORT?.trim();
  const port = Number(configuredPort || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a number from 1 to 65535 (usually 587 or 465).");
  }
  const secureSetting = env.SMTP_SECURE?.trim().toLowerCase();
  const secureValues = new Map([
    ["true", true],
    ["1", true],
    ["yes", true],
    ["ssl", true],
    ["smtps", true],
    ["false", false],
    ["0", false],
    ["no", false],
    ["starttls", false],
    ["plain", false],
    ["none", false]
  ]);
  const secure = secureSetting ? secureValues.get(secureSetting) : port === 465;
  if (secure === undefined) {
    throw new Error("SMTP_SECURE must be true/false, yes/no, SSL/SMTPS, or STARTTLS.");
  }
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) {
    throw new Error("Configure both SMTP_USER and SMTP_PASSWORD, or leave both empty.");
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
    ...(env.SMTP_USER
      ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }
      : {})
  });
  const from = env.MAIL_FROM?.trim() || "Haven Hostel <no-reply@haven-hostel.test>";

  return async ({ to, code }) => transport.sendMail({
    from,
    to,
    subject: "Your Haven Hostel sign-in code",
    text: `Your Haven Hostel verification code is ${code}.\n\nIt expires in five minutes. If you did not try to sign in, you can ignore this email.`
  });
}
