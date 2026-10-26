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
  appNavigation.hidden = true;
  mobileNavigation.hidden = true;
  operationsDashboard.hidden = true;
  adminPanel.hidden = true;
  implementationReportPage.hidden = true;
  history.replaceState(null, "", "/");
  showPanel("login");
  showMessage(messageText, true);
}

function hideMessage() {
  message.textContent = "";
  message.classList.remove("error");
  message.hidden = true;
}

function showPanel(panel) {
  const authenticated = panel === "signed-in" || panel === "admin";
  document.body.classList.toggle("authenticated", authenticated);
  loginForm.hidden = panel !== "login";
  registerForm.hidden = panel !== "register";
  otpForm.hidden = panel !== "otp";
  signedInPanel.hidden = !authenticated;
  appNavigation.hidden = !authenticated;
  mobileNavigation.hidden = !authenticated;
  if (panel === "login" || panel === "register" || panel === "otp") {
    operationsDashboard.hidden = true;
    adminPanel.hidden = true;
  }
  loginTab.classList.toggle("active", panel === "login" || panel === "otp");
  registerTab.classList.toggle("active", panel === "register");
  loginTab.setAttribute("aria-selected", String(panel === "login" || panel === "otp"));
  registerTab.setAttribute("aria-selected", String(panel === "register"));
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
  document.querySelector("#signed-in-name").dataset.userId = user.id;
  document.querySelector("#signed-in-name").textContent = user.username;
  document.querySelector("#signed-in-role").textContent = roleLabel(user.role);
  if (user.role === "main_admin") {
    showPanel("admin");
  } else {
    showPanel("signed-in");
  }
  reportsLink.hidden = !["main_admin", "hall_master", "hall_president"].includes(user.role);
  adminLink.hidden = user.role !== "main_admin";
  implementationReportLink.hidden = user.role !== "main_admin";
  mobileReportsLink.hidden = !["main_admin", "hall_master", "hall_president"].includes(user.role);
  mobileAdminLink.hidden = user.role !== "main_admin";
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

function renderCurrentRoute(redirectInvalid = false) {
  const home = dashboardRole === "main_admin" ? "/admin" : "/dashboard";
  let route = location.pathname;
  const isValidRoute =
    route === "/dashboard" ||
    (route === "/reports" && ["main_admin", "hall_master", "hall_president"].includes(dashboardRole)) ||
    (route === "/admin" && dashboardRole === "main_admin") ||
    (route === "/implementation-report" && dashboardRole === "main_admin");
  if (!isValidRoute) {
    if (!redirectInvalid) return;
    route = home;
    history.replaceState(null, "", route);
  }

  const isAdmin = route === "/admin";
  const isReports = route === "/reports";
  const isImplementationReport = route === "/implementation-report";
  const reportParams = isReports ? new URLSearchParams(location.search) : null;
  const requestedReportView = reportParams?.get("view") ?? null;
  const allowedReportViews = new Set(["checkins", "checkouts", "pending", "monthly-value"]);
  const reportView = allowedReportViews.has(requestedReportView) ? requestedReportView : null;
  const requestedReportRoomId = Number(reportParams?.get("room"));
  const reportRoomId = Number.isSafeInteger(requestedReportRoomId) && requestedReportRoomId > 0
    ? requestedReportRoomId
    : null;
  const dashboardView = route === "/dashboard" ? new URLSearchParams(location.search).get("view") : null;
  const requestedRoomId = route === "/dashboard" ? Number(new URLSearchParams(location.search).get("room")) : NaN;
  const dashboardRoomId = Number.isSafeInteger(requestedRoomId) && requestedRoomId > 0 ? requestedRoomId : null;
  const allowedDashboardViews = new Set(["residents", "occupancy", "pending", "monthly-value"]);
  const dashboardDetailView = allowedDashboardViews.has(dashboardView) ? dashboardView : null;
  operationsDashboard.hidden = isAdmin || isImplementationReport;
  adminPanel.hidden = !isAdmin;
  implementationReportPage.hidden = !isImplementationReport;
  dashboardLink.setAttribute("aria-current", route === "/dashboard" ? "page" : "false");
  reportsLink.setAttribute("aria-current", isReports ? "page" : "false");
  adminLink.setAttribute("aria-current", isAdmin ? "page" : "false");
  implementationReportLink.setAttribute("aria-current", isImplementationReport ? "page" : "false");
  mobileDashboardLink.setAttribute("aria-current", route === "/dashboard" ? "page" : "false");
  mobileReportsLink.setAttribute("aria-current", isReports ? "page" : "false");
  mobileAdminLink.setAttribute("aria-current", isAdmin ? "page" : "false");

  if (isAdmin) {
    loadAdminUsers("active");
    return;
  }
  if (isImplementationReport) {
    loadImplementationReport();
    return;
  }
  dashboardTitle.textContent = isReports
    ? reportRoomId
      ? "Report room details"
      : ({
          checkins: "Check-in report",
          checkouts: "Check-out report",
          pending: "Pending report",
          "monthly-value": "Monthly room value report"
        }[reportView] ?? "Hostel reports")
    : dashboardRoomId
      ? dashboardDetailView === "monthly-value" ? "Room value details" : "Room residents"
      : dashboardDetailView ? "Hostel dashboard details" : "Hostel dashboard";
  dashboardEyebrow.textContent = isReports ? "HOSTEL REPORTS" : "LIVE HOSTEL OPERATIONS";
  dashboardError.hidden = true;
  dashboardContent.replaceChildren();
  if (isReports) loadReports(reportView, reportRoomId);
  else loadDashboard(dashboardDetailView, dashboardRoomId);
}

function textElement(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = value;
  return element;
}

async function loadDashboard(view = null, roomId = null) {
  dashboardError.hidden = true;
  dashboardContent.replaceChildren(textElement("p", "dashboard-loading", "Loading hostel information…"));
  try {
    const response = await fetch("/api/dashboard");
    const result = await response.json();
    if (response.status === 401) {
      requireSignIn();
      return;
    }
    if (!response.ok) throw new Error(result.error ?? "Could not load the dashboard.");
    dashboardContent.replaceChildren();
    dashboardRole = result.role;
    dashboardSubtitle.textContent = `${roleLabel(dashboardRole)} access`;
    if (result.role === "student") {
      dashboardContent.append(renderStudentRegistration(result.registration, result.email));
      return;
    }
    if (roomId && ["residents", "monthly-value"].includes(view)) {
      const response = await fetch(`/api/rooms/${roomId}`);
      const roomResult = await response.json();
      if (response.status === 401) {
        requireSignIn();
        return;
      }
      if (!response.ok) throw new Error(roomResult.error ?? "Could not load this room.");
      dashboardContent.append(view === "monthly-value"
        ? renderMonthlyValueRoomDetail(roomResult, result)
        : renderRoomDirectoryDetail(roomResult, result));
    } else if (view && ["residents", "occupancy", "pending", "monthly-value"].includes(view)) {
      dashboardContent.append(renderDashboardDetail(view, result));
    } else {
      dashboardContent.append(renderOperationsDashboard(result));
    }
  } catch (error) {
    dashboardContent.replaceChildren();
    dashboardError.textContent = error.message;
    dashboardError.hidden = false;
  }
}

function roleLabel(role) {
  return {
    main_admin: "Main Admin (Porter)",
    hall_master: "Hall Master / Mistress",
    hall_president: "Hall President",
    student: "Student"
  }[role] ?? "Student";
}

function renderStudentRegistration(registration) {
  const card = document.createElement("article");
  card.className = "student-record";
  card.append(textElement("p", "card-kicker", "YOUR HOSTEL REGISTRATION"));
  if (!registration || registration.status === "checked_out") {
    card.append(textElement("h3", "", registration ? "Apply for another Haven Hall stay" : "Register for Haven Hall"));
    card.append(textElement(
      "p",
      "dashboard-subtitle",
      "Apply to Haven Hall here. Your registration will be sent to the hostel office as pending; staff will assign your room."
    ));
    const form = document.createElement("form");
    form.className = "resident-registration-form";
    const name = createLabeledInput("Full name", "studentName", "text", true);
    const phone = createLabeledInput("Phone number", "phone", "tel", false);
    const genderLabel = document.createElement("label");
    genderLabel.textContent = "Room group";
    const gender = document.createElement("select");
    gender.name = "gender";
    gender.required = true;
    for (const [value, label] of [["", "Choose one"], ["female", "Female"], ["male", "Male"], ["other", "Other"], ["prefer_not_to_say", "Prefer not to say"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      gender.append(option);
    }
    const emergencyName = createLabeledInput("Emergency contact name", "emergencyContactName", "text", false);
    const emergencyPhone = createLabeledInput("Emergency contact phone", "emergencyContactPhone", "tel", false);
    const notesLabel = document.createElement("label");
    notesLabel.textContent = "Additional information (optional)";
    const notes = document.createElement("textarea");
    notes.name = "notes";
    notes.maxLength = 1000;
    form.append(name.label, name.input, phone.label, phone.input, genderLabel, gender,
      emergencyName.label, emergencyName.input, emergencyPhone.label, emergencyPhone.input,
      notesLabel, notes);
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "button button-primary auth-submit";
    submit.textContent = "Register for Haven Hall";
    form.append(submit);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      try {
        const result = await api("/api/registrations", Object.fromEntries(new FormData(form)));
        dashboardError.textContent = result.message;
        dashboardError.classList.remove("error");
        dashboardError.hidden = false;
        await loadDashboard();
      } catch (error) {
        dashboardError.textContent = error.message;
        dashboardError.hidden = false;
      } finally {
        submit.disabled = false;
      }
    });
    card.append(form);
    return card;
  }
  card.append(textElement("h3", "", registration.student_name));
  const details = document.createElement("div");
  details.className = "student-record-details";
  details.append(
    textElement("span", "", `Status: ${registration.status.replace("_", " ")}`),
    textElement("span", "", `Room: ${registration.room_number ?? "Not assigned"}`),
    textElement("span", "", `Hall: ${registration.hall_name ?? "Haven Hall"}`),
    textElement("span", "", `Gender: ${registration.gender ?? "Not provided"}`),
    textElement("span", "", `Check-in: ${formatDate(registration.check_in_at)}`),
    textElement("span", "", `Check-out: ${formatDate(registration.check_out_at)}`)
  );
  if (registration.student_phone) details.append(textElement("span", "", `Phone: ${registration.student_phone}`));
  if (registration.emergency_contact_name) {
    details.append(textElement("span", "", `Emergency contact: ${registration.emergency_contact_name} ${registration.emergency_contact_phone ?? ""}`));
  }
  if (registration.notes) details.append(textElement("span", "", `Additional information: ${registration.notes}`));
  card.append(details);
  return card;
}

function createLabeledInput(labelText, name, type, required) {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.name = name;
  input.type = type;
  input.required = required;
  input.maxLength = type === "tel" ? 40 : 100;
  return { label, input };
}

function renderDashboardDetail(view, data) {
  const titles = {
    residents: "Current residents",
    occupancy: "Occupancy details",
    pending: "Pending check-ins",
    "monthly-value": "Estimated monthly room value"
  };
  const container = document.createElement("section");
  container.className = "dashboard-detail-page";
  const heading = document.createElement("div");
  heading.className = "dashboard-detail-heading";
  heading.append(
    textElement("h3", "dashboard-card-title", titles[view]),
    textElement("p", "dashboard-subtitle", "Detailed information from the current hostel dashboard.")
  );
  const back = document.createElement("button");
  back.type = "button";
  back.className = "button button-primary dashboard-back";
  back.textContent = "Back to hostel dashboard";
  back.addEventListener("click", () => navigateTo("/dashboard"));
  container.append(heading, back);

  if (view === "residents") {
    container.append(textElement("p", "dashboard-subtitle detail-summary", `${data.residents.length} current resident(s) · ${data.stats.available_beds} beds available`));
    container.append(textElement("h4", "dashboard-card-title", "Choose a room to view its residents"));
    const roomGrid = document.createElement("div");
    roomGrid.className = "resident-room-grid";
    for (const [index, room] of data.rooms.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "resident-room-button";
      button.append(
        textElement("strong", "", `Room ${index + 1}`),
        textElement("span", "", room.room_number),
        textElement("small", "", `${room.occupied}/${room.capacity} occupied · ${room.available} free`)
      );
      button.addEventListener("click", () => {
        navigateTo(`/dashboard?view=residents&room=${room.id}`);
      });
      roomGrid.append(button);
    }
    container.append(roomGrid);
  } else if (view === "occupancy") {
    const metrics = document.createElement("div");
    metrics.className = "metric-grid detail-metrics";
    metrics.append(
      metricCard("Occupancy", `${data.stats.occupancy_percent}%`, `${data.stats.checked_in} of ${data.stats.total_capacity} beds used`),
      metricCard("Beds unused", data.stats.available_beds, `${data.stats.rooms_with_vacancies} rooms have space`),
      metricCard("Vacant rooms", data.stats.vacant_rooms, `${data.stats.active_rooms} active rooms`)
    );
    container.append(metrics);
    const residentSection = document.createElement("article");
    residentSection.className = "dashboard-card detail-record";
    residentSection.append(textElement("h4", "dashboard-card-title", "Residents counted in occupancy"));
    if (!data.residents.length) residentSection.append(textElement("p", "admin-empty", "No residents are currently occupying beds."));
    for (const resident of data.residents) {
      const row = document.createElement("div");
      row.className = "report-row";
      row.append(
        textElement("strong", "", resident.student_name),
        textElement("span", "", `Room ${resident.room_number ?? "unassigned"} · ${resident.student_email}`)
      );
      residentSection.append(row);
    }
    const roomsSection = document.createElement("article");
    roomsSection.className = "dashboard-card detail-record";
    roomsSection.append(textElement("h4", "dashboard-card-title", "Room-by-room beds used and available"));
    for (const room of data.rooms) {
      const row = document.createElement("div");
      row.className = "report-row";
      row.append(
        textElement("strong", "", `Room ${room.room_number}`),
        textElement("span", "", `${room.occupied}/${room.capacity} used · ${room.available} unused · ${room.gender}`)
      );
      roomsSection.append(row);
    }
    container.append(residentSection, roomsSection);
  } else if (view === "pending") {
    container.append(textElement("p", "dashboard-subtitle detail-summary", `${data.pending.length} student(s) pending out of ${data.stats.total_registrations} total registrations.`));
    if (!data.pending.length) container.append(textElement("p", "admin-empty", "There are no pending registrations."));
    for (const resident of data.pending) {
      const card = document.createElement("article");
      card.className = "dashboard-card detail-record";
      card.append(textElement("h4", "dashboard-card-title", resident.student_name));
      appendResidentDetails(card, resident);
      if (!data.readOnly) {
        const controls = document.createElement("div");
        controls.className = "resident-actions detail-actions";
        const roomSelect = document.createElement("select");
        roomSelect.setAttribute("aria-label", `Choose a room for ${resident.student_name}`);
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Choose an available room";
        roomSelect.append(placeholder);
        for (const room of data.rooms) {
          if (room.available <= 0) continue;
          if (["male", "female"].includes(resident.gender) && room.gender !== resident.gender) continue;
          const option = document.createElement("option");
          option.value = String(room.id);
          option.textContent = `${room.room_number} · ${room.occupied}/${room.capacity} occupied · ${room.available} free`;
          roomSelect.append(option);
        }
        const assign = document.createElement("button");
        assign.type = "button";
        assign.className = "admin-action";
        assign.textContent = "Assign room and check in";
        assign.addEventListener("click", async () => {
          if (!roomSelect.value) {
            dashboardError.textContent = "Select a room before checking in this student.";
            dashboardError.hidden = false;
            return;
          }
          assign.disabled = true;
          try {
            await api(`/api/registrations/${resident.id}/room`, { roomId: Number(roomSelect.value) }, "PATCH");
            const result = await api(`/api/registrations/${resident.id}/check-in`, {});
            showMessage(result.message);
            await loadDashboard("pending");
          } catch (error) {
            dashboardError.textContent = error.message;
            dashboardError.hidden = false;
          } finally {
            assign.disabled = false;
          }
        });
        controls.append(roomSelect, assign);
        card.append(controls);
      }
      container.append(card);
    }
  } else {
    const occupiedRooms = data.rooms.filter((room) => room.occupied > 0);
    const metrics = document.createElement("div");
    metrics.className = "metric-grid detail-metrics";
    metrics.append(metricCard("Estimated monthly value", formatMoney(data.stats.estimated_monthly_room_value_cents), "Adds the full monthly rate once for each occupied room."));
    container.append(
      metrics,
      textElement("p", "dashboard-subtitle detail-summary", `The total is the sum of the listed monthly room rates for ${occupiedRooms.length} room(s) with at least one checked-in resident. It is not calculated per student or per bed; empty rooms contribute 0. The display uses generic units because no currency is configured.`),
      textElement("h4", "dashboard-card-title", "Choose a room to view its monthly value details")
    );
    const roomGrid = document.createElement("div");
    roomGrid.className = "resident-room-grid";
    for (const [index, room] of data.rooms.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "resident-room-button";
      button.append(
        textElement("strong", "", `Room ${index + 1}`),
        textElement("span", "", room.room_number),
        textElement("small", "", room.occupied > 0
          ? `${formatMoney(room.monthly_rate_cents)} per month · included`
          : "0 units · vacant, not included")
      );
      button.addEventListener("click", () => navigateTo(`/dashboard?view=monthly-value&room=${room.id}`));
      roomGrid.append(button);
    }
    container.append(roomGrid);
  }
  return container;
}

function renderMonthlyValueRoomDetail(roomResult, dashboard) {
  const { room, residents } = roomResult;
  const container = document.createElement("section");
  container.className = "dashboard-detail-page";
  const ordinal = dashboard.rooms.findIndex((item) => item.id === room.id) + 1;
  const contributes = room.occupied > 0;
  const heading = document.createElement("div");
  heading.className = "dashboard-detail-heading";
  heading.append(
    textElement("h3", "dashboard-card-title", `Room ${ordinal || room.room_number} · ${room.room_number}`),
    textElement("p", "dashboard-subtitle", contributes
      ? `${formatMoney(room.monthly_rate_cents)} monthly rate · included once in the estimate because this room is occupied.`
      : "Vacant room · contributes 0 to the current estimated monthly value.")
  );
  const back = document.createElement("button");
  back.type = "button";
  back.className = "button button-primary dashboard-back";
  back.textContent = "Back to room values";
  back.addEventListener("click", () => navigateTo("/dashboard?view=monthly-value"));
  container.append(heading, back);

  const details = document.createElement("article");
  details.className = "dashboard-card detail-record";
  details.append(
    textElement("h4", "dashboard-card-title", contributes ? "Room value contribution" : "Room value contribution"),
    textElement("p", "dashboard-subtitle", `Monthly room rate: ${formatMoney(room.monthly_rate_cents)}`),
    textElement("p", "dashboard-subtitle", `Beds occupied: ${room.occupied} of ${room.capacity} · ${Math.max(0, room.capacity - room.occupied)} available`),
    textElement("p", "dashboard-subtitle", `Estimate contribution: ${formatMoney(contributes ? room.monthly_rate_cents : 0)}`)
  );
  const roomResidents = residents.filter((resident) => resident.status === "checked_in");
  details.append(textElement("h4", "dashboard-card-title", `Residents in this room (${roomResidents.length})`));
  if (!roomResidents.length) details.append(textElement("p", "admin-empty", "No current residents; this room is excluded from the estimate."));
  for (const resident of roomResidents) {
    const row = document.createElement("div");
    row.className = "report-row";
    row.append(textElement("strong", "", resident.student_name), textElement("span", "", resident.student_email));
    details.append(row);
  }
  container.append(details);
  return container;
}

function renderRoomDirectoryDetail(roomResult, dashboard) {
  const { room } = roomResult;
  const container = document.createElement("section");
  container.className = "dashboard-detail-page";
  const ordinal = dashboard.rooms.findIndex((item) => item.id === room.id) + 1;
  const heading = document.createElement("div");
  heading.className = "dashboard-detail-heading";
  heading.append(
    textElement("h3", "dashboard-card-title", `Room ${ordinal || room.room_number} · ${room.room_number}`),
    textElement("p", "dashboard-subtitle", `${room.occupied}/${room.capacity} beds occupied · ${Math.max(0, room.capacity - room.occupied)} available · ${room.gender} room`)
  );
  const back = document.createElement("button");
  back.type = "button";
  back.className = "button button-primary dashboard-back";
  back.textContent = "Back to all rooms";
  back.addEventListener("click", () => navigateTo("/dashboard?view=residents"));
  container.append(heading, back);

  const occupants = roomResult.residents.filter((resident) => resident.status === "checked_in");
  const residentList = document.createElement("article");
  residentList.className = "dashboard-card detail-record";
  residentList.append(textElement("h4", "dashboard-card-title", `Current residents (${occupants.length})`));
  if (!occupants.length) residentList.append(textElement("p", "admin-empty", "No students currently live in this room."));
  for (const resident of occupants) {
    const card = document.createElement("section");
    card.className = "room-resident";
    card.append(textElement("h5", "", resident.student_name));
    appendResidentDetails(card, resident);
    if (!dashboard.readOnly) {
      const controls = document.createElement("div");
      controls.className = "resident-actions detail-actions";
      const destination = document.createElement("select");
      destination.setAttribute("aria-label", `Move ${resident.student_name} to another room`);
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Choose another room";
      destination.append(placeholder);
      for (const target of dashboard.rooms) {
        if (target.id === room.id || target.available <= 0) continue;
        if (["male", "female"].includes(resident.gender) && target.gender !== resident.gender) continue;
        const option = document.createElement("option");
        option.value = String(target.id);
        option.textContent = `Room ${target.room_number} · ${target.occupied}/${target.capacity} occupied`;
        destination.append(option);
      }
      const move = document.createElement("button");
      move.type = "button";
      move.className = "admin-action";
      move.textContent = "Move resident";
      move.addEventListener("click", async () => {
        if (!destination.value) {
          dashboardError.textContent = "Choose another available room first.";
          dashboardError.hidden = false;
          return;
        }
        move.disabled = true;
        try {
          const result = await api(`/api/registrations/${resident.id}/room`, { roomId: Number(destination.value) }, "PATCH");
          showMessage(result.message);
          await loadDashboard("residents", room.id);
        } catch (error) {
          dashboardError.textContent = error.message;
          dashboardError.hidden = false;
        } finally {
          move.disabled = false;
        }
      });
      controls.append(destination, move);
      card.append(controls);
    }
    residentList.append(card);
  }
  container.append(residentList);

  if (!dashboard.readOnly && room.occupied < room.capacity) {
    const availableStudents = dashboard.pending.filter((resident) =>
      !["male", "female"].includes(resident.gender) || resident.gender === room.gender
    );
    const assignCard = document.createElement("article");
    assignCard.className = "dashboard-card detail-record";
    assignCard.append(textElement("h4", "dashboard-card-title", "Add a pending student to this room"));
    assignCard.append(textElement("p", "dashboard-subtitle", `${room.capacity - room.occupied} bed(s) available.`));
    if (!availableStudents.length) {
      assignCard.append(textElement("p", "admin-empty", "There are no pending students compatible with this room."));
    } else {
      const controls = document.createElement("div");
      controls.className = "resident-actions detail-actions";
      const select = document.createElement("select");
      select.setAttribute("aria-label", "Choose a pending student");
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Choose a pending student";
      select.append(placeholder);
      for (const student of availableStudents) {
        const option = document.createElement("option");
        option.value = String(student.id);
        option.textContent = `${student.student_name} · ${student.gender ?? "gender not specified"}`;
        select.append(option);
      }
      const add = document.createElement("button");
      add.type = "button";
      add.className = "admin-action";
      add.textContent = "Add and check in";
      add.addEventListener("click", async () => {
        if (!select.value) {
          dashboardError.textContent = "Choose a pending student to add to this room.";
          dashboardError.hidden = false;
          return;
        }
        add.disabled = true;
        try {
          await api(`/api/registrations/${Number(select.value)}/room`, { roomId: room.id }, "PATCH");
          const result = await api(`/api/registrations/${Number(select.value)}/check-in`, {});
          showMessage(result.message);
          await loadDashboard("residents", room.id);
        } catch (error) {
          dashboardError.textContent = error.message;
          dashboardError.hidden = false;
        } finally {
          add.disabled = false;
        }
      });
      controls.append(select, add);
      assignCard.append(controls);
    }
    container.append(assignCard);
  }
  return container;
}

function appendResidentDetails(container, resident) {
  const details = document.createElement("div");
  details.className = "student-record-details";
  const values = [
    ["Email", resident.student_email],
    ["Phone", resident.student_phone],
    ["Status", resident.status?.replaceAll("_", " ")],
    ["Room", resident.room_number ?? "Not assigned"],
    ["Hall", resident.hall_name ?? "Haven Hall"],
    ["Gender", resident.gender],
    ["Registered", formatDate(resident.created_at)],
    ["Check-in", formatDate(resident.check_in_at)],
    ["Check-out", formatDate(resident.check_out_at)],
    ["Emergency contact", resident.emergency_contact_name],
    ["Emergency phone", resident.emergency_contact_phone],
    ["Additional information", resident.notes]
  ];
  for (const [label, value] of values) {
    if (value) details.append(textElement("span", "", `${label}: ${value}`));
  }
  container.append(details);
}

function renderOperationsDashboard(data) {
  const fragment = document.createDocumentFragment();
  const stats = data.stats;
  const canManage = !data.readOnly;
  const cards = document.createElement("div");
  cards.className = "metric-grid";
  const cardsData = [
    ["Current residents", stats.checked_in, `${stats.available_beds} beds available · click to view`, "residents"],
    ["Occupancy", `${stats.occupancy_percent}%`, `${stats.checked_in} of ${stats.total_capacity} beds · ${stats.available_beds} unused`, "occupancy"],
    ["Pending check-ins", stats.pending, `${stats.total_registrations} registrations total · click to view`, "pending"],
    ["Est. monthly room value", formatMoney(stats.estimated_monthly_room_value_cents), `${stats.vacant_rooms} vacant rooms · ${stats.rooms_with_vacancies} rooms with space`, "monthly-value"]
  ];
  for (const [label, value, detail, view] of cardsData) {
    const card = metricCard(label, value, detail);
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `${label}: ${value}. Open details`);
    card.addEventListener("click", () => navigateTo(`/dashboard?view=${view}`));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        card.click();
      }
    });
    cards.append(card);
  }
  fragment.append(cards);

  const columns = document.createElement("div");
  columns.className = "dashboard-columns";
  const roomCard = document.createElement("article");
  roomCard.className = "dashboard-card";
  roomCard.append(textElement("h3", "dashboard-card-title", `Room occupancy · ${stats.active_rooms} active rooms`));
  roomCard.append(textElement("p", "dashboard-subtitle", `${stats.vacant_rooms} vacant rooms · ${stats.rooms_with_vacancies} rooms with available beds. Select a room to see its residents.`));
  const roomList = document.createElement("div");
  roomList.className = "room-list";
  for (const room of data.rooms) {
    const row = document.createElement("div");
    row.className = "room-row";
    const label = document.createElement("button");
    label.type = "button";
    label.className = "room-link";
    label.textContent = room.room_number;
    const bar = document.createElement("span");
    bar.className = "room-meter";
    const fill = document.createElement("span");
    fill.style.width = `${Math.min(100, Math.round((room.occupied / room.capacity) * 100))}%`;
    bar.append(fill);
    row.append(label, bar, textElement("small", "", `${room.occupied}/${room.capacity} · ${room.available} free · ${room.gender ?? "all"}`));
    label.addEventListener("click", async () => {
      try {
        const response = await fetch(`/api/rooms/${room.id}`);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not load this room.");
        dashboardContent.querySelector("#room-details")?.remove();
        const detail = renderRoomDetails(result, data, canManage);
        dashboardContent.append(detail);
      } catch (error) {
        dashboardError.textContent = error.message;
        dashboardError.hidden = false;
      }
    });
    roomList.append(row);
  }
  roomCard.append(roomList);
  const checkinCard = document.createElement("article");
  checkinCard.className = "dashboard-card";
  checkinCard.append(textElement("h3", "dashboard-card-title", "Recent registrations"));
  const recentList = document.createElement("div");
  recentList.className = "recent-list";
  for (const registration of data.recent) {
    const row = document.createElement("div");
    row.className = "recent-row";
    const info = document.createElement("span");
    info.className = "recent-info";
    info.append(
      textElement("strong", "", registration.student_name),
      textElement("small", "", `${registration.status.replace("_", " ")} · Room ${registration.room_number ?? "not assigned"} · ${formatDate(registration.created_at ?? registration.check_in_at ?? registration.check_out_at)}`)
    );
    row.append(info);
    if (canManage && registration.status !== "checked_in") {
      const controls = document.createElement("div");
      controls.className = "resident-actions";
      const roomSelect = document.createElement("select");
      roomSelect.setAttribute("aria-label", `Select room for ${registration.student_name}`);
      const chooseRoom = document.createElement("option");
      chooseRoom.value = "";
      chooseRoom.textContent = "Choose available room";
      roomSelect.append(chooseRoom);
      for (const room of data.rooms) {
        if (registration.gender && ["male", "female"].includes(registration.gender) && room.gender !== registration.gender) continue;
        if (room.available <= 0 && room.id !== registration.room_id) continue;
        const option = document.createElement("option");
        option.value = String(room.id);
        option.textContent = `${room.room_number} · ${room.occupied}/${room.capacity}`;
        option.selected = room.id === registration.room_id;
        roomSelect.append(option);
      }
      const checkIn = document.createElement("button");
      checkIn.type = "button";
      checkIn.className = "admin-action";
      checkIn.textContent = "Assign & check in";
      checkIn.addEventListener("click", async () => {
        if (!roomSelect.value) {
          dashboardError.textContent = "Choose an available room before checking in this student.";
          dashboardError.hidden = false;
          return;
        }
        checkIn.disabled = true;
        try {
          await api(`/api/registrations/${registration.id}/room`, { roomId: Number(roomSelect.value) }, "PATCH");
          const result = await api(`/api/registrations/${registration.id}/check-in`, {});
          showMessage(result.message);
          await loadDashboard();
        } catch (error) {
          dashboardError.textContent = error.message;
          dashboardError.hidden = false;
        } finally {
          checkIn.disabled = false;
        }
      });
      controls.append(roomSelect, checkIn);
      row.append(controls);
    } else if (canManage && registration.status === "checked_in") {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "admin-action";
      action.textContent = "Check out";
      action.addEventListener("click", async () => {
        action.disabled = true;
        try {
          const result = await api(`/api/registrations/${registration.id}/check-out`, {}, "POST");
          showMessage(result.message);
          await loadDashboard();
        } catch (error) {
          dashboardError.textContent = error.message;
          dashboardError.hidden = false;
        } finally {
          action.disabled = false;
        }
      });
      row.append(action);
    }
    recentList.append(row);
  }
  checkinCard.append(recentList);
  columns.append(roomCard, checkinCard);
  fragment.append(columns);
  return fragment;
}

