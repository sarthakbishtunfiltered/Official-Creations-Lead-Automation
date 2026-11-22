// ============================================================
// LEADS PAGE
// ============================================================

const LEAD_FORM_FIELDS = [
  { id: "f_business", label: "Business name *", col: "Business Name", placeholder: "e.g. Sharma Interiors" },
  { id: "f_industry", label: "Industry", col: "Industry" },
  { id: "f_location", label: "Location *", col: "Location", placeholder: "e.g. Pune" },
  { id: "f_phone", label: "Phone", col: "Phone", type: "tel", placeholder: "e.g. 98765 43210" },
  { id: "f_instagram", label: "Instagram ID", col: "Instagram ID", placeholder: "e.g. sharma.interiors" },
  { id: "f_opportunity", label: "Opportunity / notes *", col: "Opportunity", placeholder: "e.g. No website, active on Instagram" },
];

let allLeadRows = [];
let leadHeaders = [];

// Lead assignment. Needs an "Assigned To" header on the Leads sheet;
// without it the assignment UI stays hidden.
const ASSIGN_COL = "Assigned To";
let teamMembers = [];                  // emails a lead can be assigned to

Auth.requireSession(() => {
  renderShell("frontend/leads.html");
  const isEditor = Auth.isEditor();
  const notifyConfigured = !!(CONFIG.NOTIFY_WEBHOOK_URL && CONFIG.NOTIFY_WEBHOOK_URL.trim());

  document.getElementById("mainContent").innerHTML = `
    <div class="page-head">
      <div>
        <h1>Leads</h1>
        <div class="sub">Full lead database, synced live with Google Sheets</div>
      </div>
      <div class="head-actions">
      ${isEditor ? '<button class="btn-primary" id="addLeadBtn">+ Add lead manually</button> <button class="btn-quiet" id="cleanupBtn">Clean up blank rows</button>' + (Auth.canApprove() ? ' <button class="btn-quiet" id="removeUnapprovedBtn" style="color:var(--warn);">Remove unapproved leads</button>' : "") + (notifyConfigured ? ' <button class="btn-quiet" id="sendNotifyBtn">Send notifications now</button>' : "") : ""}
      ${Auth.canApprove() ? '<button class="btn-quiet" id="manageCyclesBtn">Manage cycles</button>' : ""}
      </div>
      </div>
    </div>

    <div class="panel">
      <div class="pipe-tabs" id="pipeTabs"></div>
      <div class="pipe-warn hidden" id="pipeWarn"></div>
      <div class="pipe-notice hidden" id="pipeNotice"></div>
      <div class="toolbar">
        <input type="text" id="searchInput" placeholder="Search business, industry, location…" />
        <select id="statusFilter">
          <option value="">All statuses</option>
          <option value="approved">Approved / qualified</option>
          <option value="pending">Pending review</option>
        </select>
        <select id="assigneeFilter" class="hidden" data-avatar="1"></select>
        <select id="cycleFilter" class="hidden"></select>
        <button class="btn-primary hidden" id="bulkCycleBtn"></button>
      </div>
      <div id="leadsTableWrap">Loading…</div>
    </div>
  `;

  if (isEditor) {
    document.getElementById("addLeadBtn").addEventListener("click", () => openLeadModal());

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

    // Bulk-deleting is a delete too, so it is limited to the Owner and
    // approvers; other editors request deletes one lead at a time.
    if (Auth.canApprove()) document.getElementById("removeUnapprovedBtn").addEventListener("click", async () => {
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

    if (notifyConfigured) {
      document.getElementById("sendNotifyBtn").addEventListener("click", async () => {
        const btn = document.getElementById("sendNotifyBtn");
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Sending…";

        // On Round 2 / Round 3 / Call Rejected ... the same button sends that
        // stage's notifications; the result shows in the notice line.
        if (Pipeline.isStageTab()) {
          try {
            await Pipeline.notifyCurrentStage();
          } finally {
            btn.disabled = false;
            Pipeline.syncNotifyButton();
          }
          return;
        }

        try {
          const result = await runNotifyNow();
          btn.textContent =
            result && typeof result.sent === "number"
              ? `Sent ${result.sent}` + (result.retried ? `, ${result.retried} to retry` : "")
              : "Sent";
        } catch (e) {
          console.error("Send notifications failed:", e);
          btn.textContent = "Failed — see console";
        } finally {
          setTimeout(() => {
            btn.disabled = false;
            btn.textContent = original;
            Pipeline.syncNotifyButton();
          }, 3000);
        }
      });
    }
  }

  document.getElementById("searchInput").addEventListener("input", renderTable);
  document.getElementById("statusFilter").addEventListener("change", renderTable);
  document.getElementById("assigneeFilter").addEventListener("change", renderTable);
  document.getElementById("cycleFilter").addEventListener("change", renderTable);
  document.getElementById("bulkCycleBtn").addEventListener("click", () => Pipeline.openBulkModal());

  const manageBtn = document.getElementById("manageCyclesBtn");
  if (manageBtn) manageBtn.addEventListener("click", () => Pipeline.openCyclesModal().then(refresh));

  document.getElementById("pipeTabs").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]");
    if (!tab) return;
    Pipeline.setTab(tab.getAttribute("data-tab"));
    Pipeline.renderTabs();
    renderTable();
  });

  startPolling(refresh, CONFIG.POLL_INTERVAL_MS);
});

