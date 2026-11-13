// ============================================================
// TEAM PAGE — Owner only. Add/remove teammates and set their rank
// (Editor / Viewer) and whether they can approve delete/blacklist
// requests. auth.js enforces this list at sign-in.
//
// Adding someone here only controls what they can do INSIDE this
// site. They also need real Viewer/Editor access to the Google
// Sheet itself (Share button in Google Sheets) -- Google remains
// the final authority on who can read or write the data.
// The Owner (CONFIG.OWNER_EMAIL) always has access and needs no row.
// ============================================================

const TEAM_DEFAULT_HEADERS = ["Email", "Rank", "Can Approve", "Added By", "Added At"];

let allTeamRows = [];
let teamHeaders = [];

// Header names are matched ignoring case and stray spaces, so a sheet
// header typed as "Added by" still works as "Added By".
function field(row, name) {
  const key = Object.keys(row).find(
    (k) => k.trim().toLowerCase() === name.toLowerCase()
  );
  return key === undefined ? "" : row[key];
}

function headerFor(headers, name) {
  return headers.find((h) => String(h).trim().toLowerCase() === name.toLowerCase());
}

Auth.requireSession(() => {
  renderShell("team.html");

  if (!Auth.isOwner()) {
    document.getElementById("mainContent").innerHTML = `
      <div class="page-head"><div><h1>Team</h1></div></div>
      <div class="panel"><div class="empty-state">Only the Owner can manage the team.</div></div>
    `;
    return;
  }

  document.getElementById("mainContent").innerHTML = `
    <div class="page-head">
      <div>
        <h1>Team</h1>
        <div class="sub">Who can sign in, their rank, and who can approve delete/blacklist requests</div>
      </div>
      <button class="btn-primary" id="addMemberBtn">+ Add teammate</button>
    </div>
    <div class="panel">
      <p class="sub" style="margin:0 0 14px;font-size:13px;">
        Owner: <strong>${escapeHtml(CONFIG.OWNER_EMAIL)}</strong> — always has full access.
        Teammates below also need the Google Sheet shared with them.
      </p>
      <div id="teamTableWrap">Loading…</div>
    </div>
  `;

  document.getElementById("addMemberBtn").addEventListener("click", () => openMemberModal());

  startPolling(refresh, CONFIG.POLL_INTERVAL_MS);
});

async function refresh() {
  try {
    const table = await SheetsAPI.getTable(CONFIG.TABS.TEAM);
    teamHeaders = table.headers;
    allTeamRows = table.rows.filter((r) => String(field(r, "Email") || "").trim() !== "");
    renderTable();
  } catch (e) {
    console.error("Team refresh failed:", e);
    document.getElementById("teamTableWrap").innerHTML =
      '<div class="empty-state">Could not read the "' + escapeHtml(CONFIG.TABS.TEAM) +
      '" tab. Create it with the headers: ' + escapeHtml(TEAM_DEFAULT_HEADERS.join(" | ")) + "</div>";
  }
}

