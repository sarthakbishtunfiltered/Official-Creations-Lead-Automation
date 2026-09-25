function renderShell(activePage) {
  const items = [
    ["dashboard.html", "Dashboard"],
    ["leads.html", "Leads"],
    ["blacklisted.html", "Blacklisted"],
    ["called-rejected.html", "Called / Rejected"],
    ["settings.html", "Settings"],
  ];

  const role = Auth.getRole();

  const navHtml = items
    .map(([href, label]) => {
      const active = href === activePage ? "active" : "";
      return "<a href=\"" + href + "\" class=\"" + active + "\">" + label + "</a>";
    })
    .join("");

  document.getElementById("shell").innerHTML = `
    <aside class="sidebar">
      <div>
        <p class="brand">Official Creations</p>
        <p class="brand-sub">Lead Automation</p>
      </div>
      <nav class="nav">${navHtml}</nav>
      <div class="sidebar-foot">
        <div>Signed in</div>
        <span class="role-tag">${role === "editor" ? "EDITOR" : "VIEWER"}</span>
        <div style="margin-top:10px;">
          <button class="btn-quiet" id="signOutBtn" style="padding:4px 0;">Sign out</button>
        </div>
      </div>
    </aside>
    <main class="main" id="mainContent"></main>
  `;
  document.getElementById("signOutBtn").addEventListener("click", Auth.signOut);
}

function startPolling(fn, intervalMs) {
  fn();
  return setInterval(fn, intervalMs || CONFIG.POLL_INTERVAL_MS);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function priorityClass(p) {
  const v = (p || "").toLowerCase();
  if (v.includes("high")) return "priority-high";
  if (v.includes("med")) return "priority-med";
  return "priority-low";
}

function truthy(v) {
  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "yes" || s === "1" || s === "✓";
}