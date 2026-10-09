// ============================================================
// LEAD ACTIONS - delete a lead permanently, or blacklist it.
// Editors only. Loaded on leads.html after leads.js.
// ============================================================

const BLACKLIST_DEFAULT_HEADERS = [
  "Business Name",
  "Phone",
  "Instagram ID",
  "Reason",
  "Blacklisted At",
];

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

// Find the lead's CURRENT row in the sheet.
// Row numbers can change after other rows are deleted.
async function locateLead(leadId, businessName) {
  const table = await SheetsAPI.getTable(CONFIG.TABS.LEADS);

  const row = table.rows.find(
    (r) =>
      String(r["Lead ID"]).trim() === leadId &&
      String(r["Business Name"]).trim() === businessName
  );

  return row || null;
}

function buildBlacklistRow(headers, lead, reason) {
  const useHeaders = headers.length
    ? headers
    : BLACKLIST_DEFAULT_HEADERS;

  const values = {
    "Business Name": lead["Business Name"] || "",
    "Phone": lead["Phone"] || "",
    "Instagram ID": lead["Instagram ID"] || "",
    "Reason": reason,
    "Blacklisted At": nowStamp(),
  };

  return useHeaders.map((h) =>
    Object.prototype.hasOwnProperty.call(values, h)
      ? values[h]
      : ""
  );
}

// Clear the contents of a row without physically deleting it.
// Used when this is the last remaining real lead.
async function clearLeadRow(rowIndex) {
  const range =
    CONFIG.TABS.LEADS +
    "!A" +
    rowIndex +
    ":" +
    SheetsAPI.colLetter(leadHeaders, leadHeaders[leadHeaders.length - 1]) +
    rowIndex;

  const values = leadHeaders.map(() => "");

  const request = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${encodeURIComponent(
      range
    )}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: {
        ...Auth.authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        values: [values],
      }),
    }
  );

  if (!request.ok) {
    const body = await request.text();
    throw new Error(`Sheets API ${request.status}: ${body}`);
  }

  return request.json();
}

async function runDelete(leadId, businessName) {
  const table = await SheetsAPI.getTable(CONFIG.TABS.LEADS);
  leadHeaders = table.headers;

  const row = table.rows.find(
    (r) =>
      String(r["Lead ID"]).trim() === leadId &&
      String(r["Business Name"]).trim() === businessName
  );

  if (!row) {
    await refresh();
    throw new Error(
      "This lead no longer exists. The list has been refreshed."
    );
  }

  // Only real leads count here.
  const realLeads = table.rows.filter(isRealLead);

  if (realLeads.length <= 1) {
    // Google Sheets does not allow us to delete the final
    // non-frozen row. Clear its contents instead.
    await clearLeadRow(row.__rowIndex);
  } else {
    // There are other leads, so physically remove this row.
    await SheetsAPI.deleteRow(
      CONFIG.TABS.LEADS,
      row.__rowIndex
    );
  }

  await refresh();
}

async function runBlacklist(leadId, businessName, reason) {
  const row = await locateLead(leadId, businessName);

  if (!row) {
    await refresh();
    throw new Error(
      "This lead no longer exists. The list has been refreshed."
    );
  }

  const bl = await SheetsAPI.getTable(
    CONFIG.TABS.BLACKLISTED
  );

  await SheetsAPI.appendRow(
    CONFIG.TABS.BLACKLISTED,
    buildBlacklistRow(bl.headers, row, reason)
  );

  try {
    await SheetsAPI.deleteRow(
      CONFIG.TABS.LEADS,
      row.__rowIndex
    );
  } catch (e) {
    await refresh();

    throw new Error(
      "Added to Blacklisted, but could not remove it from Leads. Please delete it manually."
    );
  }

  await refresh();
}

// ---------- Confirmation popup ----------

function closeActionModal() {
  const el = document.getElementById("actionModal");

  if (el) {
    el.remove();
  }
}

function openActionModal(opts) {
  closeActionModal();

  const overlay = document.createElement("div");

  overlay.id = "actionModal";

  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(20,23,31,0.45);z-index:1000;" +
    "display:flex;align-items:center;justify-content:center;padding:20px;";

  const reasonField = opts.needReason
    ? '<div class="field"><label for="actionReason">Reason *</label>' +
      '<input type="text" id="actionReason" /></div>'
    : "";

  overlay.innerHTML =
    '<div style="background:#fff;border-radius:4px;padding:24px;width:100%;max-width:440px;">' +
    '<h2 style="font-family:var(--font-display);font-size:20px;margin:0 0 8px;">' +
    escapeHtml(opts.title) +
    "</h2>" +
    '<p style="margin:0 0 14px;font-size:14px;color:var(--ink-soft);">' +
    escapeHtml(opts.message) +
    "</p>" +
    reasonField +
    '<div id="actionError" style="color:var(--warn);font-size:13px;min-height:18px;margin-bottom:8px;"></div>' +
    '<div style="display:flex;gap:8px;">' +
    '<button id="actionConfirmBtn" class="' +
    (opts.danger ? "btn-stop" : "btn-primary") +
    '">' +
    escapeHtml(opts.confirmText) +
    "</button>" +
    '<button id="actionCancelBtn">Cancel</button>' +
    "</div></div>";

  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      closeActionModal();
    }
  });

  document
    .getElementById("actionCancelBtn")
    .addEventListener("click", closeActionModal);

  const confirmBtn = document.getElementById(
    "actionConfirmBtn"
  );

  const errorBox = document.getElementById("actionError");

  confirmBtn.addEventListener("click", async () => {
    const reasonEl = document.getElementById("actionReason");
    const reason = reasonEl
      ? reasonEl.value.trim()
      : "";

    if (opts.needReason && !reason) {
      errorBox.textContent = "Please enter a reason.";
      return;
    }

    errorBox.textContent = "";
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Working...";

    try {
      await opts.onConfirm(reason);
      closeActionModal();
    } catch (e) {
      console.error("Lead action failed:", e);

      errorBox.textContent =
        e.message || "Something went wrong.";

      confirmBtn.disabled = false;
      confirmBtn.textContent = opts.confirmText;
    }
  });

  const reasonEl = document.getElementById("actionReason");

  if (reasonEl) {
    reasonEl.focus();
  }
}