function renderTable() {
  if (allTeamRows.length === 0) {
    document.getElementById("teamTableWrap").innerHTML =
      '<div class="empty-state">No teammates added yet.</div>';
    return;
  }

  const rowsHtml = allTeamRows
    .map((r) => {
      const rank = String(field(r, "Rank") || "").trim();
      const canApprove =
        rank.toLowerCase() === "editor" && truthy(field(r, "Can Approve")) ? "Yes" : "No";

      return `
      <tr>
        <td>${escapeHtml(field(r, "Email"))}</td>
        <td>${escapeHtml(rank)}</td>
        <td>${canApprove}</td>
        <td>${escapeHtml(field(r, "Added By"))}</td>
        <td>${escapeHtml(field(r, "Added At"))}</td>
        <td style="white-space:nowrap;">
          <button class="btn-quiet" data-team-action="edit" data-row="${r.__rowIndex}" style="padding:4px 8px;">Edit</button>
          <button class="btn-quiet" data-team-action="remove" data-row="${r.__rowIndex}" style="padding:4px 8px;color:var(--warn);">Remove</button>
        </td>
      </tr>`;
    })
    .join("");

  document.getElementById("teamTableWrap").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Email</th><th>Rank</th><th>Can approve</th>
          <th>Added by</th><th>Added at</th><th></th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-team-action]");
  if (!btn || !Auth.isOwner()) return;

  const rowNum = Number(btn.getAttribute("data-row"));
  const member = allTeamRows.find((r) => r.__rowIndex === rowNum);
  if (!member) return;

  const action = btn.getAttribute("data-team-action");

  if (action === "edit") {
    openMemberModal(member);
  } else if (action === "remove") {
    if (confirm(`Remove ${field(member, "Email")} from the team? They will no longer be able to sign in.`)) {
      btn.disabled = true;
      try {
        // Re-read first: row numbers shift if the sheet changed.
        const table = await SheetsAPI.getTable(CONFIG.TABS.TEAM);
        const current = table.rows.find(
          (r) =>
            String(field(r, "Email")).trim().toLowerCase() ===
            String(field(member, "Email")).trim().toLowerCase()
        );
        if (current) {
          await SheetsAPI.deleteRow(CONFIG.TABS.TEAM, current.__rowIndex);
        }
        await refresh();
      } catch (err) {
        console.error("Remove teammate failed:", err);
        alert("Could not remove this teammate. Check the browser console for details.");
      } finally {
        btn.disabled = false;
      }
    }
  }
});

function closeMemberModal() {
  const el = document.getElementById("memberModal");
  if (el) el.remove();
}

// Pass an existing Team row to edit rank / can-approve (the email is
// fixed once added). Leave empty to add a new teammate.
function openMemberModal(existingMember) {
  closeMemberModal();

  const isEdit = Boolean(existingMember);

  const overlay = document.createElement("div");
  overlay.id = "memberModal";
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(20,23,31,0.45);z-index:1000;" +
    "display:flex;align-items:center;justify-content:center;padding:20px;";

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:4px;padding:24px;width:100%;max-width:440px;max-height:90vh;overflow:auto;">
      <h2 style="font-family:var(--font-display);font-size:20px;margin:0 0 8px;">${isEdit ? "Edit teammate" : "Add a teammate"}</h2>
      <p class="sub" style="margin:0 0 16px;font-size:13px;">
        They also need Viewer or Editor access to the Google Sheet itself —
        this only controls what they can do inside this site.
      </p>
      <div class="field">
        <label for="m_email">Gmail address *</label>
        <input type="text" id="m_email" ${isEdit ? "disabled" : ""} />
      </div>
      <div class="field">
        <label for="m_rank">Rank *</label>
        <select id="m_rank">
          <option value="Editor">Editor — can add, edit and request deletes</option>
          <option value="Viewer">Viewer — read only</option>
        </select>
      </div>
      <div class="field" style="display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="m_canApprove" style="width:auto;" />
        <label style="margin:0;" for="m_canApprove">Can approve delete/blacklist requests (Editors only)</label>
      </div>
      <div id="memberFormError" style="color:var(--warn);font-size:13px;min-height:18px;margin-bottom:8px;"></div>
      <div style="display:flex;gap:8px;">
        <button class="btn-primary" id="saveMemberBtn">${isEdit ? "Save changes" : "Add teammate"}</button>
        <button id="cancelMemberBtn">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeMemberModal();
  });
  document.getElementById("cancelMemberBtn").addEventListener("click", closeMemberModal);

  const rankEl = document.getElementById("m_rank");
  const approveEl = document.getElementById("m_canApprove");

  // Only Editors can be approvers.
  function syncApprove() {
    if (rankEl.value !== "Editor") {
      approveEl.checked = false;
      approveEl.disabled = true;
    } else {
      approveEl.disabled = false;
    }
  }
  rankEl.addEventListener("change", syncApprove);

  if (isEdit) {
    document.getElementById("m_email").value = field(existingMember, "Email") || "";
    const rank = String(field(existingMember, "Rank") || "").trim().toLowerCase();
    rankEl.value = rank === "viewer" ? "Viewer" : "Editor";
    approveEl.checked = truthy(field(existingMember, "Can Approve"));
  }
  syncApprove();

  document.getElementById("saveMemberBtn").addEventListener("click", () => {
    if (isEdit) {
      saveEditedMember(existingMember);
    } else {
      saveNewMember();
    }
  });

  document.getElementById(isEdit ? "m_rank" : "m_email").focus();
}

