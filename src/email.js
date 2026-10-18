import nodemailer from "nodemailer";

export function createOtpEmailSender(env = process.env) {
  if (!env.SMTP_HOST) return null;

  const port = Number(env.SMTP_PORT ?? 1025);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid port number.");
  }
  const secureSetting = env.SMTP_SECURE ?? "false";
  if (!["true", "false"].includes(secureSetting.toLowerCase())) {
    throw new Error("SMTP_SECURE must be true or false.");
  }
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) {
    throw new Error("Configure both SMTP_USER and SMTP_PASSWORD, or leave both empty.");
  }

  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: secureSetting.toLowerCase() === "true",
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
    ...(env.SMTP_USER
      ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }
      : {})
  });
  const from = env.MAIL_FROM ?? "Haven Hostel <no-reply@haven-hostel.test>";

  return async ({ to, code }) => transport.sendMail({
    from,
    to,
    subject: "Your Haven Hostel sign-in code",
    text: `Your Haven Hostel verification code is ${code}.\n\nIt expires in five minutes. If you did not try to sign in, you can ignore this email.`
  });
}
