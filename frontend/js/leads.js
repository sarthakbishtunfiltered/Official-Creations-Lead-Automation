// ============================================================
// LEADS PAGE
// ============================================================

const LEAD_FORM_FIELDS = [
  { id: "f_business", label: "Business name *", col: "Business Name" },
  { id: "f_industry", label: "Industry", col: "Industry" },
  { id: "f_location", label: "Location *", col: "Location" },
  { id: "f_phone", label: "Phone", col: "Phone", type: "tel" },
  { id: "f_instagram", label: "Instagram ID", col: "Instagram ID" },
  { id: "f_opportunity", label: "Opportunity / notes *", col: "Opportunity" },
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
      ${isEditor ? '<button class="btn-primary" id="addLeadBtn">+ Add lead manually</button> <button class="btn-quiet" id="cleanupBtn">Clean up blank rows</button> <button class="btn-quiet" id="removeUnapprovedBtn" style="color:var(--warn);">Remove unapproved leads</button>' : ""}
      </div>
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
  `;

  if (isEditor) {
    document.getElementById("addLeadBtn").addEventListener("click", openLeadModal);

    document.getElementById("cleanupBtn").addEventListener("click", async () => {
      const btn = document.getElementById("cleanupBtn");
      btn.disabled = true;
      btn.textContent = "Scanning…";
      try {
        await openCleanupModal();
      } finally {
        btn.disabled = false;
        btn.textContent = "Clean up blank rows";
      }
    });

    document.getElementById("removeUnapprovedBtn").addEventListener("click", async () => {
      const btn = document.getElementById("removeUnapprovedBtn");
      btn.disabled = true;
      btn.textContent = "Scanning…";
      try {
        await openRemoveUnapprovedModal();
      } finally {
        btn.disabled = false;
        btn.textContent = "Remove unapproved leads";
      }
    });
  }

  document.getElementById("searchInput").addEventListener("input", renderTable);
  document.getElementById("statusFilter").addEventListener("change", renderTable);

  startPolling(refresh, CONFIG.POLL_INTERVAL_MS);
});

async function refresh() {
  try {
        const table = await SheetsAPI.getTable(CONFIG.TABS.LEADS);
    leadHeaders = table.headers;
    allLeadRows = table.rows.filter(isRealLead).sort((a, b) => b.__rowIndex - a.__rowIndex);
    renderTable();
  } catch (e) {
    console.error("Leads refresh failed:", e);
  }
}

function renderTable() {
  const search = document.getElementById("searchInput").value.trim().toLowerCase();
  const statusFilter = document.getElementById("statusFilter").value;
  const isEditor = Auth.isEditor();

  const rows = allLeadRows.filter((r) => {
    const haystack = (r["Business Name"] + " " + r["Industry"] + " " + r["Location"]).toLowerCase();
    if (search && !haystack.includes(search)) return false;
    if (statusFilter === "approved" && !truthy(r["Approve"])) return false;
    if (statusFilter === "pending" && truthy(r["Approve"])) return false;
    return true;
  });

  if (rows.length === 0) {
    document.getElementById("leadsTableWrap").innerHTML =
      '<div class="empty-state">No leads match this view.</div>';
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
        ${isEditor ? `<td style="white-space:nowrap;">
          <button class="btn-quiet" data-lead-action="blacklist" data-row="${r.__rowIndex}" style="padding:4px 8px;">Blacklist</button>
          <button class="btn-quiet" data-lead-action="delete" data-row="${r.__rowIndex}" style="padding:4px 8px;color:var(--warn);">Delete</button>
        </td>` : ""}
      </tr>`;
    })
    .join("");

  document.getElementById("leadsTableWrap").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Keep</th><th>Lead ID</th><th>Business</th><th>Industry</th>
          <th>Location</th><th>Phone</th><th>Source</th><th>Score</th>
                    <th>Priority</th><th>Status</th>${isEditor ? "<th></th>" : ""}
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
            CONFIG.TABS.LEADS + "!" + approveColLetter + rowIndex,
            e.target.checked ? "TRUE" : "FALSE"
          );
        } catch (err) {
          console.error("Approve update failed:", err);
          e.target.checked = !e.target.checked;
        } finally {
          e.target.disabled = false;
        }
      });
    });
  }
}
function closeLeadModal() {
  const existing = document.getElementById("leadModal");
  if (existing) existing.remove();
  document.removeEventListener("keydown", onModalKey);
}