async function refresh() {
  try {
    const [table, people] = await Promise.all([
      SheetsAPI.getTable(CONFIG.TABS.LEADS),
      loadAssignableTeam(),
      Pipeline.loadCycles(),
    ]);
    teamMembers = people;
    leadHeaders = table.headers;
    allLeadRows = table.rows.filter(isRealLead).sort((a, b) => b.__rowIndex - a.__rowIndex);

    renderAssigneeFilter();
    Pipeline.renderTabs();
    Pipeline.renderCycleFilter();
    renderTable();
  } catch (e) {
    console.error("Leads refresh failed:", e);
  }
}

function renderTable() {
  const search = document.getElementById("searchInput").value.trim().toLowerCase();
  const statusFilter = document.getElementById("statusFilter").value;
  const assigneeFilter = document.getElementById("assigneeFilter").value;
  const isEditor = Auth.isEditor();
  const hasAssignCol = leadHeaders.some((h) => String(h).trim() === ASSIGN_COL);
  const canAssign = hasAssignCol && Auth.canApprove();

  const rows = allLeadRows.filter((r) => {
    if (!Pipeline.matches(r)) return false;
    const haystack = (r["Business Name"] + " " + r["Industry"] + " " + r["Location"]).toLowerCase();
    if (search && !haystack.includes(search)) return false;
    if (statusFilter === "approved" && !truthy(r["Approve"])) return false;
    if (statusFilter === "pending" && truthy(r["Approve"])) return false;
    if (hasAssignCol && assigneeFilter) {
      const a = normEmail(r[ASSIGN_COL]);
      if (assigneeFilter === "__me" && a !== normEmail(Auth.getEmail())) return false;
      if (assigneeFilter === "__none" && a) return false;
      if (!assigneeFilter.startsWith("__") && a !== normEmail(assigneeFilter)) return false;
    }
    return true;
  });

  if (rows.length === 0) {
    document.getElementById("leadsTableWrap").innerHTML =
      '<div class="empty-state">No leads match this view.</div>';
    Pipeline.afterRender([]);
    return;
  }

  const approveColLetter = SheetsAPI.colLetter(leadHeaders, "Approve");

  const rowsHtml = rows
    .map((r) => {
      const checked = truthy(r["Approve"]) ? "checked" : "";
      return `
      <tr>
        ${Pipeline.selectCell(r)}
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
        ${assignCellHtml(r, hasAssignCol, canAssign)}
        ${Pipeline.rowCells(r, isEditor)}
        ${isEditor ? `<td style="white-space:nowrap;">
          <button class="btn-quiet" data-lead-action="edit" data-row="${r.__rowIndex}" style="padding:4px 8px;">Edit</button>
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
          ${Pipeline.selectHead()}<th>Keep</th><th>Lead ID</th><th>Business</th><th>Industry</th>
          <th>Location</th><th>Phone</th><th>Source</th><th>Score</th>
                    <th>Priority</th><th>Status</th>${hasAssignCol ? "<th>Assigned to</th>" : ""}${Pipeline.headCells(isEditor)}${isEditor ? "<th></th>" : ""}
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;

  attachAssignmentHandlers();
  Pipeline.afterRender(rows);

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

// Pass an existing lead row (from allLeadRows) to open this same form
// in edit mode, prefilled with its current values. Leave empty/undefined
// for the normal "Add lead manually" flow.
function openLeadModal(existingLead) {
  closeLeadModal();

  const isEdit = Boolean(existingLead);

  const fieldsHtml = LEAD_FORM_FIELDS.map((f) => {
    if (f.id === "f_industry") {
      const fixed = industryOptions();
      const opt = (name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;

      return `
      <div class="field">
        <label for="f_industry">${f.label}</label>
        <select id="f_industry" data-placeholder="Select an industry">
          <option value="">No industry</option>
          <optgroup label="Our industries">${fixed.map(opt).join("")}</optgroup>
          <optgroup label="Not listed?">
            <option value="__other">+ Add new industry…</option>
          </optgroup>
        </select>
        <input type="text" id="f_industry_other" class="hidden" placeholder="Type the industry" style="margin-top:8px;" />
      </div>`;
    }

    return `
      <div class="field">
        <label for="${f.id}">${f.label}</label>
        <input type="${f.type || "text"}" id="${f.id}" placeholder="${escapeHtml(f.placeholder || "")}" />
      </div>`;
  }).join("");

  const overlay = document.createElement("div");
  overlay.id = "leadModal";
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(20,23,31,0.45);z-index:1000;" +
    "display:flex;align-items:center;justify-content:center;padding:20px;";

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:4px;padding:24px;width:100%;max-width:480px;max-height:90vh;overflow:auto;">
      <h2 style="font-family:var(--font-display);font-size:20px;margin:0 0 4px;">${isEdit ? "Edit lead" : "Add a lead manually"}</h2>
      <p class="sub" style="margin:0 0 16px;font-size:13px;">
        ${isEdit
          ? "Changes are saved straight back to this row in the Leads sheet."
          : "Saved straight to the Leads sheet as a qualified lead."}
        Provide a phone number or an Instagram ID.
      </p>
      ${fieldsHtml}${assignFieldHtml(existingLead)}${Pipeline.cycleFieldHtml(existingLead)}
      <div id="leadFormError" style="color:var(--warn);font-size:13px;min-height:18px;margin-bottom:8px;"></div>
      <div style="display:flex;gap:8px;">
        <button class="btn-primary" id="saveLeadBtn">${isEdit ? "Save changes" : "Save lead"}</button>
        <button id="cancelLeadBtn">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeLeadModal();
  });
  document.getElementById("cancelLeadBtn").addEventListener("click", closeLeadModal);
  document.getElementById("saveLeadBtn").addEventListener("click", () => {
    if (isEdit) {
      saveEditedLead(existingLead);
    } else {
      saveManualLead();
    }
  });
  document.addEventListener("keydown", onModalKey);

  if (isEdit) {
    LEAD_FORM_FIELDS.forEach((f) => {
      const el = document.getElementById(f.id);

      if (f.id === "f_industry") {
        const want = String(existingLead[f.col] || "").trim().toLowerCase();
        const match = [...el.options].find((o) => o.value.toLowerCase() === want);
        if (match) {
          el.value = match.value;
        } else if (want) {
          // Not one of the listed niches: keep it as a typed-in industry.
          el.value = "__other";
          const other = document.getElementById("f_industry_other");
          other.value = String(existingLead[f.col] || "").trim();
          other.classList.remove("hidden");
        } else {
          el.value = "";
        }
      } else {
        el.value = existingLead[f.col] || "";
      }
    });
  }

  const assignEl = document.getElementById("f_assign");
  if (isEdit && assignEl) assignEl.value = normEmail(existingLead[ASSIGN_COL]);
  if (isEdit) Pipeline.setCycleField(existingLead);

  syncDropdowns();

  document.getElementById("f_industry").addEventListener("change", (e) => {
    const other = document.getElementById("f_industry_other");
    other.classList.toggle("hidden", e.target.value !== "__other");
    if (e.target.value === "__other") other.focus();
  });

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

    // Checks the chosen cycle's niche and free slots (and may fill an empty industry).
    const cyc = await Pipeline.resolveCycle(Pipeline.cycleValue() || "", industryValue(), null);

    const leadId = await nextLeadId();

    const valuesByHeader = {
      "Lead ID": leadId,
      "Business Name": business,
      "Industry": cyc.industry,
      "Location": location,
      "Phone": phone,
      "Instagram ID": instagram,
      "Lead Source": "Manual (Web)",
      "Opportunity": opportunity,
      "Assigned To": assignValue() || "",
      "Approve": "TRUE",
      "Status": "Active",
      "Created At": new Date().toISOString(),
      "Stage": "Round 1",
      "Cycle": cyc.cycleId,
    };

    // Header names are matched ignoring case and stray spaces.
    const byLower = {};
    Object.entries(valuesByHeader).forEach(([k, v]) => (byLower[k.toLowerCase()] = v));

    const row = leadHeaders.map((h) => {
      const k = String(h).trim().toLowerCase();
      return Object.prototype.hasOwnProperty.call(byLower, k) ? byLower[k] : "";
    });

    await SheetsAPI.appendRow(CONFIG.TABS.LEADS, row);
    closeLeadModal();
    await refresh();
    Pipeline.afterCycleAdded(cyc.cycleId);
  } catch (e) {
    console.error("Save lead failed:", e);
    // Our own validation messages (cycle full / wrong niche) are readable;
    // raw API errors are not, so those stay generic.
    errorBox.textContent =
      e.message && !/^Sheets API|^Failed to fetch/.test(e.message)
        ? e.message
        : "Could not save the lead. Check the browser console for details.";
    btn.disabled = false;
    btn.textContent = "Save lead";
  }
}

// Writes the edit form's values back onto the lead's current row.
// Re-locates the row by Lead ID + Business Name first (same approach
// as runDelete/runBlacklist in lead-actions.js) since row numbers can
// shift if other rows were deleted since the table was last loaded.
async function saveEditedLead(existingLead) {
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
    const row = await locateLead(
      String(existingLead["Lead ID"]).trim(),
      String(existingLead["Business Name"]).trim()
    );

    if (!row) {
      await refresh();
      throw new Error("This lead no longer exists. The list has been refreshed.");
    }

    if (leadHeaders.length === 0) {
      const table = await SheetsAPI.getTable(CONFIG.TABS.LEADS);
      leadHeaders = table.headers;
    }

    // Only Owner/approvers see the Cycle field; others leave Cycle alone.
    const chosenCycle = Pipeline.cycleValue();
    const cyc = chosenCycle === null
      ? { cycleId: null, industry: industryValue() }
      : await Pipeline.resolveCycle(chosenCycle, industryValue(), existingLead);

    const valuesByHeader = {
      "Business Name": business,
      "Industry": cyc.industry,
      "Location": location,
      "Phone": phone,
      "Instagram ID": instagram,
      "Opportunity": opportunity,
    };

    if (cyc.cycleId !== null) valuesByHeader["Cycle"] = cyc.cycleId;

    // Only Owner/approvers see the Assign field; others leave it alone.
    if (assignValue() !== null) valuesByHeader[ASSIGN_COL] = assignValue();

    const updates = Object.entries(valuesByHeader)
      .map(([col, value]) => {
        const actual = leadHeaders.find(
          (h) => String(h).trim().toLowerCase() === col.toLowerCase()
        );
        const colLetter = actual ? SheetsAPI.colLetter(leadHeaders, actual) : null;
        if (!colLetter) return null;
        return SheetsAPI.updateCell(
          CONFIG.TABS.LEADS + "!" + colLetter + row.__rowIndex,
          value
        );
      })
      .filter(Boolean);

    await Promise.all(updates);

    const prevCycle = String(existingLead["Cycle"] || "").trim().toLowerCase();
    closeLeadModal();
    await refresh();
    if (cyc.cycleId && cyc.cycleId.toLowerCase() !== prevCycle) Pipeline.afterCycleAdded(cyc.cycleId);
  } catch (e) {
    console.error("Save lead edit failed:", e);
    errorBox.textContent = e.message || "Could not save changes. Check the browser console for details.";
    btn.disabled = false;
    btn.textContent = "Save changes";
  }
}