function renderRoomDetails(result, dashboard, canManage) {
  const { room, residents } = result;
  const detail = document.createElement("section");
  detail.className = "dashboard-card";
  detail.id = "room-details";
  detail.append(
    textElement("h3", "dashboard-card-title", `Room ${room.room_number}`),
    textElement("p", "dashboard-subtitle", `${room.occupied}/${room.capacity} beds occupied · ${Math.max(0, room.capacity - room.occupied)} free · ${room.gender ?? "all"} room · ${formatMoney(room.monthly_rate_cents)} monthly`)
  );
  const list = document.createElement("div");
  list.className = "recent-list";
  const roomResidents = residents.filter((resident) => resident.status === "checked_in");
  if (!roomResidents.length) list.append(textElement("p", "dashboard-subtitle", "No current residents."));
  for (const resident of roomResidents) {
    const row = document.createElement("div");
    row.className = "recent-row";
    row.append(textElement("strong", "", resident.student_name), textElement("small", "", `Checked in ${formatDate(resident.check_in_at)}`));
    if (canManage) {
      const controls = document.createElement("div");
      controls.className = "resident-actions";
      const roomSelect = document.createElement("select");
      roomSelect.setAttribute("aria-label", `Move ${resident.student_name} to another room`);
      const chooseRoom = document.createElement("option");
      chooseRoom.value = "";
      chooseRoom.textContent = "Keep in current room";
      roomSelect.append(chooseRoom);
      for (const optionRoom of dashboard.rooms) {
        if (optionRoom.id === room.id || optionRoom.available <= 0) continue;
        if (resident.gender && ["male", "female"].includes(resident.gender) && optionRoom.gender !== resident.gender) continue;
        const option = document.createElement("option");
        option.value = String(optionRoom.id);
        option.textContent = `${optionRoom.room_number} · ${optionRoom.occupied}/${optionRoom.capacity}`;
        roomSelect.append(option);
      }
      const move = document.createElement("button");
      move.type = "button";
      move.className = "admin-action";
      move.textContent = "Move";
      move.addEventListener("click", async () => {
        if (!roomSelect.value) return;
        move.disabled = true;
        try {
          const result = await api(`/api/registrations/${resident.id}/room`, { roomId: Number(roomSelect.value) }, "PATCH");
          showMessage(result.message);
          await loadDashboard();
        } catch (error) {
          dashboardError.textContent = error.message;
          dashboardError.hidden = false;
        } finally {
          move.disabled = false;
        }
      });
      const checkout = document.createElement("button");
      checkout.type = "button";
      checkout.className = "admin-action";
      checkout.textContent = "Check out";
      checkout.addEventListener("click", async () => {
        checkout.disabled = true;
        try {
          const result = await api(`/api/registrations/${resident.id}/check-out`, {}, "POST");
          showMessage(result.message);
          await loadDashboard();
        } catch (error) {
          dashboardError.textContent = error.message;
          dashboardError.hidden = false;
        } finally {
          checkout.disabled = false;
        }
      });
      controls.append(roomSelect, move, checkout);
      row.append(controls);
    }
    list.append(row);
  }
  detail.append(list);
  return detail;
}