// One click listener for every Blacklist / Delete button.
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-lead-action]");

  if (!btn || !Auth.isEditor()) {
    return;
  }

  const rowNum = Number(
    btn.getAttribute("data-row")
  );

  const lead = allLeadRows.find(
    (r) => r.__rowIndex === rowNum
  );

  if (!lead) {
    return;
  }

  const leadId = String(
    lead["Lead ID"]
  ).trim();

  const name = String(
    lead["Business Name"]
  ).trim();

  const action = btn.getAttribute(
    "data-lead-action"
  );

  if (action === "delete") {
    openActionModal({
      title: "Delete this lead?",
      message:
        '"' +
        name +
        '" will be permanently removed from the Leads sheet. This cannot be undone.',
      confirmText: "Delete permanently",
      danger: true,
      onConfirm: () =>
        runDelete(leadId, name),
    });
  } else if (action === "blacklist") {
    openActionModal({
      title: "Blacklist this lead?",
      message:
        '"' +
        name +
        '" will be added to the Blacklisted tab and removed from Leads.',
      confirmText: "Blacklist",
      needReason: true,
      onConfirm: (reason) =>
        runBlacklist(
          leadId,
          name,
          reason
        ),
    });
  }
});

async function nextLeadId() {
  // Re-read the sheet right now, so the number is based
  // on the latest rows.
  const table = await SheetsAPI.getTable(
    CONFIG.TABS.LEADS
  );

  leadHeaders = table.headers;

  // Find the highest existing number, keeping its prefix
  // and zero-padding.
  // Old test IDs beginning with MANUAL- are ignored.
  let best = null;

  table.rows.forEach((r) => {
    const id = String(
      r["Lead ID"] || ""
    ).trim();

    if (id.toUpperCase().startsWith("MANUAL-")) {
      return;
    }

    const m = id.match(/^(.*?)(\d+)$/);

    if (!m) {
      return;
    }

    const num = parseInt(m[2], 10);

    if (best === null || num > best.num) {
      best = {
        prefix: m[1],
        num: num,
        width: m[2].length,
      };
    }
  });

  if (best === null) {
    return "LEAD-0001";
  }

  return (
    best.prefix +
    String(best.num + 1).padStart(
      best.width,
      "0"
    )
  );
}

// Find and permanently remove blank rows left behind by
// the backend's 48-hour cleanup.
async function scanBlankLeadRows() {
  const table = await SheetsAPI.getTable(
    CONFIG.TABS.LEADS
  );

  return table.rows
    .filter((r) => !isRealLead(r))
    .map((r) => r.__rowIndex);
}

async function openCleanupModal() {
  closeActionModal();

  const blankRows =
    await scanBlankLeadRows();

  openActionModal({
    title: "Clean up blank rows?",
    message:
      blankRows.length === 0
        ? "No blank rows were found in the Leads sheet."
        : "Found " +
          blankRows.length +
          " blank row(s) in the Leads sheet (e.g. row " +
          blankRows[0] +
          "). This permanently deletes them from Google Sheets, not just from this view.",
    confirmText:
      blankRows.length === 0
        ? "OK"
        : "Delete " +
          blankRows.length +
          " row(s)",
    danger: true,

    onConfirm: async () => {
      if (blankRows.length === 0) {
        return;
      }

      await SheetsAPI.deleteRows(
        CONFIG.TABS.LEADS,
        blankRows
      );

      await refresh();
    },
  });
}
// Find every currently unapproved real lead, for the
// "Remove unapproved leads" button. Bypasses the normal
// 48-hour wait entirely — this deletes right now.
async function scanUnapprovedLeadRows() {
  const table = await SheetsAPI.getTable(CONFIG.TABS.LEADS);

  return table.rows
    .filter((r) => isRealLead(r) && !truthy(r["Approve"]))
    .map((r) => ({
      rowIndex: r.__rowIndex,
      businessName: String(r["Business Name"] || "").trim(),
    }));
}

async function openRemoveUnapprovedModal() {
  closeActionModal();

  const unapproved = await scanUnapprovedLeadRows();

  openActionModal({
    title: "Remove all unapproved leads?",
    message:
      unapproved.length === 0
        ? "No unapproved leads were found in the Leads sheet."
        : "Found " +
          unapproved.length +
          ' unapproved lead(s) (e.g. "' +
          (unapproved[0].businessName || "unnamed") +
          '"). This permanently deletes them from Google Sheets right now, regardless of the normal 48-hour wait. This cannot be undone.',
    confirmText:
      unapproved.length === 0
        ? "OK"
        : "Delete " + unapproved.length + " lead(s)",
    danger: true,

    onConfirm: async () => {
      if (unapproved.length === 0) {
        return;
      }

      await SheetsAPI.deleteRows(
        CONFIG.TABS.LEADS,
        unapproved.map((u) => u.rowIndex)
      );

      await refresh();
    },
  });
}