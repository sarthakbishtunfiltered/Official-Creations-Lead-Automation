// ============================================================
// DASHBOARD
// ============================================================

const SETTINGS_KEYS = {
  STATUS: "Automation Status",
  RUN_UNTIL: "Run Until",
  DURATION: "Session Duration (min)",
};

Auth.requireSession(() => {
  renderShell("dashboard.html");

  document.getElementById("mainContent").innerHTML = `
    <div class="page-head">
      <div>
        <h1>Dashboard</h1>
        <div class="sub">Automation status and live counts</div>
      </div>
      <div id="statusPillWrap"></div>
    </div>

    <div class="panel" id="controlPanel">
      <h2>Automation control</h2>
      <div id="controlBody">Loading…</div>
    </div>

    <div class="panel">
      <h2>Overview</h2>

      <div class="stat-row" id="statRow">
        <div class="stat">
          <div class="n">—</div>
          <div class="label">Leads discovered</div>
        </div>

        <div class="stat">
          <div class="n">—</div>
          <div class="label">Qualified leads</div>
        </div>

        <div class="stat">
          <div class="n">—</div>
          <div class="label">Active leads</div>
        </div>

        <div class="stat">
          <div class="n">—</div>
          <div class="label">Pending review</div>
        </div>
      </div>
    </div>

    <div class="panel">
      <h2>Recent activity</h2>
      <div id="recentActivity">Loading…</div>
    </div>
  `;

  startPolling(refresh, CONFIG.POLL_INTERVAL_MS);
});

async function refresh() {
  try {
    const [settings, leads] = await Promise.all([
      SheetsAPI.getTable(CONFIG.TABS.SETTINGS),
      SheetsAPI.getTable(CONFIG.TABS.LEADS),
    ]);

    renderStatus(settings);
    renderStats(leads.rows);
    renderActivity(leads.rows);
  } catch (e) {
    console.error("Dashboard refresh failed:", e);

    const activity = document.getElementById("recentActivity");

    if (activity) {
      activity.innerHTML = `
        <div class="empty-state">
          Unable to load dashboard data.
        </div>
      `;
    }
  }
}

function getSettingValue(settingsTable, keyLabel) {
  const { headers, rows } = settingsTable;

  if (!headers.length) {
    return null;
  }

  const keyCol = headers[0];
  const valCol = headers[1];

  const row = rows.find(
    (r) => String(r[keyCol] || "").trim() === keyLabel
  );

  return row ? row[valCol] : null;
}

function renderStatus(settingsTable) {
  const status = String(
    getSettingValue(settingsTable, SETTINGS_KEYS.STATUS) || "STOP"
  ).toUpperCase();

  const runUntil = getSettingValue(
    settingsTable,
    SETTINGS_KEYS.RUN_UNTIL
  );

  const isRunning =
    status === "RUNNING" ||
    status === "START";

  const pillClass = isRunning
    ? "running"
    : status === "PAUSED"
      ? "paused"
      : "stopped";

  const displayStatus = isRunning
    ? "RUNNING"
    : status;

  document.getElementById("statusPillWrap").innerHTML = `
    <span class="status-pill ${pillClass}">
      <span class="dot"></span>
      ${displayStatus}
    </span>
  `;

  let timeLeftHtml = "";

  if (isRunning && runUntil) {
    const msLeft =
      new Date(runUntil).getTime() - Date.now();

    if (msLeft > 0) {
      const mins = Math.ceil(msLeft / 60000);

      timeLeftHtml = `
        <p class="sub" style="margin:6px 0 0;">
          About ${mins} min remaining in this session.
        </p>
      `;
    } else {
      timeLeftHtml = `
        <p class="sub" style="margin:6px 0 0;">
          Session time is up — it will stop shortly.
        </p>
      `;
    }
  }

  const isEditor = Auth.isEditor();
  const controlBody =
    document.getElementById("controlBody");

  if (isRunning) {
    controlBody.innerHTML = `
      ${timeLeftHtml}

      <div style="margin-top:14px;">
        <button
          class="btn-stop"
          id="stopBtn"
          ${isEditor ? "" : "disabled"}
        >
          Stop now
        </button>

        ${
          isEditor
            ? ""
            : `<span class="badge-readonly" style="margin-left:10px;">
                Read-only — Editor access required to control automation
              </span>`
        }
      </div>
    `;

    if (isEditor) {
      document
        .getElementById("stopBtn")
        .addEventListener("click", stopAutomation);
    }
  } else {
    controlBody.innerHTML = `
      <div class="field-row" style="max-width:360px;">
        <div class="field">
          <label>Run for (minutes)</label>

          <input
            type="number"
            id="durationInput"
            value="90"
            min="5"
            max="120"
            ${isEditor ? "" : "disabled"}
          />
        </div>
      </div>

      <button
        class="btn-primary"
        id="startBtn"
        ${isEditor ? "" : "disabled"}
      >
        Start automation
      </button>

      ${
        isEditor
          ? ""
          : `<span class="badge-readonly" style="margin-left:10px;">
              Read-only — Editor access required to control automation
            </span>`
      }

      <p class="sub" style="margin-top:10px;">
        Starting writes the run window to Settings. A scheduled check
        picks it up and begins the session — allow a few minutes for it to start.
      </p>
    `;

    if (isEditor) {
      document
        .getElementById("startBtn")
        .addEventListener("click", startAutomation);
    }
  }
}