function metricCard(label, value, detail) {
  const card = document.createElement("article");
  card.className = "metric-card";
  card.append(textElement("span", "metric-label", label));
  card.append(textElement("strong", "metric-value", String(value)));
  card.append(textElement("small", "metric-detail", detail));
  return card;
}

function formatMoney(cents) {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(cents / 100)} units`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

async function loadReports(view = null, roomId = null) {
  dashboardError.hidden = true;
  dashboardContent.replaceChildren(textElement("p", "dashboard-loading", "Loading reports…"));
  try {
    const response = await fetch("/api/reports");
    const result = await response.json();
    if (response.status === 401) {
      requireSignIn();
      return;
    }
    if (!response.ok) throw new Error(result.error ?? "Could not load reports.");
    dashboardContent.replaceChildren();
    if (view) {
      dashboardContent.append(renderReportDetail(view, result, roomId));
      return;
    }
    const summary = document.createElement("div");
    summary.className = "metric-grid report-summary";
    const pendingCount = result.statusSummary.find((status) => status.status === "pending")?.count ?? 0;
    const reportCards = [
      ["Est. monthly room value", formatMoney(result.estimatedMonthlyRoomValueCents), result.revenueNote, "monthly-value"],
      ["Check-ins", result.checkins.length, "Click to view resident check-in history", "checkins"],
      ["Check-outs", result.checkouts.length, "Click to view resident check-out history", "checkouts"],
      ["Pending", pendingCount, "Click to view students awaiting room allocation", "pending"]
    ];
    for (const [label, value, description, detailView] of reportCards) {
      const card = metricCard(label, value, description);
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `${label}: ${value}. Open report details`);
      card.addEventListener("click", () => navigateTo(`/reports?view=${detailView}`));
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          card.click();
        }
      });
      summary.append(card);
    }
    dashboardContent.append(summary);
    const columns = document.createElement("div");
    columns.className = "dashboard-columns";
    const checkins = document.createElement("article");
    checkins.className = "dashboard-card";
    checkins.append(textElement("h3", "dashboard-card-title", "Check-ins · last 30 days"));
    if (result.checkinActivity.length) {
      for (const activity of result.checkinActivity) {
        const row = document.createElement("div");
        row.className = "report-row";
        row.append(textElement("span", "", formatDate(activity.day)), textElement("strong", "", String(activity.count)));
        checkins.append(row);
      }
    } else {
      checkins.append(textElement("p", "admin-empty", "No check-ins recorded in the last 30 days."));
    }
    const audit = document.createElement("article");
    audit.className = "dashboard-card";
    audit.append(textElement("h3", "dashboard-card-title", "Recent user and system activity"));
    for (const entry of result.audit) {
      const row = document.createElement("div");
      row.className = "report-row report-audit";
      row.append(
        textElement("strong", "", entry.action.replaceAll(".", " ")),
        textElement("small", "", `${entry.actor ?? "System"} · ${formatDate(entry.created_at)}`)
      );
      audit.append(row);
    }
    if (!result.audit.length) audit.append(textElement("p", "admin-empty", "No activity recorded yet."));
    columns.append(checkins, audit);
    dashboardContent.append(columns);
  } catch (error) {
    dashboardError.textContent = error.message;
    dashboardError.hidden = false;
  }
}

function implementationReportSection(title, paragraphs = []) {
  const section = document.createElement("section");
  section.className = "dashboard-card implementation-report-section";
  section.append(textElement("h3", "dashboard-card-title", title));
  for (const paragraph of paragraphs) {
    section.append(textElement("p", "dashboard-subtitle implementation-report-paragraph", paragraph));
  }
  return section;
}

function implementationReportTable(headers, rows, className = "") {
  const table = document.createElement("table");
  table.className = `implementation-report-table ${className}`.trim();
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const value of headers) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = value;
    headRow.append(cell);
  }
  head.append(headRow);
  const body = document.createElement("tbody");
  for (const values of rows) {
    const row = document.createElement("tr");
    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = String(value ?? "—");
      row.append(cell);
    }
    body.append(row);
  }
  table.append(head, body);
  return table;
}

async function loadImplementationReport() {
  implementationReportError.hidden = true;
  implementationReportContent.replaceChildren(textElement("p", "dashboard-loading", "Loading implementation report…"));
  try {
    const [dashboardResponse, reportsResponse, usersResponse, archivedResponse] = await Promise.all([
      fetch("/api/dashboard"),
      fetch("/api/reports"),
      fetch("/api/admin/users"),
      fetch("/api/admin/archived-users")
    ]);
    const [dashboard, reports, users, archived] = await Promise.all([
      dashboardResponse.json(),
      reportsResponse.json(),
      usersResponse.json(),
      archivedResponse.json()
    ]);
    if ([dashboardResponse, reportsResponse, usersResponse, archivedResponse].some((response) => response.status === 401)) {
      requireSignIn();
      return;
    }
    const failed = [
      [dashboardResponse, dashboard],
      [reportsResponse, reports],
      [usersResponse, users],
      [archivedResponse, archived]
    ].find(([response]) => !response.ok);
    if (failed) throw new Error(failed[1].error ?? "Could not load the implementation report.");

    const fragment = document.createDocumentFragment();
    fragment.append(implementationReportSection("Project overview", [
      "Haven is a local-first hostel management application built with Node.js, the native HTTP server, SQLite, HTML, CSS, and browser JavaScript.",
      "The application supports account registration and sign-in, role-based access, Haven Hall registration, room allocation, check-in/check-out, reports, audit events, and encrypted configuration backups."
    ]));

    const stats = dashboard.stats;
    fragment.append(implementationReportSection("Current database summary", [
      `${stats.active_rooms} active rooms with capacity for ${stats.total_capacity} beds.`,
      `${stats.total_registrations} registrations in total: ${stats.checked_in} checked in, ${stats.checked_out} checked out, and ${stats.pending} pending.`,
      `${users.users.length} active user accounts, ${archived.users.length} archived accounts, and ${reports.audit.length} recent audit entries currently displayed (up to 50).`
    ]));

    const activeAccountRows = users.users.map((user) => [
      user.id, user.username, user.email, roleLabel(user.role),
      user.requested_role ? `Requested: ${roleLabel(user.requested_role)}` : "—"
    ]);
    const activeAccounts = implementationReportSection("Active account directory");
    activeAccounts.append(implementationReportTable(
      ["ID", "Username", "Email", "Role", "Role request"],
      activeAccountRows
    ));
    fragment.append(activeAccounts);

    fragment.append(implementationReportSection("Database and records", [
      "SQLite stores users, archived users, login sessions, OTP challenges, rooms, hostel registrations, system settings, and audit logs.",
      "The local database path is data/hostel.sqlite. Account identities use case-insensitive uniqueness constraints; hostel registrations remain separate from user-account lifecycle operations."
    ]));

    fragment.append(implementationReportSection("Authentication and password security", [
      "Passwords are not stored as plain text. Node.js Argon2id hashes each password using a fresh 16-byte random per-user salt and the server-side AUTH_PEPPER secret. Current parameters: 32-byte output, two passes, one lane, and 19,456 KiB memory.",
      "The pepper is loaded from the environment and must contain at least 32 bytes. Hashes, salts, and the pepper are intentionally not displayed in the report or account directory.",
      "Sign-in uses a five-minute, attempt-limited OTP step. When SMTP is configured, codes are emailed; otherwise the local development demo can display them on screen and in the server terminal. Session tokens are stored hashed and expire after eight hours."
    ]));

    const roleRows = [
      ["Main Admin (Porter)", "Manage non-admin accounts, backups, and all hostel operations."],
      ["Hall Master / Mistress", "Manage room allocation, resident moves, check-in, and check-out."],
      ["Hall President", "View operations and reports."],
      ["Student", "Submit and view their own Haven Hall registration."]
    ];
    const roleSection = implementationReportSection("Authorization and role management");
    roleSection.append(implementationReportTable(["Role", "Permissions"], roleRows));
    roleSection.append(textElement("p", "dashboard-subtitle implementation-report-paragraph",
      "Permissions are enforced on backend routes as well as reflected in the interface. Main Admin accounts are protected from role changes, edits, archive, and permanent deletion."));
    fragment.append(roleSection);

    fragment.append(implementationReportSection("Hostel operations and reports", [
      "Student registrations remain pending until staff assign a compatible room and check the student in. Server-side checks enforce room capacity and gender compatibility.",
      "Dashboard and reports show residents, vacancies, bed occupancy, pending registrations, check-ins, check-outs, and estimated monthly room value. Monthly room value sums the full rate once per occupied room; it is not collected revenue.",
      "Room directories and report pages support room-level details. Resident moves, check-ins, check-outs, and other operational changes are audited."
    ]));

    fragment.append(implementationReportSection("Archive, delete, and restore", [
      "Archive moves the account into the recoverable archive. Restore rejects active username or email conflicts. These operations preserve room and hostel registration records and are audited.",
      "Permanent deletion removes a non-Main-Admin account and its authentication sessions, but preserves hostel registration and room data. Main Admin accounts and the signed-in account are protected from deletion."
    ]));

    fragment.append(implementationReportSection("Backup and restore", [
      "The Backups panel creates AES-256-GCM encrypted local snapshots containing active user roles and system settings. Restore changes configuration only; rooms and hostel registrations are not included.",
      "These are not full database backups. AWS/S3 upload, off-site retention, and automated database backup/restore are not implemented. The backup encryption key must be kept securely outside the application."
    ]));

    fragment.append(implementationReportSection("Security measures and limitations", [
      "The server uses security headers, same-origin checks for state-changing requests, input validation, authentication rate limits, and an explicit static-file allowlist. Payment card data is not collected.",
      "The current project uses local SQLite. Deployment requires persistent storage or a managed database. Configure a production email provider and durable database backups before storing real student data."
    ]));

    const verification = implementationReportSection("Verification");
    verification.append(textElement("p", "dashboard-subtitle implementation-report-paragraph",
      "Automated tests are run with npm test. The latest recorded validation passed 21 tests covering authentication, OTP, role enforcement, protected Main Admin accounts, archive/restore/delete, configuration backup invariants, room rules, and hostel operations."));
    verification.append(textElement("p", "implementation-report-meta", `Generated from current data on ${new Date().toLocaleString()}.`));
    fragment.append(verification);
    implementationReportContent.replaceChildren(fragment);
  } catch (error) {
    implementationReportContent.replaceChildren();
    implementationReportError.textContent = error.message;
    implementationReportError.hidden = false;
  }
}

async function loadAdminUsers(list = "active") {
  try {
    const backupView = list === "backups";
    adminBackups.hidden = !backupView;
    adminUserList.hidden = backupView;
    const archived = list === "archived";
    activeUsersTab.classList.toggle("active", !archived && !backupView);
    archivedUsersTab.classList.toggle("active", archived);
    backupsTab.classList.toggle("active", backupView);
    activeUsersTab.setAttribute("aria-selected", String(!archived && !backupView));
    archivedUsersTab.setAttribute("aria-selected", String(archived));
    backupsTab.setAttribute("aria-selected", String(backupView));
    if (backupView) {
      await loadBackups();
      return;
    }
    const response = await fetch(archived ? "/api/admin/archived-users" : "/api/admin/users");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not load users.");
    adminUserList.replaceChildren();
    if (result.users.length === 0) {
      const empty = document.createElement("p");
      empty.className = "admin-empty";
      empty.textContent = archived ? "No archived accounts." : "No active accounts.";
      adminUserList.append(empty);
      return;
    }
    const tableWrap = document.createElement("div");
    tableWrap.className = "admin-user-table-wrap";
    const table = document.createElement("table");
    table.className = "admin-user-table";
    table.dataset.view = archived ? "archived" : "active";
    table.setAttribute("aria-label", archived ? "Archived user accounts" : "Active user accounts");
    const columnGroup = document.createElement("colgroup");
    const columnWidths = archived
      ? ["6%", "20%", "30%", "14%", "15%", "15%"]
      : ["5%", "14%", "23%", "12%", "21%", "9%", "8%", "8%"];
    for (const width of columnWidths) {
      const column = document.createElement("col");
      column.style.width = width;
      columnGroup.append(column);
    }
    const header = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const columns = archived
      ? ["ID", "Username", "Email", "Role", "Archived", "Actions"]
      : ["ID", "Username", "Email", "Role", "Change role", "Modify", "Archive", "Delete"];
    for (const column of columns) {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = column;
      headerRow.append(cell);
    }
    header.append(headerRow);
    const body = document.createElement("tbody");
    table.append(columnGroup, header, body);
    tableWrap.append(table);
    adminUserList.append(tableWrap);

    for (const user of result.users) {
      const row = document.createElement("tr");
      row.className = "admin-user-row";
      const idCell = document.createElement("td");
      idCell.textContent = String(user.id);
      const nameCell = document.createElement("td");
      nameCell.textContent = user.username;
      const emailCell = document.createElement("td");
      emailCell.textContent = user.email;
      row.append(idCell, nameCell, emailCell);

      if (archived) {
        const roleCell = document.createElement("td");
        roleCell.textContent = roleLabel(user.role);
        const archivedCell = document.createElement("td");
        archivedCell.textContent = new Date(`${user.archived_at.replace(" ", "T")}Z`).toLocaleDateString();
        const actionsCell = document.createElement("td");
        const restore = document.createElement("button");
        restore.type = "button";
        restore.className = "admin-action";
        restore.textContent = "Restore";
        restore.addEventListener("click", async () => {
          restore.disabled = true;
          try {
            await adminAction(`/api/admin/archived-users/${user.id}/restore`);
            showMessage(`${user.username} was restored.`);
            await loadAdminUsers("archived");
          } catch (error) {
            showMessage(error.message, true);
          } finally {
            restore.disabled = false;
          }
        });
        actionsCell.append(restore);
        row.append(roleCell, archivedCell, actionsCell);
      } else {
        const roleCell = document.createElement("td");
        roleCell.textContent = roleLabel(user.role);
        if (user.requested_role) {
          roleCell.append(textElement("small", "admin-role-request", `Requested: ${roleLabel(user.requested_role)}`));
        }
        if (user.role === "main_admin") {
          const protectedCell = () => {
            const cell = document.createElement("td");
            cell.className = "admin-protected-cell";
            cell.textContent = "Protected";
            return cell;
          };
          row.append(roleCell, protectedCell(), protectedCell(), protectedCell(), protectedCell());
          row.querySelectorAll(":scope > td").forEach((cell, index) => {
            cell.dataset.label = columns[index];
          });
          body.append(row);
          continue;
        }
        const changeRoleCell = document.createElement("td");
        const role = document.createElement("select");
        role.setAttribute("aria-label", `Role for ${user.username}`);
        for (const value of ["student", "hall_president", "hall_master", "main_admin"]) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = roleLabel(value);
          option.selected = user.role === value;
          role.append(option);
        }
        const updateRole = document.createElement("button");
        updateRole.type = "button";
        updateRole.className = "admin-action";
        updateRole.textContent = "Update role";
        updateRole.disabled = true;
        role.addEventListener("change", () => {
          updateRole.disabled = role.value === user.role;
        });
        updateRole.addEventListener("click", async () => {
          role.disabled = true;
          updateRole.disabled = true;
          try {
            const response = await fetch(`/api/admin/users/${user.id}/role`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ role: role.value })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error ?? "Could not update role.");
            showMessage(`${user.username} is now ${result.user.role}.`);
            if (user.id === signedInUserId()) {
              showSignedIn(result.user);
              return;
            }
            await loadAdminUsers();
          } catch (error) {
            showMessage(error.message, true);
            await loadAdminUsers();
          } finally {
            role.disabled = false;
            updateRole.disabled = role.value === user.role;
          }
        });
        changeRoleCell.className = "admin-table-actions";
        changeRoleCell.append(role, updateRole);

        const modifyCell = document.createElement("td");
        const editorRow = document.createElement("tr");
        editorRow.className = "admin-user-editor-row";
        editorRow.hidden = true;
        const editorCell = document.createElement("td");
        editorCell.colSpan = columns.length;
        const editor = document.createElement("form");
        editor.className = "admin-user-edit-form";
        const editName = createLabeledInput("Username", "username", "text", true);
        editName.input.value = user.username;
        editName.input.minLength = 3;
        editName.input.maxLength = 32;
        const editEmail = createLabeledInput("Email", "email", "email", true);
        editEmail.input.value = user.email;
        editEmail.input.maxLength = 254;
        const editPassword = createLabeledInput("New password (optional)", "password", "password", false);
        editPassword.input.minLength = 8;
        editPassword.input.maxLength = 128;
        editPassword.input.autocomplete = "new-password";
        const save = document.createElement("button");
        save.type = "submit";
        save.className = "admin-action";
        save.textContent = "Update account";
        editor.append(editName.label, editName.input, editEmail.label, editEmail.input,
          editPassword.label, editPassword.input, save);
        editor.addEventListener("submit", async (event) => {
          event.preventDefault();
          save.disabled = true;
          try {
            const updated = await api(`/api/admin/users/${user.id}`, Object.fromEntries(new FormData(editor)), "PATCH");
            showMessage(updated.message);
            const ownPasswordChanged = user.id === signedInUserId() && editPassword.input.value.length > 0;
            if (ownPasswordChanged) {
              dashboardRole = "";
              showPanel("login");
              showMessage("Account updated. Sign in again with your new password.");
              return;
            }
            if (user.id === signedInUserId()) showSignedIn(updated.user, false);
            await loadAdminUsers();
          } catch (error) {
            showMessage(error.message, true);
          } finally {
            save.disabled = false;
          }
        });
        editorCell.append(editor);
        editorRow.append(editorCell);
        const archive = document.createElement("button");
        archive.type = "button";
        archive.className = "admin-action danger";
        archive.textContent = "Archive";
        archive.disabled = user.id === signedInUserId();
        archive.title = archive.disabled
          ? "You cannot archive your own active account."
          : "Archive this account so it can be restored later.";
        archive.addEventListener("click", async () => {
          if (!confirm(`Archive ${user.username}'s account? It will move to Archived users, where it can be restored. Hostel records are preserved.`)) return;
          archive.disabled = true;
          try {
            await adminAction(`/api/admin/users/${user.id}/archive`);
            showMessage(`${user.username}'s account was archived. Hostel records were preserved.`);
            await loadAdminUsers();
          } catch (error) {
            showMessage(error.message, true);
          } finally {
            archive.disabled = false;
          }
        });
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "admin-action";
        edit.textContent = "Modify";
        modifyCell.append(edit);
        const deleteCell = document.createElement("td");
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "admin-action danger";
        deleteButton.textContent = "Delete";
        deleteButton.disabled = user.id === signedInUserId();
        deleteButton.title = deleteButton.disabled
          ? "You cannot permanently delete your own account."
          : "Permanently delete this account. Hostel records are preserved.";
        deleteButton.addEventListener("click", async () => {
          if (!confirm(`Permanently delete ${user.username}'s account? This cannot be undone. Hostel registration and room records will be preserved.`)) return;
          deleteButton.disabled = true;
          try {
            const response = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error ?? "Could not delete account.");
            showMessage(`${user.username}'s account was permanently deleted. Hostel records were preserved.`);
            await loadAdminUsers();
          } catch (error) {
            showMessage(error.message, true);
          } finally {
            deleteButton.disabled = false;
          }
        });
        deleteCell.append(deleteButton);
        edit.addEventListener("click", () => {
          editorRow.hidden = !editorRow.hidden;
          edit.setAttribute("aria-expanded", String(!editorRow.hidden));
          if (!editorRow.hidden) editorRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
        });
        const archiveCell = document.createElement("td");
        archiveCell.append(archive);
        row.append(roleCell, changeRoleCell, modifyCell, archiveCell, deleteCell);
        body.append(row, editorRow);
      }
      row.querySelectorAll(":scope > td").forEach((cell, index) => {
        cell.dataset.label = columns[index];
      });
      if (archived) body.append(row);
    }
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function loadBackups() {
  const response = await fetch("/api/admin/backups");
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not load backups.");
  const securityResponse = await fetch("/api/admin/security");
  const security = await securityResponse.json();
  if (!securityResponse.ok) throw new Error(security.error ?? "Could not load password security details.");
  securityInfo.replaceChildren(
    textElement("h3", "dashboard-card-title", "Password and sensitive-data protection"),
    textElement("p", "dashboard-subtitle", `Password hashing: ${security.algorithm}`),
    textElement("p", "dashboard-subtitle", `Salt: ${security.salt}`),
    textElement("p", "dashboard-subtitle", `Pepper: ${security.pepper} ${security.pepperConfigured ? "A pepper is configured." : "Warning: a pepper is not configured."}`),
    textElement("p", "dashboard-subtitle", security.paymentData)
  );
  backupList.replaceChildren();
  if (result.backups.length === 0) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = "No configuration backups yet.";
    backupList.append(empty);
    return;
  }
  for (const backup of result.backups) {
    const row = document.createElement("div");
    row.className = "admin-user-row";
    const identity = document.createElement("span");
    identity.className = "admin-user-identity";
    const name = document.createElement("strong");
    name.textContent = new Date(backup.createdAt).toLocaleString();
    const meta = document.createElement("small");
    meta.className = "backup-meta";
    meta.textContent = `${formatBytes(backup.sizeBytes)} · roles and settings only`;
    identity.append(name, meta);
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "admin-action";
    restore.textContent = "Restore";
    restore.addEventListener("click", async () => {
      if (!confirm("Restore roles and system settings from this backup? Hostel rooms and registrations will not change.")) return;
      restore.disabled = true;
      try {
        const restored = await adminAction(`/api/admin/backups/${backup.id}/restore`);
        showMessage(restored.message);
        await loadBackups();
      } catch (error) {
        showMessage(error.message, true);
      } finally {
        restore.disabled = false;
      }
    });
    row.append(identity, restore);
    backupList.append(row);
  }
}

