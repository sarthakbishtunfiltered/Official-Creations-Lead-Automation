// ============================================================
// APPROVALS PAGE — Owner + anyone flagged "Can Approve" on the Team
// tab review pending delete/blacklist requests submitted by other
// editors (see lead-actions.js: submitApprovalRequest).
//
// Self-contained: it does not need leads.js / lead-actions.js, so the
// delete/blacklist execution below is a small, deliberate copy of
// runDelete()/runBlacklist() in lead-actions.js.
// ============================================================

let allApprovalRows = [];
let approvalHeaders = [];

Auth.requireSession(() => {
  renderShell("approvals.html");

  if (!Auth.canApprove()) {
    document.getElementById("mainContent").innerHTML = `
      <div class="page-head"><div><h1>Approvals</h1></div></div>
      <div class="panel"><div class="empty-state">You don't have permission to approve requests.</div></div>
    `;
    return;
  }

  document.getElementById("mainContent").innerHTML = `
    <div class="page-head">
      <div>
        <h1>Approvals</h1>
        <div class="sub">Pending delete/blacklist requests from the team</div>
      </div>
    </div>
    <div class="panel">
      <div id="approvalsTableWrap">Loading…</div>
    </div>
  `;

  startPolling(refresh, CONFIG.POLL_INTERVAL_MS);
});

async function refresh() {
  try {
    const table = await SheetsAPI.getTable(CONFIG.TABS.APPROVALS);
    approvalHeaders = table.headers;
    allApprovalRows = table.rows;
    renderTable();
  } catch (e) {
    console.error("Approvals refresh failed:", e);
    document.getElementById("approvalsTableWrap").innerHTML =
      '<div class="empty-state">Could not read the "' + escapeHtml(CONFIG.TABS.APPROVALS) +
      '" tab. Check that it exists with its header row.</div>';
  }
}

function renderTable() {
  const pending = allApprovalRows.filter(
    (r) => String(r["Status"] || "").trim().toLowerCase() === "pending"
  );

  if (pending.length === 0) {
    document.getElementById("approvalsTableWrap").innerHTML =
      '<div class="empty-state">No pending requests.</div>';
    return;
  }

  const rowsHtml = pending
    .map((r) => {
      return `
      <tr>
        <td>${escapeHtml(r["Business Name"])}</td>
        <td>${escapeHtml(r["Action"])}</td>
        <td>${escapeHtml(r["Reason"])}</td>
        <td>${escapeHtml(r["Requested By"])}</td>
        <td>${escapeHtml(r["Requested At"])}</td>
        <td style="white-space:nowrap;">
          <button class="btn-primary" data-approval-action="approve" data-row="${r.__rowIndex}" style="padding:4px 8px;">Approve</button>
          <button class="btn-quiet" data-approval-action="reject" data-row="${r.__rowIndex}" style="padding:4px 8px;color:var(--warn);">Reject</button>
        </td>
      </tr>`;
    })
    .join("");

  document.getElementById("approvalsTableWrap").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Business</th><th>Action</th><th>Reason</th>
          <th>Requested by</th><th>Requested at</th><th></th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-approval-action]");
  if (!btn || !Auth.canApprove()) return;

  const rowNum = Number(btn.getAttribute("data-row"));
  const shown = allApprovalRows.find((r) => r.__rowIndex === rowNum);
  if (!shown) return;

  const decision = btn.getAttribute("data-approval-action");
  const allButtons = document.querySelectorAll("[data-approval-action]");
  allButtons.forEach((b) => (b.disabled = true));

  try {
    // Re-read: someone else may have decided it, or rows may have moved.
    const table = await SheetsAPI.getTable(CONFIG.TABS.APPROVALS);
    approvalHeaders = table.headers;
    allApprovalRows = table.rows;

    const request = table.rows.find(
      (r) => String(r["Request ID"]).trim() === String(shown["Request ID"]).trim()
    );

    if (!request || String(request["Status"] || "").trim().toLowerCase() !== "pending") {
      await refresh();
      throw new Error("This request was already decided or removed. The list has been refreshed.");
    }

    if (decision === "approve") {
      await approveRequest(request);
    } else {
      await decideRequest(request, "Rejected");
    }
  } catch (err) {
    console.error("Approval decision failed:", err);
    alert(err.message || "Something went wrong. Check the browser console for details.");
  } finally {
    document.querySelectorAll("[data-approval-action]").forEach((b) => (b.disabled = false));
  }
});

