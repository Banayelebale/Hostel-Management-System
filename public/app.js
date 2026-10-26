const message = document.querySelector("#auth-message");
const adminMessage = document.querySelector("#admin-message");
const loginForm = document.querySelector("#login-panel");
const registerForm = document.querySelector("#register-panel");
const otpForm = document.querySelector("#otp-panel");
const signedInPanel = document.querySelector("#signed-in-panel");
const adminPanel = document.querySelector("#admin-panel");
const adminUserList = document.querySelector("#admin-user-list");
const activeUsersTab = document.querySelector("#active-users-tab");
const archivedUsersTab = document.querySelector("#archived-users-tab");
const backupsTab = document.querySelector("#backups-tab");
const adminBackups = document.querySelector("#admin-backups");
const backupList = document.querySelector("#backup-list");
const securityInfo = document.querySelector("#security-info");
const loginTab = document.querySelector("#login-tab");
const registerTab = document.querySelector("#register-tab");
const appNavigation = document.querySelector("#app-navigation");
const dashboardLink = document.querySelector("#dashboard-link");
const reportsLink = document.querySelector("#reports-link");
const adminLink = document.querySelector("#admin-link");
const implementationReportLink = document.querySelector("#implementation-report-link");
const mobileNavigation = document.querySelector("#mobile-navigation");
const mobileDashboardLink = document.querySelector("#mobile-dashboard-link");
const mobileReportsLink = document.querySelector("#mobile-reports-link");
const mobileAdminLink = document.querySelector("#mobile-admin-link");
const operationsDashboard = document.querySelector("#operations-dashboard");
const implementationReportPage = document.querySelector("#implementation-report-page");
const implementationReportContent = document.querySelector("#implementation-report-content");
const implementationReportError = document.querySelector("#implementation-report-error");
const dashboardContent = document.querySelector("#dashboard-content");
const dashboardError = document.querySelector("#dashboard-error");
const dashboardTitle = document.querySelector("#operations-title");
const dashboardEyebrow = operationsDashboard.querySelector(".eyebrow");
const dashboardSubtitle = document.querySelector("#dashboard-subtitle");
let pendingEmail = "";
let dashboardRole = "";

function showMessage(text, isError = false) {
  const target = !document.body.classList.contains("authenticated")
    ? message
    : adminPanel.hidden
      ? dashboardError
      : adminMessage;
  if (!target) return;
  target.textContent = text;
  target.classList.toggle("error", isError);
  target.hidden = false;
}

function requireSignIn(messageText = "Your sign-in session has expired. Please sign in again.") {
  dashboardRole = "";
  if (appNavigation) appNavigation.hidden = true;
  if (mobileNavigation) mobileNavigation.hidden = true;
  if (operationsDashboard) operationsDashboard.hidden = true;
  if (adminPanel) adminPanel.hidden = true;
  if (implementationReportPage) implementationReportPage.hidden = true;
  history.replaceState(null, "", "/");
  showPanel("login");
  showMessage(messageText, true);
}

function hideMessage() {
  if (message) {
    message.textContent = "";
    message.classList.remove("error");
    message.hidden = true;
  }
}

function showPanel(panel) {
  const authenticated = panel === "signed-in" || panel === "admin";
  document.body.classList.toggle("authenticated", authenticated);
  if (loginForm) loginForm.hidden = panel !== "login";
  if (registerForm) registerForm.hidden = panel !== "register";
  if (otpForm) otpForm.hidden = panel !== "otp";
  if (signedInPanel) signedInPanel.hidden = !authenticated;
  if (appNavigation) appNavigation.hidden = !authenticated;
  if (mobileNavigation) mobileNavigation.hidden = !authenticated;
  if (panel === "login" || panel === "register" || panel === "otp") {
    if (operationsDashboard) operationsDashboard.hidden = true;
    if (adminPanel) adminPanel.hidden = true;
  }
  if (loginTab) {
    loginTab.classList.toggle("active", panel === "login" || panel === "otp");
    loginTab.setAttribute("aria-selected", String(panel === "login" || panel === "otp"));
  }
  if (registerTab) {
    registerTab.classList.toggle("active", panel === "register");
    registerTab.setAttribute("aria-selected", String(panel === "register"));
  }
  if (panel !== "otp") hideMessage();
}