async function saveNewMember() {
  const errorBox = document.getElementById("memberFormError");
  const btn = document.getElementById("saveMemberBtn");

  const email = document.getElementById("m_email").value.trim().toLowerCase();
  const rank = document.getElementById("m_rank").value;
  const canApprove = document.getElementById("m_canApprove").checked;

  if (!email || !email.includes("@") || email.includes(" ")) {
    errorBox.textContent = "Enter a valid Gmail address.";
    return;
  }
  if (email === CONFIG.OWNER_EMAIL.toLowerCase()) {
    errorBox.textContent = "That's the Owner account — it always has full access.";
    return;
  }

  errorBox.textContent = "";
  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    // Re-read so duplicates and header order are checked against the sheet now.
    const table = await SheetsAPI.getTable(CONFIG.TABS.TEAM);
    teamHeaders = table.headers;

    if (table.rows.some((r) => String(field(r, "Email")).trim().toLowerCase() === email)) {
      errorBox.textContent = "This email is already on the team.";
      btn.disabled = false;
      btn.textContent = "Add teammate";
      return;
    }

    const useHeaders = teamHeaders.length ? teamHeaders : TEAM_DEFAULT_HEADERS;

    const values = {
      "Email": email,
      "Rank": rank,
      "Can Approve": rank === "Editor" && canApprove ? "TRUE" : "FALSE",
      "Added By": Auth.getEmail() || "",
      "Added At": nowStamp(),
    };

    const lowerValues = {};
    Object.keys(values).forEach((k) => (lowerValues[k.toLowerCase()] = values[k]));

    const row = useHeaders.map((h) => {
      const key = String(h).trim().toLowerCase();
      return Object.prototype.hasOwnProperty.call(lowerValues, key) ? lowerValues[key] : "";
    });

    await SheetsAPI.appendRow(CONFIG.TABS.TEAM, row);
    closeMemberModal();
    await refresh();
  } catch (e) {
    console.error("Add teammate failed:", e);
    errorBox.textContent =
      'Could not add this teammate. Check that the "' + CONFIG.TABS.TEAM +
      '" tab exists with its header row.';
    btn.disabled = false;
    btn.textContent = "Add teammate";
  }
}

async function saveEditedMember(existingMember) {
  const errorBox = document.getElementById("memberFormError");
  const btn = document.getElementById("saveMemberBtn");

  const rank = document.getElementById("m_rank").value;
  const canApprove = rank === "Editor" && document.getElementById("m_canApprove").checked;

  errorBox.textContent = "";
  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    const table = await SheetsAPI.getTable(CONFIG.TABS.TEAM);
    teamHeaders = table.headers;

    const current = table.rows.find(
      (r) =>
        String(field(r, "Email")).trim().toLowerCase() ===
        String(field(existingMember, "Email")).trim().toLowerCase()
    );
    if (!current) {
      await refresh();
      throw new Error("This teammate no longer exists.");
    }

    const rankCol = SheetsAPI.colLetter(teamHeaders, headerFor(teamHeaders, "Rank"));
    const approveCol = SheetsAPI.colLetter(teamHeaders, headerFor(teamHeaders, "Can Approve"));

    const updates = [];
    if (rankCol) {
      updates.push(SheetsAPI.updateCell(`${CONFIG.TABS.TEAM}!${rankCol}${current.__rowIndex}`, rank));
    }
    if (approveCol) {
      updates.push(
        SheetsAPI.updateCell(
          `${CONFIG.TABS.TEAM}!${approveCol}${current.__rowIndex}`,
          canApprove ? "TRUE" : "FALSE"
        )
      );
    }

    await Promise.all(updates);
    closeMemberModal();
    await refresh();
  } catch (e) {
    console.error("Edit teammate failed:", e);
    errorBox.textContent = e.message || "Could not save changes. Check the browser console for details.";
    btn.disabled = false;
    btn.textContent = "Save changes";
  }
}