function renderReportDetail(view, report, roomId) {
  const container = document.createElement("section");
  container.className = "dashboard-detail-page";
  const titles = {
    checkins: "Check-in history",
    checkouts: "Check-out history",
    pending: "Students awaiting room allocation",
    "monthly-value": "Estimated monthly room value"
  };
  const heading = document.createElement("div");
  heading.className = "dashboard-detail-heading";
  heading.append(
    textElement("h3", "dashboard-card-title", titles[view]),
    textElement("p", "dashboard-subtitle", view === "monthly-value"
      ? "The estimate adds the full monthly rate once for each room with at least one checked-in resident. It is not multiplied by students or beds; vacant rooms count as zero. “Units” is generic because no currency is configured."
      : "Review the complete resident records for this report.")
  );
  const backToDashboard = document.createElement("button");
  backToDashboard.type = "button";
  backToDashboard.className = "button button-primary dashboard-back";
  backToDashboard.textContent = "Back to hostel dashboard";
  backToDashboard.addEventListener("click", () => navigateTo("/dashboard"));
  container.append(heading, backToDashboard);

  if (view === "checkins" || view === "monthly-value") {
    if (roomId) {
      const room = report.rooms.find((item) => item.id === roomId);
      if (!room) {
        container.append(textElement("p", "admin-empty", "That room was not found in the current report."));
        const backToRooms = document.createElement("button");
        backToRooms.type = "button";
        backToRooms.className = "admin-action";
        backToRooms.textContent = "Back to room list";
        backToRooms.addEventListener("click", () => navigateTo(`/reports?view=${view}`));
        container.append(backToRooms);
        return container;
      }

      const ordinal = report.rooms.findIndex((item) => item.id === room.id) + 1;
      const roomHeading = document.createElement("article");
      roomHeading.className = "dashboard-card detail-record";
      roomHeading.append(
        textElement("h4", "dashboard-card-title", `Room ${ordinal} · ${room.room_number}`),
        textElement("p", "dashboard-subtitle", `${room.occupied}/${room.capacity} beds currently occupied · ${room.gender} room · ${formatMoney(room.monthly_rate_cents)} monthly rate`)
      );
      const residents = view === "checkins"
        ? report.checkins.filter((resident) => resident.room_id === room.id)
        : report.residents.filter((resident) => resident.room_id === room.id);
      roomHeading.append(textElement("h4", "dashboard-card-title",
        view === "checkins" ? `Check-in records for this room (${residents.length})` : `Current residents contributing to room value (${residents.length})`));
      if (!residents.length) {
        roomHeading.append(textElement("p", "admin-empty", view === "checkins"
          ? "No check-in records are associated with this room."
          : "This room has no current residents and contributes zero to the estimate."));
      }
      for (const resident of residents) {
        const record = document.createElement("section");
        record.className = "room-resident";
        record.append(textElement("h5", "", resident.student_name));
        appendResidentDetails(record, resident);
        roomHeading.append(record);
      }
      if (view === "monthly-value") {
        roomHeading.append(textElement("p", "dashboard-subtitle",
          `This room contributes ${formatMoney(room.occupied > 0 ? room.monthly_rate_cents : 0)} to the current monthly estimate.`));
      }
      const backToRooms = document.createElement("button");
      backToRooms.type = "button";
      backToRooms.className = "admin-action";
      backToRooms.textContent = view === "checkins" ? "Back to check-in rooms" : "Back to value rooms";
      backToRooms.addEventListener("click", () => navigateTo(`/reports?view=${view}`));
      container.append(roomHeading, backToRooms);
      return container;
    }

    container.append(textElement("h4", "dashboard-card-title", view === "checkins"
      ? "Choose a room to view its check-in records"
      : "Choose a room to view its value contribution"));
    const roomGrid = document.createElement("div");
    roomGrid.className = "resident-room-grid";
    if (!report.rooms.length) container.append(textElement("p", "admin-empty", "No rooms are available."));
    for (const [index, room] of report.rooms.entries()) {
      const checkinCount = report.checkins.filter((resident) => resident.room_id === room.id).length;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "resident-room-button";
      button.append(
        textElement("strong", "", `Room ${index + 1}`),
        textElement("span", "", room.room_number),
        textElement("small", "", view === "checkins"
          ? `${checkinCount} check-in record(s) · ${room.occupied}/${room.capacity} currently occupied`
          : room.occupied > 0
            ? `${formatMoney(room.monthly_rate_cents)} per month · included`
            : "0 units · vacant, not included")
      );
      button.addEventListener("click", () => navigateTo(`/reports?view=${view}&room=${room.id}`));
      roomGrid.append(button);
    }
    container.append(roomGrid);
    if (view === "monthly-value") {
      container.append(textElement("p", "dashboard-subtitle detail-summary",
        `${report.occupiedRooms.length} occupied room(s) contribute to a total of ${formatMoney(report.estimatedMonthlyRoomValueCents)}.`));
    }
    return container;
  }

  const records = view === "checkouts" ? report.checkouts : report.pending;
  container.append(textElement("p", "dashboard-subtitle detail-summary",
    view === "checkouts"
      ? `${records.length} recorded check-out(s).`
      : `${records.length} pending registration(s) out of ${report.statusSummary.reduce((total, entry) => total + entry.count, 0)} active registrations.`));
  if (!records.length) {
    container.append(textElement("p", "admin-empty", view === "checkouts"
      ? "No check-outs have been recorded."
      : "There are no pending registrations."));
    return container;
  }
  for (const resident of records) {
    const card = document.createElement("article");
    card.className = "dashboard-card detail-record";
    card.append(textElement("h4", "dashboard-card-title", resident.student_name));
    appendResidentDetails(card, resident);
    container.append(card);
  }
  return container;
}