async function api(path, data, method = "POST") {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Request failed.");
  return result;
}

function showSignedIn(user, redirect = true) {
  dashboardRole = user.role;
  const nameEl = document.querySelector("#signed-in-name");
  const roleEl = document.querySelector("#signed-in-role");
  if (nameEl) {
    nameEl.dataset.userId = user.id;
    nameEl.textContent = user.username;
  }
  if (roleEl) roleEl.textContent = roleLabel(user.role);

  if (user.role === "main_admin") {
    showPanel("admin");
  } else {
    showPanel("signed-in");
  }

  const isHighRole = ["main_admin", "hall_master", "hall_president"].includes(user.role);
  if (reportsLink) reportsLink.hidden = !isHighRole;
  if (adminLink) adminLink.hidden = user.role !== "main_admin";
  if (implementationReportLink) implementationReportLink.hidden = user.role !== "main_admin";
  if (mobileReportsLink) mobileReportsLink.hidden = !isHighRole;
  if (mobileAdminLink) mobileAdminLink.hidden = user.role !== "main_admin";

  if (redirect) {
    const destination = user.role === "main_admin" ? "/admin" : "/dashboard";
    navigateTo(destination, true);
  } else {
    renderCurrentRoute(true);
  }
}

function navigateTo(path, replace = false) {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  renderCurrentRoute(true);
}

function roleLabel(role) {
  return {
    main_admin: "Main Admin (Porter)",
    hall_master: "Hall Master / Mistress",
    hall_president: "Hall President",
    student: "Student"
  }[role] ?? "Student";
}

// --- FORM EVENT LISTENERS (LOGIN & OTP HANDLERS) ---

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const emailInput = loginForm.querySelector("input[type='email'], input[name='email']");
    const passwordInput = loginForm.querySelector("input[type='password'], input[name='password']");

    const email = emailInput?.value?.trim();
    const password = passwordInput?.value;

    if (!email || !password) {
      showMessage("Please enter both your email address and password.", true);
      return;
    }

    const submitBtn = loginForm.querySelector("button[type='submit']");
    if (submitBtn) submitBtn.disabled = true;

    try {
      hideMessage();
      const result = await api("/api/auth/login", { email, password });
      pendingEmail = email;
      showPanel("otp");
      showMessage(result.message || "Verification code sent. Check your server logs for the 6-digit code.");
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

if (otpForm) {
  // Ensure the code input field allows 6 digits
  const otpInput = otpForm.querySelector("input[name='code'], input[type='text']");
  if (otpInput) {
    otpInput.setAttribute("maxLength", "6");
    otpInput.setAttribute("pattern", "[0-9]{6}");
  }

// --- NAVIGATION LINK CLICK INTERCEPTORS ---
if (dashboardLink) {
  dashboardLink.addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo("/dashboard");
  });
}

if (reportsLink) {
  reportsLink.addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo("/reports");
  });
}

if (adminLink) {
  adminLink.addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo("/admin");
  });
}

if (implementationReportLink) {
  implementationReportLink.addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo("/implementation-report");
  });
}



  otpForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = otpInput?.value?.trim();

    if (!code || code.length !== 6) {
      showMessage("Please enter the full 6-digit verification code.", true);
      return;
    }

    const submitBtn = otpForm.querySelector("button[type='submit']");
    if (submitBtn) submitBtn.disabled = true;

    try {
      hideMessage();
      const result = await api("/api/auth/verify-otp", { email: pendingEmail, code });
      showSignedIn(result.user);
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

async function restoreSession() {
  try {
    const response = await fetch("/api/auth/me");
    const result = await response.json();
    if (!response.ok || !result.user) {
      showPanel("login");
      return;
    }
    showSignedIn(result.user, location.pathname !== "/");
  } catch {
    showPanel("login");
  }
}

restoreSession();