// ============================================================
// INDUSTRY DROPDOWN
// Options are the distinct industries already used on the Leads
// sheet (case-insensitive), plus "Other" to type a new one.
// ============================================================

// The dropdown offers only the niches listed in CONFIG.INDUSTRIES
// (config.js). Anything else is typed via "Add new industry".
function industryOptions() {
  return (CONFIG.INDUSTRIES || []).slice();
}

function industryValue() {
  const sel = document.getElementById("f_industry");

  if (sel.value !== "__other") return sel.value.trim();

  const typed = document.getElementById("f_industry_other").value.trim();

  // Typing an industry that is already listed reuses the listed spelling.
  const existing = [...sel.options].find(
    (o) => o.value && o.value !== "__other" && o.value.toLowerCase() === typed.toLowerCase()
  );

  return existing ? existing.value : typed;
}

// "Assign to" dropdown inside the Add / Edit lead form.
// Only Owner/approvers get it, and only if the sheet has the column.
function assignFieldHtml(existingLead) {
  const hasCol = leadHeaders.some((h) => String(h).trim() === ASSIGN_COL);
  if (!hasCol || !Auth.canApprove()) return "";

  const current = existingLead ? normEmail(existingLead[ASSIGN_COL]) : "";
  const list = teamMembers.slice();
  if (current && !list.includes(current)) list.push(current);

  const options =
    '<option value="">Unassigned</option>' +
    list.map((e) => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join("");

  return `
      <div class="field">
        <label for="f_assign">Assign to</label>
        <select id="f_assign" data-avatar="1" data-placeholder="Select a teammate (optional)">${options}</select>
      </div>`;
}

// null = the form has no Assign field (so leave Assigned To untouched).
function assignValue() {
  const el = document.getElementById("f_assign");
  return el ? el.value : null;
}

// ============================================================
// LEAD ASSIGNMENT
// ============================================================

function normEmail(v) {
  return String(v || "").trim().toLowerCase();
}

// The Owner plus every Team member whose rank is Editor.
async function loadAssignableTeam() {
  const people = [normEmail(CONFIG.OWNER_EMAIL)];

  try {
    const t = await SheetsAPI.getTable(CONFIG.TABS.TEAM);

    t.rows.forEach((r) => {
      const get = (name) => {
        const k = Object.keys(r).find((x) => x.trim().toLowerCase() === name);
        return k === undefined ? "" : r[k];
      };
      const email = normEmail(get("email"));

      if (email && normEmail(get("rank")) === "editor" && !people.includes(email)) {
        people.push(email);
      }
    });
  } catch (e) {
    console.error("Team list load failed:", e);
  }

  return people;
}

function renderAssigneeFilter() {
  const sel = document.getElementById("assigneeFilter");
  if (!sel) return;

  const hasCol = leadHeaders.some((h) => String(h).trim() === ASSIGN_COL);
  sel.classList.toggle("hidden", !hasCol);
  if (!hasCol) return;

  const keep = sel.value;

  sel.innerHTML =
    '<option value="">All assignees</option>' +
    '<option value="__me">My leads</option>' +
    '<option value="__none">Unassigned</option>' +
    teamMembers
      .map((e) => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`)
      .join("");

  sel.value = keep;
  syncDropdowns();
}

function assignCellHtml(r, hasCol, canAssign) {
  if (!hasCol) return "";

  const current = normEmail(r[ASSIGN_COL]);

  if (!canAssign) {
    return `<td>${escapeHtml(current || "—")}</td>`;
  }

  const list = teamMembers.slice();
  if (current && !list.includes(current)) list.push(current);

  const options =
    '<option value="">Unassigned</option>' +
    list
      .map(
        (e) =>
          `<option value="${escapeHtml(e)}" ${e === current ? "selected" : ""}>${escapeHtml(e)}</option>`
      )
      .join("");

  return `<td><select class="assignSelect" data-avatar="1" data-row="${r.__rowIndex}">${options}</select></td>`;
}

function attachAssignmentHandlers() {
  document.querySelectorAll(".assignSelect").forEach((sel) => {
    sel.addEventListener("change", async (e) => {
      const el = e.target;
      const lead = allLeadRows.find((r) => r.__rowIndex === Number(el.getAttribute("data-row")));
      if (!lead) return;

      const value = el.value;
      el.disabled = true;

      try {
        // Re-locate by Lead ID + Business Name: row numbers can shift.
        const row = await locateLead(
          String(lead["Lead ID"]).trim(),
          String(lead["Business Name"]).trim()
        );
        if (!row) throw new Error("This lead no longer exists. The list has been refreshed.");

        const col = SheetsAPI.colLetter(leadHeaders, ASSIGN_COL);
        await SheetsAPI.updateCell(`${CONFIG.TABS.LEADS}!${col}${row.__rowIndex}`, value);

        lead[ASSIGN_COL] = value;
        renderTable();
      } catch (err) {
        console.error("Assign lead failed:", err);
        alert(err.message || "Could not assign this lead. Check the browser console for details.");
        await refresh();
      }
    });
  });
}