async function startAutomation() {
  let mins =
    parseInt(
      document.getElementById("durationInput").value,
      10
    ) || 90;

  mins = Math.min(Math.max(mins, 5), 120);

  const runUntil = new Date(
    Date.now() + mins * 60000
  ).toISOString();

  await writeSetting(
    SETTINGS_KEYS.STATUS,
    "START"
  );

  await writeSetting(
    SETTINGS_KEYS.DURATION,
    String(mins)
  );

  await writeSetting(
    SETTINGS_KEYS.RUN_UNTIL,
    runUntil
  );

  await refresh();
}

async function stopAutomation() {
  await writeSetting(
    SETTINGS_KEYS.STATUS,
    "STOP"
  );

  await refresh();
}

async function writeSetting(keyLabel, value) {
  const table = await SheetsAPI.getTable(
    CONFIG.TABS.SETTINGS
  );

  const { headers, rows } = table;

  if (headers.length < 2) {
    throw new Error(
      "Settings sheet must have at least two columns."
    );
  }

  const keyCol = headers[0];

  const valColLetter =
    SheetsAPI.colLetter(
      headers,
      headers[1]
    );

  const existing = rows.find(
    (r) =>
      String(r[keyCol] || "").trim() ===
      keyLabel
  );

  if (existing) {
    await SheetsAPI.updateCell(
      `${CONFIG.TABS.SETTINGS}!${valColLetter}${existing.__rowIndex}`,
      value
    );
  } else {
    await SheetsAPI.appendRow(
      CONFIG.TABS.SETTINGS,
      [keyLabel, value]
    );
  }
}

// ============================================================
// LEAD VALIDATION
// ============================================================

function isRealLead(row) {
  const businessName =
    String(row["Business Name"] || "").trim();

  const location =
    String(row["Location"] || "").trim();

  const phone =
    String(row["Phone"] || "").trim();

  const instagram =
    String(row["Instagram ID"] || "").trim();

  const opportunity =
    String(row["Opportunity"] || "").trim();

  return Boolean(
    businessName &&
    location &&
    (phone || instagram) &&
    opportunity
  );
}

// ============================================================
// DASHBOARD STATS
// ============================================================

function renderStats(leadRows) {
  const realLeads =
    leadRows.filter(isRealLead);

  const discovered =
    realLeads.length;

  const qualified =
    realLeads.filter(
      (r) => truthy(r["Approve"])
    ).length;

  const active =
    realLeads.filter(
      (r) =>
        String(r["Status"] || "")
          .toLowerCase()
          .trim() === "active"
    ).length;

  const pending =
    realLeads.filter(
      (r) => !truthy(r["Approve"])
    ).length;

  const stats = [
    [discovered, "Leads discovered"],
    [qualified, "Qualified leads"],
    [active, "Active leads"],
    [pending, "Pending review"],
  ];

  document.getElementById(
    "statRow"
  ).innerHTML = stats
    .map(
      ([n, label]) => `
        <div class="stat">
          <div class="n">${n}</div>
          <div class="label">${label}</div>
        </div>
      `
    )
    .join("");
}

// ============================================================
// RECENT ACTIVITY
// ============================================================

function renderActivity(leadRows) {
  const realLeads =
    leadRows.filter(isRealLead);

  const recent =
    realLeads
      .slice(-8)
      .reverse();

  if (recent.length === 0) {
    document.getElementById(
      "recentActivity"
    ).innerHTML = `
      <div class="empty-state">
        No leads yet.
      </div>
    `;

    return;
  }

  const rowsHtml =
    recent
      .map(
        (r) => `
          <tr>
            <td class="lead-id">
              ${escapeHtml(r["Lead ID"] || "")}
            </td>

            <td>
              ${escapeHtml(r["Business Name"] || "")}
            </td>

            <td>
              ${escapeHtml(r["Industry"] || "")}
            </td>

            <td>
              ${
                truthy(r["Approve"])
                  ? `
                    <span class="status-pill running">
                      <span class="dot"></span>
                      Qualified
                    </span>
                  `
                  : `
                    <span class="status-pill paused">
                      <span class="dot"></span>
                      Pending
                    </span>
                  `
              }
            </td>
          </tr>
        `
      )
      .join("");

  document.getElementById(
    "recentActivity"
  ).innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Lead ID</th>
          <th>Business</th>
          <th>Industry</th>
          <th>Status</th>
        </tr>
      </thead>

      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;
}