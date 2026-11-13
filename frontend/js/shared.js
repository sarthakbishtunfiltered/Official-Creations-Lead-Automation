// ============================================================
// OFFICIAL CREATIONS — SHARED FUNCTIONS
// ============================================================

// ============================================================
// NAVIGATION PATH FIX
// Removes accidentally duplicated frontend directories.
// Preserves the rest of the deployment path.
// ============================================================

function getNavigationPath(filename) {
  const url = new URL(window.location.href);

  let segments = url.pathname.split("/").filter(Boolean);

  // Remove duplicate consecutive frontend directories.
  const normalized = [];

  for (const segment of segments) {
    if (
      segment === "frontend" &&
      normalized[normalized.length - 1] === "frontend"
    ) {
      continue;
    }

    normalized.push(segment);
  }

  // Remove current filename.
  if (
    normalized.length &&
    normalized[normalized.length - 1].endsWith(".html")
  ) {
    normalized.pop();
  }

  const basePath = "/" + normalized.join("/") + "/";

  return basePath + filename;
}

// ============================================================
// APPLICATION SHELL
// ============================================================

function renderShell(activePage) {
  const items = [
    ["dashboard.html", "Dashboard"],
    ["leads.html", "Leads"],
    ["blacklisted.html", "Blacklisted"],
    ["called-rejected.html", "Called / Rejected"],
    ["settings.html", "Settings"],
  ];

  // Approvals: Owner + anyone flagged "Can Approve". Team: Owner only.
  if (Auth.canApprove()) {
    items.push(["approvals.html", "Approvals"]);
  }

  if (Auth.isOwner()) {
    items.push(["team.html", "Team"]);
  }

  const role = Auth.getRole();

  const roleLabels = {
    owner: "OWNER",
    editor: "EDITOR",
    viewer: "VIEWER",
  };

  const navHtml = items
    .map(([filename, label]) => {
      const active = filename === activePage ? "active" : "";

      const href = getNavigationPath(filename);

      return `
        <a
          href="${href}"
          class="${active}"
        >${label}</a>
      `;
    })
    .join("");

  document.getElementById("shell").innerHTML = `
    <aside class="sidebar">

      <div>
        <p class="brand">Official Creations</p>
        <p class="brand-sub">Lead Automation</p>
      </div>

      <nav class="nav">
        ${navHtml}
      </nav>

      <div class="sidebar-foot">

        <div>Signed in</div>

        <span class="role-tag">
          ${roleLabels[role] || "VIEWER"}
        </span>

        <div style="margin-top:10px;">
          <button
            class="btn-quiet"
            id="signOutBtn"
            style="padding:4px 0;"
          >
            Sign out
          </button>
        </div>

      </div>

    </aside>

    <main class="main" id="mainContent"></main>
  `;

  document
    .getElementById("signOutBtn")
    .addEventListener("click", Auth.signOut);
}

// ============================================================
// POLLING
// ============================================================

function startPolling(fn, intervalMs) {
  fn();

  return setInterval(
    fn,
    intervalMs || CONFIG.POLL_INTERVAL_MS
  );
}

// ============================================================
// HTML ESCAPING
// ============================================================

function escapeHtml(str) {
  const div = document.createElement("div");

  div.textContent = str ?? "";

  return div.innerHTML;
}

// ============================================================
// PRIORITY
// ============================================================

function priorityClass(p) {
  const v = (p || "").toLowerCase();

  if (v.includes("high")) return "priority-high";
  if (v.includes("med")) return "priority-med";

  return "priority-low";
}

// ============================================================
// BOOLEAN VALUE
// ============================================================

function truthy(v) {
  const s = String(v).trim().toLowerCase();

  return (
    s === "true" ||
    s === "yes" ||
    s === "1" ||
    s === "✓"
  );
}

// ============================================================
// REAL LEAD VALIDATION
// ============================================================

function isRealLead(row) {
  const businessName = String(
    row["Business Name"] || ""
  ).trim();

  const location = String(
    row["Location"] || ""
  ).trim();

  const phone = String(
    row["Phone"] || ""
  ).trim();

  const instagram = String(
    row["Instagram ID"] || ""
  ).trim();

  const opportunity = String(
    row["Opportunity"] || ""
  ).trim();

  return Boolean(
    businessName &&
    location &&
    (phone || instagram) &&
    opportunity
  );
}
// ============================================================
// TIMESTAMP — "YYYY-MM-DD HH:MM:SS" in the viewer's local time.
// Used by lead actions, the Team page and the Approvals page.
// ============================================================

function pad2(n) {
  return String(n).padStart(2, "0");
}

function nowStamp() {
  const d = new Date();

  return (
    d.getFullYear() +
    "-" +
    pad2(d.getMonth() + 1) +
    "-" +
    pad2(d.getDate()) +
    " " +
    pad2(d.getHours()) +
    ":" +
    pad2(d.getMinutes()) +
    ":" +
    pad2(d.getSeconds())
  );
}
