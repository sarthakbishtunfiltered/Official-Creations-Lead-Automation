// ============================================================
// LEADS PAGE
//
// Checking the "Approve" box writes TRUE straight to that cell
// in the Leads sheet (Editor only — Google enforces this via
// the token, but we also hide the control for Viewers). Once
// checked, a lead is expected to be excluded from the backend's
// 48-hour deletion sweep — see the note added to Settings.
//
// Manually-added leads are appended with Approve = TRUE and
// Lead Source = "Manual (Web)" straight away, since a
// human-entered lead is considered already qualified.
// ============================================================

const LEAD_COLUMNS = [
  "Lead ID", "Business Name", "Industry", "Location", "Phone",
  "Instagram ID", "Lead Source", "Opportunity", "Buying Signal",
  "Score", "Priority", "Approve", "Approval Reason",
  "Reject After Call", "Status",
];

let allLeadRows = [];
let leadHeaders = [];

Auth.requireSession(() => {
  renderShell("leads.html");
  const isEditor = Auth.isEditor();
  document.getElementById("mainContent").innerHTML = `
    <div class="page-head">
      <div>
        <h1>Leads</h1>
        <div class="sub">Full lead database, synced live with Google Sheets</div>
      </div>
      ${isEditor ? '<button class="btn-primary" id="addLeadBtn">+ Add lead manually</button>' : ""}
    </div>

    <div class="panel">
      <div class="toolbar">
        <input type="text" id="searchInput" placeholder="Search business, industry, location…" />
        <select id="statusFilter">
          <option value="">All statuses</option>
          <option value="approved">Approved / qualified</option>
          <option value="pending">Pending review</option>
        </select>
      </div>
      <div id="leadsTableWrap">Loading…</div>
    </div>

    <div class="panel hidden" id="addLeadPanel">
      <h2>Add a lead manually</h2>
      <div class="field-row">
        <div class="field"><label>Business name</label><input type="text" id="f_business" /></div>
        <div class="field"><label>Industry</label><input type="text" id="f_industry" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Location</label><input type="text" id="f_location" /></div>
        <div class="field"><label>Phone</label><input type="tel" id="f_phone" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Instagram ID</label><input type="text" id="f_instagram" /></div>
        <div class="field"><label>Opportunity / notes</label><input type="text" id="f_opportunity" /></div>
      </div>
      <button class="btn-primary" id="saveLeadBtn">Save lead</button>
      <button class="btn-quiet" id="cancelLeadBtn">Cancel</button>
    </div>
  `;

  if (isEditor) {
    document.getElementById("addLeadBtn").addEventListener("click", () => {
      document.getElementById("addLeadPanel").classList.remove("hidden");
    });
    document.getElementById("cancelLeadBtn").addEventListener("click", () => {
      document.getElementById("addLeadPanel").classList.add("hidden");
    });
    document.getElementById("saveLeadBtn").addEventListener("click", saveManualLead);
  }

  document.getElementById("searchInput").addEventListener("input", renderTable);
  document.getElementById("statusFilter").addEventListener("change", renderTable);

  startPolling(refresh, CONFIG.POLL_INTERVAL_MS);
});

async function refresh() {
  try {
    const table = await SheetsAPI.getTable(CONFIG.TABS.LEADS);
    leadHeaders = table.headers;
    allLeadRows = table.rows;
    renderTable();
  } catch (e) {
    console.error(e);
  }
}

function renderTable() {
  const search = document.getElementById("searchInput").value.trim().toLowerCase();
  const statusFilter = document.getElementById("statusFilter").value;
  const isEditor = Auth.isEditor();

  let rows = allLeadRows.filter((r) => {
    const haystack = `${r["Business Name"]} ${r["Industry"]} ${r["Location"]}`.toLowerCase();
    if (search && !haystack.includes(search)) return false;
    if (statusFilter === "approved" && !truthy(r["Approve"])) return false;
    if (statusFilter === "pending" && truthy(r["Approve"])) return false;
    return true;
  });

  if (rows.length === 0) {
    document.getElementById("leadsTableWrap").innerHTML = `<div class="empty-state">No leads match this view.</div>`;
    return;
  }

  const approveColLetter = SheetsAPI.colLetter(leadHeaders, "Approve");

  const rowsHtml = rows
    .map((r) => {
      const checked = truthy(r["Approve"]) ? "checked" : "";
      return `
      <tr>
        <td>
          <input type="checkbox" data-row="${r.__rowIndex}" class="approveBox" ${checked}
            ${isEditor ? "" : "disabled"} />
        </td>
        <td class="lead-id">${escapeHtml(r["Lead ID"])}</td>
        <td>${escapeHtml(r["Business Name"])}</td>
        <td>${escapeHtml(r["Industry"])}</td>
        <td>${escapeHtml(r["Location"])}</td>
        <td>${escapeHtml(r["Phone"])}</td>
        <td>${escapeHtml(r["Lead Source"])}</td>
        <td class="score">${escapeHtml(r["Score"])}</td>
        <td class="${priorityClass(r["Priority"])}">${escapeHtml(r["Priority"])}</td>
        <td>${escapeHtml(r["Status"])}</td>
      </tr>`;
    })
    .join("");

  document.getElementById("leadsTableWrap").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Keep</th><th>Lead ID</th><th>Business</th><th>Industry</th>
          <th>Location</th><th>Phone</th><th>Source</th><th>Score</th>
          <th>Priority</th><th>Status</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;

  if (isEditor) {
    document.querySelectorAll(".approveBox").forEach((box) => {
      box.addEventListener("change", async (e) => {
        const rowIndex = e.target.getAttribute("data-row");
        e.target.disabled = true;
        try {
          await SheetsAPI.updateCell(
            `${CONFIG.TABS.LEADS}!${approveColLetter}${rowIndex}`,
            e.target.checked ? "TRUE" : "FALSE"
          );
        } finally {
          e.target.disabled = false;
        }
      });
    });
  }
}

async function saveManualLead() {
  const values = LEAD_COLUMNS.map((col) => {
    switch (col) {
      case "Lead ID": return "MANUAL-" + Date.now();
      case "Business Name": return document.getElementById("f_business").value;
      case "Industry": return document.getElementById("f_industry").value;
      case "Location": return document.getElementById("f_location").value;
      case "Phone": return document.getElementById("f_phone").value;
      case "Instagram ID": return document.getElementById("f_instagram").value;
      case "Lead Source": return "Manual (Web)";
      case "Opportunity": return document.getElementById("f_opportunity").value;
      case "Approve": return "TRUE"; // manually-added leads are already qualified
      case "Status": return "Active";
      default: return "";
    }
  });

  const btn = document.getElementById("saveLeadBtn");
  btn.disabled = true;
  try {
    await SheetsAPI.appendRow(CONFIG.TABS.LEADS, values);
    document.getElementById("addLeadPanel").classList.add("hidden");
    ["f_business", "f_industry", "f_location", "f_phone", "f_instagram", "f_opportunity"].forEach(
      (id) => (document.getElementById(id).value = "")
    );
    refresh();
  } finally {
    btn.disabled = false;
  }
}