import nodemailer from "nodemailer";

export function createOtpEmailSender(env = process.env, fetchImpl = globalThis.fetch) {
  const resendApiKey = env.RESEND_API_KEY?.trim();
  const from = env.MAIL_FROM?.trim() || "Haven Hostel <no-reply@haven-hostel.test>";

  if (resendApiKey) {
    return async ({ to, code }) => {
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject: "Your Haven Hostel sign-in code",
          text: `Your Haven Hostel verification code is ${code}.\n\nIt expires in five minutes. If you did not try to sign in, you can ignore this email.`
        }),
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`Resend email API returned HTTP ${response.status}: ${responseText.slice(0, 300)}`);
      }
    };
  }

  const host = env.SMTP_HOST?.trim();
  if (host) {
    const configuredPort = env.SMTP_PORT?.trim();
    const port = Number(configuredPort || 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("SMTP_PORT must be a number from 1 to 65535 (usually 587 or 465).");
    }
    const secureSetting = env.SMTP_SECURE?.trim().toLowerCase();
    const secureValues = new Map([
      ["true", true], ["1", true], ["yes", true], ["ssl", true], ["smtps", true],
      ["false", false], ["0", false], ["no", false], ["tls", false], ["starttls", false],
      ["plain", false], ["none", false]
    ]);
    let secure = port === 465;
    if (secureSetting && secureSetting !== "auto") {
      const configuredSecure = secureValues.get(secureSetting);
      if (configuredSecure !== undefined) {
        secure = configuredSecure;
      }
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
      ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {})
    });

    return async ({ to, code }) => transport.sendMail({
      from,
      to,
      subject: "Your Haven Hostel sign-in code",
      text: `Your Haven Hostel verification code is ${code}.\n\nIt expires in five minutes. If you did not try to sign in, you can ignore this email.`
    });
  }

  // --- FALLBACK: LOG OTP TO RENDER CONSOLE (Bypasses SMTP & API blocks) ---
  console.warn("⚠️ No SMTP or Resend API key configured. Falling back to Console OTP mode.");
  return async ({ to, code }) => {
    console.log("\n========================================");
    console.log(`🔑 [DEV/DEMO OTP for ${to}]: ${code}`);
    console.log("========================================\n");
  };
}