async function approveRequest(request) {
  const leadId = String(request["Lead ID"] || "").trim();
  const businessName = String(request["Business Name"] || "").trim();
  const action = String(request["Action"] || "").trim().toLowerCase();

  if (action === "delete") {
    await executeApprovedDelete(leadId, businessName);
  } else if (action === "blacklist") {
    await executeApprovedBlacklist(leadId, businessName, request["Reason"] || "");
  } else {
    throw new Error("Unknown request action: " + action);
  }

  await decideRequest(request, "Approved");
}

async function decideRequest(request, status) {
  const statusCol = SheetsAPI.colLetter(approvalHeaders, "Status");
  const decidedByCol = SheetsAPI.colLetter(approvalHeaders, "Decided By");
  const decidedAtCol = SheetsAPI.colLetter(approvalHeaders, "Decided At");
  const tab = CONFIG.TABS.APPROVALS;
  const row = request.__rowIndex;

  const updates = [];
  if (statusCol) updates.push(SheetsAPI.updateCell(`${tab}!${statusCol}${row}`, status));
  if (decidedByCol) updates.push(SheetsAPI.updateCell(`${tab}!${decidedByCol}${row}`, Auth.getEmail() || ""));
  if (decidedAtCol) updates.push(SheetsAPI.updateCell(`${tab}!${decidedAtCol}${row}`, nowStamp()));

  await Promise.all(updates);
  await refresh();
}

function findLeadRow(table, leadId, businessName) {
  return table.rows.find(
    (r) =>
      String(r["Lead ID"]).trim() === leadId &&
      String(r["Business Name"]).trim() === businessName
  );
}

// If the lead is already gone, there is nothing left to delete and the
// request is simply marked Approved.
async function executeApprovedDelete(leadId, businessName) {
  const table = await SheetsAPI.getTable(CONFIG.TABS.LEADS);
  const row = findLeadRow(table, leadId, businessName);

  if (!row) return;

  if (table.rows.filter(isRealLead).length <= 1) {
    // Sheets will not delete the last non-frozen row; clear it instead
    // (same as clearLeadRow in lead-actions.js).
    const headers = table.headers;
    const lastCol = SheetsAPI.colLetter(headers, headers[headers.length - 1]);
    const range = `${CONFIG.TABS.LEADS}!A${row.__rowIndex}:${lastCol}${row.__rowIndex}`;

    const resp = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
      {
        method: "PUT",
        headers: { ...Auth.authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ values: [headers.map(() => "")] }),
      }
    );

    if (!resp.ok) {
      throw new Error(`Sheets API ${resp.status}: ${await resp.text()}`);
    }
  } else {
    await SheetsAPI.deleteRow(CONFIG.TABS.LEADS, row.__rowIndex);
  }
}

async function executeApprovedBlacklist(leadId, businessName, reason) {
  const table = await SheetsAPI.getTable(CONFIG.TABS.LEADS);
  const row = findLeadRow(table, leadId, businessName);

  if (!row) return;

  const bl = await SheetsAPI.getTable(CONFIG.TABS.BLACKLISTED);
  const useHeaders = bl.headers.length
    ? bl.headers
    : ["Business Name", "Phone", "Instagram ID", "Reason", "Blacklisted At"];

  const values = {
    "Business Name": row["Business Name"] || "",
    "Phone": row["Phone"] || "",
    "Instagram ID": row["Instagram ID"] || "",
    "Reason": reason,
    "Blacklisted At": nowStamp(),
  };

  await SheetsAPI.appendRow(
    CONFIG.TABS.BLACKLISTED,
    useHeaders.map((h) => (Object.prototype.hasOwnProperty.call(values, h) ? values[h] : ""))
  );

  try {
    await SheetsAPI.deleteRow(CONFIG.TABS.LEADS, row.__rowIndex);
  } catch (e) {
    throw new Error(
      "Added to Blacklisted, but could not remove it from Leads. Please delete it manually, then approve again."
    );
  }
}