function formatBytes(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

async function adminAction(path) {
  const response = await fetch(path, { method: "POST" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Admin action failed.");
  return result;
}

function signedInUserId() {
  return Number(document.querySelector("#signed-in-name").dataset.userId);
}

loginTab.addEventListener("click", () => showPanel("login"));
registerTab.addEventListener("click", () => showPanel("register"));
activeUsersTab.addEventListener("click", () => loadAdminUsers("active"));
archivedUsersTab.addEventListener("click", () => loadAdminUsers("archived"));
backupsTab.addEventListener("click", () => loadAdminUsers("backups"));
document.querySelector("#create-backup-button").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await adminAction("/api/admin/backups");
    showMessage(result.message);
    await loadBackups();
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

for (const link of [dashboardLink, reportsLink, adminLink, implementationReportLink, mobileDashboardLink, mobileReportsLink, mobileAdminLink]) {
  link.addEventListener("click", (event) => {
    if (link.hidden || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigateTo(link.pathname);
  });
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(loginForm));
  try {
    const result = await api("/api/auth/login", data);
    loginForm.elements.password.value = "";
    pendingEmail = data.email;
    document.querySelector("#otp-email").textContent = pendingEmail;
    document.querySelector("#otp-code").value = result.demoCode ?? "";
    showPanel("otp");
    showMessage(
      result.demoCode
        ? `Local demo verification code: ${result.demoCode}. It expires in five minutes.`
        : result.message
    );
    document.querySelector("#otp-code").focus();
  } catch (error) {
    showMessage(error.message, true);
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(registerForm));
  try {
    const result = await api("/api/auth/register", data);
    loginForm.elements.email.value = data.email;
    loginForm.elements.password.value = "";
    showPanel("login");
    showMessage(result.message);
  } catch (error) {
    showMessage(error.message, true);
  }
});

document.querySelector("#otp-code").addEventListener("input", (event) => {
  event.target.value = event.target.value.replace(/\D/g, "").slice(0, 6);
});

otpForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = otpForm.elements.code.value.trim();
  if (!/^\d{6}$/.test(code)) {
    showMessage("Enter the full six-digit verification code.", true);
    return;
  }
  try {
    const result = await api("/api/auth/verify-otp", {
      email: pendingEmail,
      code
    });
    showSignedIn(result.user);
  } catch (error) {
    showMessage(error.message, true);
  }
});

document.querySelector("#back-to-login").addEventListener("click", () => showPanel("login"));

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", {});
    dashboardRole = "";
    appNavigation.hidden = true;
    mobileNavigation.hidden = true;
    adminPanel.hidden = true;
    history.replaceState(null, "", "/");
    showPanel("login");
    showMessage("You are signed out.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

window.addEventListener("popstate", () => renderCurrentRoute(true));

fetch("/api/auth/me")
  .then(async (response) => {
    if (!response.ok) return null;
    return response.json();
  })
  .then((result) => {
    if (result?.user) {
      showSignedIn(result.user, false);
    } else {
      dashboardRole = "";
      appNavigation.hidden = true;
      const requestedAdmin = location.pathname === "/admin";
      if (location.pathname !== "/") history.replaceState(null, "", "/");
      showPanel("login");
      if (requestedAdmin) showMessage("Sign in with an administrator account to open the admin page.");
    }
  })
  .catch(() => {
    dashboardRole = "";
    appNavigation.hidden = true;
    history.replaceState(null, "", "/");
    showPanel("login");
    showMessage("Could not check the sign-in session. Please sign in again.", true);
  });