function onModalKey(e) {
  if (e.key === "Escape") closeLeadModal();
}

function openLeadModal() {
  closeLeadModal();

  const fieldsHtml = LEAD_FORM_FIELDS.map(
    (f) => `
      <div class="field">
        <label for="${f.id}">${f.label}</label>
        <input type="${f.type || "text"}" id="${f.id}" />
      </div>`
  ).join("");

  const overlay = document.createElement("div");
  overlay.id = "leadModal";
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(20,23,31,0.45);z-index:1000;" +
    "display:flex;align-items:center;justify-content:center;padding:20px;";

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:4px;padding:24px;width:100%;max-width:480px;max-height:90vh;overflow:auto;">
      <h2 style="font-family:var(--font-display);font-size:20px;margin:0 0 4px;">Add a lead manually</h2>
      <p class="sub" style="margin:0 0 16px;font-size:13px;">
        Saved straight to the Leads sheet as a qualified lead.
        Provide a phone number or an Instagram ID.
      </p>
      ${fieldsHtml}
      <div id="leadFormError" style="color:var(--warn);font-size:13px;min-height:18px;margin-bottom:8px;"></div>
      <div style="display:flex;gap:8px;">
        <button class="btn-primary" id="saveLeadBtn">Save lead</button>
        <button id="cancelLeadBtn">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeLeadModal();
  });
  document.getElementById("cancelLeadBtn").addEventListener("click", closeLeadModal);
  document.getElementById("saveLeadBtn").addEventListener("click", saveManualLead);
  document.addEventListener("keydown", onModalKey);

  document.getElementById("f_business").focus();
}

async function saveManualLead() {
  const errorBox = document.getElementById("leadFormError");
  const btn = document.getElementById("saveLeadBtn");

  const val = (id) => document.getElementById(id).value.trim();

  const business = val("f_business");
  const location = val("f_location");
  const phone = val("f_phone");
  const instagram = val("f_instagram");
  const opportunity = val("f_opportunity");

  if (!business || !location || !opportunity) {
    errorBox.textContent = "Business name, location and opportunity are required.";
    return;
  }
  if (!phone && !instagram) {
    errorBox.textContent = "Add at least a phone number or an Instagram ID.";
    return;
  }

  errorBox.textContent = "";
  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    if (leadHeaders.length === 0) {
      const table = await SheetsAPI.getTable(CONFIG.TABS.LEADS);
      leadHeaders = table.headers;
    }

    const leadId = await nextLeadId();

    const valuesByHeader = {
      "Lead ID": leadId,
      "Business Name": business,
      "Industry": val("f_industry"),
      "Location": location,
      "Phone": phone,
      "Instagram ID": instagram,
      "Lead Source": "Manual (Web)",
      "Opportunity": opportunity,
      "Approve": "TRUE",
      "Status": "Active",
      "Created At": new Date().toISOString(),
    };

    const row = leadHeaders.map((h) =>
      Object.prototype.hasOwnProperty.call(valuesByHeader, h) ? valuesByHeader[h] : ""
    );

    await SheetsAPI.appendRow(CONFIG.TABS.LEADS, row);
    closeLeadModal();
    await refresh();
  } catch (e) {
    console.error("Save lead failed:", e);
    errorBox.textContent = "Could not save the lead. Check the browser console for details.";
    btn.disabled = false;
    btn.textContent = "Save lead";
  }
}