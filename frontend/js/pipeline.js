// ============================================================
// PIPELINE — sales stages and lead cycles for the Leads page.
//
// Loaded on frontend/leads.html BEFORE leads.js. It uses the globals
// that leads.js / lead-actions.js define (allLeadRows, leadHeaders,
// renderTable, refresh, locateLead) only when called, never at load.
//
// Leads sheet columns (add the headers you want; only "Stage" is
// required for the pipeline to work):
//   Stage | Stage Note | Stage Updated At | Stage Updated By | Recording | Cycle
// Cycles tab:  Cycle ID | Name | Number | Niche | Limit | Created By |
//              Created At | Sent At | Sent Count
// Optional "Stage History" tab:
//   Timestamp | Lead ID | Business Name | From | To | Note | By | Recording
// ============================================================

const Pipeline = (() => {
  const R1 = "Round 1";
  const REJ = "Call Rejected";
  const R2 = "Round 2";
  const R3 = "Round 3";
  const WON = "Existing Client";
  const R2REJ = "Round 2 Rejected";

  const ALL_STAGES = [R1, R2, R3, WON, REJ, R2REJ];

  // Tab order on the Leads page.
  const TABS = [
    { key: "all", label: "All" },
    { key: R1, label: "Round 1" },
    { key: R2, label: "Round 2" },
    { key: R3, label: "Round 3" },
    { key: WON, label: "Existing Clients" },
    { key: REJ, label: "Call Rejected" },
    { key: R2REJ, label: "Round 2 Rejected" },
  ];

  // What can be done to a lead in each stage.
  //   check      - shown as a checkbox (the "forward" step)
  //   needNote   - a reason is mandatory
  //   needRecording - call recording (link or file) is mandatory, except
  //                   for the Owner and approvers
  const MOVES = {
    [R1]: [
      { to: R2, label: "Interested", check: true },
      { to: REJ, label: "Call rejected", needNote: true, needRecording: true },
    ],
    [REJ]: [{ to: R1, label: "Reopen" }],
    [R2]: [
      { to: R3, label: "Meeting booked", check: true },
      { to: R2REJ, label: "Dropped", needNote: true },
    ],
    [R3]: [
      { to: WON, label: "Deal won", check: true },
      { to: R2REJ, label: "Dropped", needNote: true },
    ],
    [WON]: [{ to: R3, label: "Undo" }],
    [R2REJ]: [{ to: R2, label: "Reopen" }],
  };

  const STAGE_CLASS = {
    [R1]: "s-r1",
    [R2]: "s-r2",
    [R3]: "s-r3",
    [WON]: "s-won",
    [REJ]: "s-rej",
    [R2REJ]: "s-rej",
  };

  const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

  // An old deployed Apps Script ignores the newer actions and answers with
  // its "send pending approvals" result ({sent, retried}) instead.
  const STALE_WEBAPP =
    "Google is still running an OLD version of the Apps Script, so nothing was sent. In Apps Script: Deploy → Manage deployments → pencil → Version: New version → Deploy.";

  let activeTab = R1;
  let cycles = [];
  let cyclesOk = false; // Cycles tab exists and has headers
  let cyclesProblem = ""; // why it is not OK, shown in Manage cycles
  let historyOff = false; // Stage History tab missing -> stop trying
  const selected = new Set();
  let lastVisible = [];

  // ----------------------------------------------------------
  // small helpers
  // ----------------------------------------------------------

  const norm = (v) => String(v || "").trim().toLowerCase();

  // Case-insensitive column read from a sheet row object.
  function lf(row, name) {
    const k = Object.keys(row).find((x) => x.trim().toLowerCase() === name.toLowerCase());
    return k === undefined ? "" : String(row[k] ?? "");
  }

  // The header's real spelling in this sheet, or undefined.
  function hdr(headers, name) {
    return headers.find((h) => String(h).trim().toLowerCase() === name.toLowerCase());
  }

  function hasLeadCol(name) {
    return !!hdr(leadHeaders, name);
  }

  // Stops Sheets from treating typed text as a formula.
  function safeText(v) {
    const s = String(v ?? "");
    return /^[=+\-@]/.test(s) ? "'" + s : s;
  }

  function leadKey(r) {
    return String(r["Lead ID"]).trim() + "|" + String(r["Business Name"]).trim();
  }

  function stageOf(row) {
    const v = norm(lf(row, "Stage"));
    return ALL_STAGES.find((s) => s.toLowerCase() === v) || R1;
  }

  // ONE place that decides who may move a lead between stages.
  // Owner and approvers: any lead. Other editors: leads assigned to them.
  function canMoveStage(lead) {
    if (Auth.canApprove()) return true;
    if (!Auth.isEditor()) return false;
    return norm(lf(lead, "Assigned To")) === norm(Auth.getEmail());
  }

  function recordingUploadEnabled() {
    return !!String(CONFIG.RECORDINGS_FOLDER_ID || "").trim();
  }

  function cycleLabel(c) {
    return c.name + (c.number ? " #" + c.number : "");
  }

  function cycleById(id) {
    const want = norm(id);
    return cycles.find((c) => norm(c.id) === want) || null;
  }

  function cycleCount(id, rows) {
    const want = norm(id);
    return (rows || allLeadRows).filter((r) => norm(lf(r, "Cycle")) === want).length;
  }

  function stampNow() {
    return nowStamp();
  }

  // ----------------------------------------------------------
  // Cycles: load
  // ----------------------------------------------------------

  async function loadCycles() {
    try {
      if (!CONFIG.TABS.CYCLES) {
        throw new Error('config.js has no CYCLES entry inside TABS (add CYCLES: "Cycles",).');
      }
      const t = await SheetsAPI.getTable(CONFIG.TABS.CYCLES);
      cyclesProblem = t.headers.length ? "" : "The tab exists but row 1 is empty.";
      cyclesOk = t.headers.length > 0;
      cycles = t.rows
        .filter((r) => lf(r, "Cycle ID").trim())
        .map((r) => ({
          id: lf(r, "Cycle ID").trim(),
          name: lf(r, "Name").trim() || lf(r, "Cycle ID").trim(),
          number: lf(r, "Number").trim(),
          niche: lf(r, "Niche").trim(),
          limit: parseInt(lf(r, "Limit"), 10) || 0,
          sentAt: lf(r, "Sent At").trim(),
          sentCount: parseInt(lf(r, "Sent Count"), 10) || 0,
          __rowIndex: r.__rowIndex,
          __headers: t.headers,
        }));
    } catch (e) {
      cyclesOk = false;
      cycles = [];
      cyclesProblem = String(e.message || e).slice(0, 300);
      console.warn("Cycles tab could not be read:", cyclesProblem);
    }
  }

  // ----------------------------------------------------------
  // Notices (small status line above the table)
  // ----------------------------------------------------------

  let noticeTimer = null;

  function notice(msg, isErr) {
    const el = document.getElementById("pipeNotice");
    if (!el) return;
    clearTimeout(noticeTimer);
    el.className = "pipe-notice " + (isErr ? "err" : "ok");
    el.textContent = msg;
    el.classList.remove("hidden");
    noticeTimer = setTimeout(() => el.classList.add("hidden"), isErr ? 15000 : 8000);
  }

  // ----------------------------------------------------------
  // Tabs, filters and table columns (called from leads.js)
  // ----------------------------------------------------------

  function renderTabs() {
    const wrap = document.getElementById("pipeTabs");
    if (!wrap) return;

    const counts = { all: allLeadRows.length };
    ALL_STAGES.forEach((s) => (counts[s] = 0));
    allLeadRows.forEach((r) => counts[stageOf(r)]++);

    wrap.innerHTML = TABS.map(
      (t) =>
        `<button type="button" class="pipe-tab ${t.key === activeTab ? "active" : ""}" data-tab="${escapeHtml(t.key)}">` +
        `${escapeHtml(t.label)} <span class="pipe-count">${counts[t.key]}</span></button>`
    ).join("");

    const warn = document.getElementById("pipeWarn");
    if (warn) {
      const missing = [];
      if (leadHeaders.length && !hasLeadCol("Stage")) missing.push("Stage");
      warn.classList.toggle("hidden", missing.length === 0 || !Auth.isEditor());
      warn.textContent = missing.length
        ? 'The pipeline needs a "Stage" column. Add the header "Stage" to the Leads sheet (also "Stage Note", "Stage Updated At", "Stage Updated By", "Recording" and "Cycle" if you want those saved). Until then every lead shows as Round 1 and can\'t be moved.'
        : "";
    }
  }

  function renderCycleFilter() {
    const sel = document.getElementById("cycleFilter");
    if (!sel) return;

    const show = cyclesOk && cycles.length > 0 && hasLeadCol("Cycle");
    sel.classList.toggle("hidden", !show);
    if (!show) return;

    const keep = sel.value;
    sel.innerHTML =
      '<option value="">All cycles</option>' +
      '<option value="__none">No cycle</option>' +
      cycles
        .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(cycleLabel(c))}</option>`)
        .join("");
    sel.value = [...sel.options].some((o) => o.value === keep) ? keep : "";
    syncDropdowns();
  }

  function activeStageTab() {
    return activeTab;
  }

  // Does this lead belong in the current tab + cycle filter?
  function matches(r) {
    if (activeTab !== "all" && stageOf(r) !== activeTab) return false;

    const cf = document.getElementById("cycleFilter");
    const want = cf && !cf.classList.contains("hidden") ? cf.value : "";
    if (want) {
      const c = norm(lf(r, "Cycle"));
      if (want === "__none" ? c !== "" : c !== norm(want)) return false;
    }
    return true;
  }

  function showSelectColumn() {
    return Auth.canApprove() && cyclesOk && cycles.length > 0 && hasLeadCol("Cycle");
  }

  function showCycleColumn() {
    return hasLeadCol("Cycle");
  }

  function headCells(isEditor) {
    return (
      (showCycleColumn() ? "<th>Cycle</th>" : "") +
      "<th>Stage</th>" +
      (isEditor ? "<th>Move</th>" : "")
    );
  }

  function selectHead() {
    return showSelectColumn()
      ? '<th><input type="checkbox" id="selAllBox" title="Select all shown" /></th>'
      : "";
  }

  function selectCell(r) {
    if (!showSelectColumn()) return "";
    return `<td><input type="checkbox" class="selBox" data-key="${escapeHtml(leadKey(r))}" ${
      selected.has(leadKey(r)) ? "checked" : ""
    } /></td>`;
  }

  function moveControls(r) {
    const moves = MOVES[stageOf(r)] || [];
    const stageCol = hasLeadCol("Stage");
    const allowed = stageCol && canMoveStage(r);
    const why = !stageCol
      ? 'Add a "Stage" column to the Leads sheet first.'
      : "Only the assignee, the Owner or an approver can move this lead.";

    return moves
      .map((m) => {
        const attrs = `data-move-to="${escapeHtml(m.to)}" data-row="${r.__rowIndex}" ${
          allowed ? "" : `disabled title="${escapeHtml(why)}"`
        }`;
        return m.check
          ? `<label class="mv-check"><input type="checkbox" ${attrs} /> ${escapeHtml(m.label)}</label>`
          : `<button type="button" class="btn-quiet mv-btn" ${attrs}>${escapeHtml(m.label)}</button>`;
      })
      .join("");
  }

  // Which channels this lead was already announced on, for its CURRENT stage.
  //   Round 1: the existing "Slack Notified" / "Telegram Notified" columns.
  //   Others:  "Stage Slack Notified" / "Stage Telegram Notified" hold the
  //            stage that was sent; it counts only if it is the current one.
  function notifyState(r) {
    const stage = stageOf(r);
    if (stage === R1) {
      if (!hasLeadCol("Slack Notified") && !hasLeadCol("Telegram Notified")) return null;
      return { slack: truthy(lf(r, "Slack Notified")), telegram: truthy(lf(r, "Telegram Notified")) };
    }
    if (!hasLeadCol("Stage Slack Notified") && !hasLeadCol("Stage Telegram Notified")) return null;
    return {
      slack: norm(lf(r, "Stage Slack Notified")) === stage.toLowerCase(),
      telegram: norm(lf(r, "Stage Telegram Notified")) === stage.toLowerCase(),
    };
  }

  function notifyChips(r) {
    const st = notifyState(r);
    if (!st) return "";
    const chip = (label, on) =>
      `<span class="nchip ${on ? "on" : ""}" title="${on ? "Sent" : "Not sent yet"}">${label} ${on ? "✓" : "–"}</span>`;
    return `<div class="nchips">${chip("Slack", st.slack)}${chip("Telegram", st.telegram)}</div>`;
  }

  function fullyNotified(r) {
    const st = notifyState(r);
    return !!st && st.slack && st.telegram;
  }

  function rowCells(r, isEditor) {
    const stage = stageOf(r);
    const c = cycleById(lf(r, "Cycle"));
    const cycleRaw = lf(r, "Cycle").trim();
    const note = lf(r, "Stage Note").trim();
    const rec = lf(r, "Recording").trim();
    const when = lf(r, "Stage Updated At").trim();
    const by = lf(r, "Stage Updated By").trim();

    const cycleCell = showCycleColumn()
      ? `<td>${c ? escapeHtml(cycleLabel(c)) : cycleRaw ? escapeHtml(cycleRaw) : "—"}</td>`
      : "";

    const recHtml = /^https?:\/\//i.test(rec)
      ? ` <a class="rec-link" href="${escapeHtml(rec)}" target="_blank" rel="noopener noreferrer">Recording</a>`
      : "";

    const meta = [when, by].filter(Boolean).join(" · ");

    const stageCell =
      `<td class="stage-cell"><span class="stage-pill ${STAGE_CLASS[stage]}">${escapeHtml(stage)}</span>` +
      notifyChips(r) +
      (note ? `<div class="stage-note">${escapeHtml(note)}</div>` : "") +
      (meta || recHtml ? `<div class="stage-meta">${escapeHtml(meta)}${recHtml}</div>` : "") +
      "</td>";

    return cycleCell + stageCell + (isEditor ? `<td class="move-cell">${moveControls(r)}</td>` : "");
  }

  // Called by leads.js after the table HTML is in the page.
  function afterRender(visibleRows) {
    lastVisible = visibleRows || [];
    const selAll = document.getElementById("selAllBox");
    const boxes = [...document.querySelectorAll(".selBox")];

    if (selAll) {
      const refreshSelAll = () => {
        selAll.checked = boxes.length > 0 && boxes.every((b) => b.checked);
      };
      refreshSelAll();
      selAll.addEventListener("change", () => {
        boxes.forEach((b) => {
          b.checked = selAll.checked;
          if (selAll.checked) selected.add(b.getAttribute("data-key"));
          else selected.delete(b.getAttribute("data-key"));
        });
        updateBulk();
      });
      boxes.forEach((b) =>
        b.addEventListener("change", () => {
          const k = b.getAttribute("data-key");
          if (b.checked) selected.add(k);
          else selected.delete(k);
          refreshSelAll();
          updateBulk();
        })
      );
    }

    updateBulk();
  }

  function selectedLeads() {
    return allLeadRows.filter((r) => selected.has(leadKey(r)));
  }

  function updateBulk() {
    syncNotifyButton();
    const btn = document.getElementById("bulkCycleBtn");
    if (!btn) return;
    // Forget selections for leads that no longer exist.
    const live = new Set(allLeadRows.map(leadKey));
    [...selected].forEach((k) => {
      if (!live.has(k)) selected.delete(k);
    });
    const n = selected.size;
    btn.classList.toggle("hidden", !(showSelectColumn() && n > 0));
    btn.textContent = `Add ${n} selected to a cycle`;
  }

  // ----------------------------------------------------------
  // Moving a lead between stages
  // ----------------------------------------------------------

  async function uploadRecording(file, label) {
    if (!recordingUploadEnabled()) throw new Error("Recording upload is not set up. Paste a link instead.");
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error("That file is over 25 MB. Upload it to Drive yourself and paste the link instead.");
    }

    const meta = {
      name: String(label + " - " + file.name).replace(/[\\/]/g, "-"),
      parents: [String(CONFIG.RECORDINGS_FOLDER_ID).trim()],
    };
    const boundary = "occ_" + Math.random().toString(36).slice(2);
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
      `--${boundary}\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`,
      file,
      `\r\n--${boundary}--`,
    ]);

    const token = Auth.getToken();
    if (!token) throw new Error("Your session has expired. Please sign in again.");

    const resp = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "multipart/related; boundary=" + boundary,
        },
        body,
      }
    );

    if (!resp.ok) {
      const text = await resp.text();
      if (resp.status === 401 || resp.status === 403) {
        throw new Error(
          "Google did not allow the upload. Sign out and sign in again (uploads need one extra permission), and check you can add files to the recordings folder."
        );
      }
      throw new Error("Upload failed (" + resp.status + "): " + text.slice(0, 200));
    }

    const data = await resp.json();
    return data.webViewLink || "https://drive.google.com/file/d/" + data.id + "/view";
  }

  async function logHistory(entry) {
    if (historyOff) return;

    let t;
    try {
      t = await SheetsAPI.getTable(CONFIG.TABS.STAGE_HISTORY);
    } catch (e) {
      historyOff = true; // tab does not exist: that is fine, it is optional
      return;
    }
    if (!t.headers.length) {
      historyOff = true;
      return;
    }

    try {
      const vals = {
        timestamp: entry.at,
        "lead id": entry.leadId,
        "business name": entry.business,
        from: entry.from,
        to: entry.to,
        note: safeText(entry.note),
        by: entry.by,
        recording: entry.recording,
      };
      await SheetsAPI.appendRow(
        CONFIG.TABS.STAGE_HISTORY,
        t.headers.map((h) => (vals[norm(h)] !== undefined ? vals[norm(h)] : ""))
      );
    } catch (e) {
      console.warn("Stage History write failed:", e);
    }
  }

  async function moveLead(lead, move, note, recording) {
    const table = await SheetsAPI.getTable(CONFIG.TABS.LEADS);
    leadHeaders = table.headers;

    const stageHeader = hdr(table.headers, "Stage");
    if (!stageHeader) throw new Error('The Leads sheet has no "Stage" column yet.');

    const id = String(lead["Lead ID"]).trim();
    const name = String(lead["Business Name"]).trim();
    const row = table.rows.find(
      (r) => String(r["Lead ID"]).trim() === id && String(r["Business Name"]).trim() === name
    );

    if (!row) {
      await refresh();
      throw new Error("This lead no longer exists. The list has been refreshed.");
    }

    const from = stageOf(row);
    if (from !== stageOf(lead)) {
      await refresh();
      throw new Error('Someone already moved this lead (it is now in "' + from + '"). The list has been refreshed.');
    }
    if (!canMoveStage(row)) {
      await refresh();
      throw new Error("You can't move this lead any more (it is no longer assigned to you).");
    }

    const by = Auth.getEmail() || "";
    const at = stampNow();

    const writes = [[stageHeader, move.to]];
    const optional = [
      // Entering a stage is a new event: forget what was sent for the old one.
      ["Stage Slack Notified", ""],
      ["Stage Telegram Notified", ""],
      ["Stage Note", safeText(note)],
      ["Stage Updated At", at],
      ["Stage Updated By", by],
    ];
    optional.forEach(([n, v]) => {
      const h = hdr(table.headers, n);
      if (h) writes.push([h, v]);
    });
    if (recording) {
      const h = hdr(table.headers, "Recording");
      if (h) writes.push([h, recording]);
    }

    await Promise.all(
      writes.map(([h, v]) =>
        SheetsAPI.updateCell(
          CONFIG.TABS.LEADS + "!" + SheetsAPI.colLetter(table.headers, h) + row.__rowIndex,
          v
        )
      )
    );

    await logHistory({ at, leadId: id, business: name, from, to: move.to, note, by, recording: recording || "" });
    await refresh();

    // Post to this stage's own Slack channel / Telegram chat. Best effort:
    // the move itself is already saved, so a failure only shows a notice.
    announceStage(id, name, move.to);
  }

  // Asks Apps Script to post one lead to its stage's channel/chat.
  async function postStage(leadId, stage, resend) {
    if (!CONFIG.NOTIFY_WEBHOOK_URL || !CONFIG.NOTIFY_WEBHOOK_URL.trim()) {
      throw new Error("The notification webhook URL is not set in config.js.");
    }
    const url =
      CONFIG.NOTIFY_WEBHOOK_URL +
      "?secret=" + encodeURIComponent(CONFIG.NOTIFY_WEBHOOK_SECRET || "") +
      "&action=notifyStage&leadId=" + encodeURIComponent(leadId) +
      "&stage=" + encodeURIComponent(stage) +
      (resend ? "&resend=1" : "");
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("Webhook " + resp.status);
    const data = await resp.json().catch(() => ({}));
    if (data && data.ok === false) throw new Error(data.error || "The webhook reported an error.");
    if (!data || data.retried !== undefined || (data.skipped !== true && !data.stage)) {
      throw new Error(STALE_WEBAPP);
    }
    return data;
  }

  // Manual notify: one lead (row button) or every not-yet-notified lead in
  // this tab. resend=true sends again even if it was already sent.
  async function notifyLeads(leads, stage, resend) {
    let sent = 0;
    let already = 0;
    let failed = 0;
    let firstError = "";

    for (let i = 0; i < leads.length; i++) {
      notice(`Sending ${i + 1} of ${leads.length} to the ${stage} channel…`, false);
      try {
        const data = await postStage(String(leads[i]["Lead ID"]).trim(), stage, !!resend);
        if (data.already) {
          already++;
          continue;
        }
        if (data.skipped) {
          notice(
            data.reason ||
              `No Slack channel or Telegram chat is set for ${stage}. Add its Script Properties in Apps Script.`,
            true
          );
          return;
        }
        sent++;
      } catch (e) {
        failed++;
        if (!firstError) firstError = e.message || "error";
      }
    }

    const parts = [`Sent ${sent}`];
    if (already) parts.push(`${already} already sent (skipped)`);
    if (failed) parts.push(`${failed} failed (${firstError})`);
    notice(parts.join(", ") + ".", failed > 0);
    await refresh();
  }

  const MAX_NOTIFY_BATCH = 25;

  function pendingInTab() {
    return lastVisible.filter((r) => !fullyNotified(r));
  }

  function isStageTab() {
    return activeTab !== "all" && activeTab !== R1;
  }

  // The one "Send notifications now" button at the top of the page: on
  // Round 1 / All it keeps its old job (handled in leads.js); on any other
  // stage tab it sends that stage's not-yet-notified leads.
  function syncNotifyButton() {
    const btn = document.getElementById("sendNotifyBtn");
    if (!btn || btn.disabled) return;
    btn.textContent = isStageTab()
      ? `Send notifications now (${pendingInTab().length} pending)`
      : "Send notifications now";
  }

  async function notifyCurrentStage() {
    const leads = pendingInTab();
    if (leads.length === 0) {
      notice(`Everything in ${activeTab} has already been sent.`, false);
      return;
    }
    if (leads.length > MAX_NOTIFY_BATCH) {
      notice(`That is ${leads.length} leads. Narrow the list (search or cycle filter) to ${MAX_NOTIFY_BATCH} or fewer first.`, true);
      return;
    }
    await notifyLeads(leads, activeTab, false);
  }

  async function announceStage(leadId, name, stage) {
    try {
      const data = await postStage(leadId, stage, false);
      if (data && data.skipped) return; // no channel set / already sent
      notice(name + ": posted to the " + stage + " channel.", false);
      refresh(); // show the new Slack/Telegram ✓ markers
    } catch (e) {
      console.error("Stage notification failed:", e);
      notice(
        name + " was moved to " + stage + ", but the Slack/Telegram message failed (" + (e.message || "error") + ").",
        true
      );
    }
  }

  function closeMoveModal() {
    const el = document.getElementById("moveModal");
    if (el) el.remove();
    document.removeEventListener("keydown", onMoveKey);
  }

  function onMoveKey(e) {
    if (e.key === "Escape") closeMoveModal();
  }

  function modalShell(id, inner, maxWidth) {
    const overlay = document.createElement("div");
    overlay.id = id;
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(20,23,31,0.45);z-index:1000;" +
      "display:flex;align-items:center;justify-content:center;padding:20px;";
    overlay.innerHTML =
      `<div style="background:#fff;border-radius:4px;padding:24px;width:100%;max-width:${maxWidth || 460}px;max-height:90vh;overflow:auto;">` +
      inner +
      "</div>";
    return overlay;
  }

  function openMoveModal(lead, move) {
    closeMoveModal();

    const name = String(lead["Business Name"]).trim();
    const exempt = Auth.canApprove();
    const upload = recordingUploadEnabled();

    const recHtml = move.needRecording
      ? `
      <div class="field">
        <label for="mvRecLink">Call recording ${exempt ? "(optional for you)" : "*"}</label>
        <input type="text" id="mvRecLink" placeholder="Paste a link to the recording" />
        ${
          upload
            ? `<div class="mv-or">or upload a file (max 25 MB)</div>
               <input type="file" id="mvRecFile" accept="audio/*,video/*,.m4a,.mp3,.wav,.mp4,.aac,.ogg,.amr,.3gp" />`
            : ""
        }
      </div>`
      : "";

    const overlay = modalShell(
      "moveModal",
      `<h2 style="font-family:var(--font-display);font-size:20px;margin:0 0 4px;">Move to ${escapeHtml(move.to)}</h2>
       <p class="sub" style="margin:0 0 14px;font-size:13px;">${escapeHtml(name)} · now in ${escapeHtml(stageOf(lead))}</p>
       ${recHtml}
       <div class="field">
         <label for="mvNote">${move.needNote ? "Reason *" : "Note (optional)"}</label>
         <textarea id="mvNote" rows="3" placeholder="${move.needNote ? "Why?" : "Anything worth remembering"}"></textarea>
       </div>
       <div id="mvError" style="color:var(--warn);font-size:13px;min-height:18px;margin-bottom:8px;"></div>
       <div style="display:flex;gap:8px;">
         <button class="btn-primary" id="mvConfirm">Move lead</button>
         <button id="mvCancel">Cancel</button>
       </div>`
    );

    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeMoveModal();
    });
    document.getElementById("mvCancel").addEventListener("click", closeMoveModal);
    document.addEventListener("keydown", onMoveKey);

    const errBox = document.getElementById("mvError");
    const btn = document.getElementById("mvConfirm");

    btn.addEventListener("click", async () => {
      const note = document.getElementById("mvNote").value.trim();
      if (move.needNote && !note) {
        errBox.textContent = "Please give a reason.";
        return;
      }

      let link = "";
      let file = null;
      if (move.needRecording) {
        link = document.getElementById("mvRecLink").value.trim();
        const fileEl = document.getElementById("mvRecFile");
        file = fileEl && fileEl.files && fileEl.files[0] ? fileEl.files[0] : null;

        if (!file && !link && !exempt) {
          errBox.textContent = "Add the call recording (a link or a file) to reject this lead.";
          return;
        }
        if (!file && link && !/^https?:\/\/\S+$/i.test(link)) {
          errBox.textContent = "The recording link must start with http:// or https://";
          return;
        }
      }

      errBox.textContent = "";
      btn.disabled = true;

      try {
        let recording = link;
        if (file) {
          btn.textContent = "Uploading…";
          recording = await uploadRecording(file, String(lead["Lead ID"]).trim() + " " + name);
        }
        btn.textContent = "Moving…";
        await moveLead(lead, move, note, recording);
        closeMoveModal();
      } catch (e) {
        console.error("Move failed:", e);
        errBox.textContent = e.message || "Could not move this lead.";
        btn.disabled = false;
        btn.textContent = "Move lead";
      }
    });

    const first = document.getElementById("mvRecLink") || document.getElementById("mvNote");
    if (first) first.focus();
  }

  // One listener for every Move control in the table.
  function onMoveControl(e) {
    const el = e.target.closest && e.target.closest("[data-move-to]");
    if (!el || el.disabled) return;

    const isCheck = el.type === "checkbox";
    if (e.type === "change" && !isCheck) return;
    if (e.type === "click" && isCheck) return;

    if (isCheck) el.checked = false; // the table re-renders once the move succeeds

    const lead = allLeadRows.find((r) => r.__rowIndex === Number(el.getAttribute("data-row")));
    if (!lead) return;

    const move = (MOVES[stageOf(lead)] || []).find((m) => m.to === el.getAttribute("data-move-to"));
    if (move) openMoveModal(lead, move);
  }

  document.addEventListener("change", onMoveControl);
  document.addEventListener("click", onMoveControl);


  // ----------------------------------------------------------
  // Cycles: webhook, rules, forms
  // ----------------------------------------------------------

  async function callCycleWebhook(cycleId, force) {
    if (!CONFIG.NOTIFY_WEBHOOK_URL || !CONFIG.NOTIFY_WEBHOOK_URL.trim()) {
      throw new Error("The notification webhook URL is not set in config.js.");
    }

    const url =
      CONFIG.NOTIFY_WEBHOOK_URL +
      "?secret=" + encodeURIComponent(CONFIG.NOTIFY_WEBHOOK_SECRET || "") +
      "&action=sendCycle&cycleId=" + encodeURIComponent(cycleId) +
      (force ? "&force=1" : "");

    const resp = await fetch(url);
    if (!resp.ok) throw new Error("Webhook " + resp.status + ": " + (await resp.text()).slice(0, 200));

    const data = await resp.json().catch(() => ({}));
    if (data && data.ok === false) throw new Error(data.error || "The webhook reported an error.");
    if (!data || data.retried !== undefined) throw new Error(STALE_WEBAPP);
    return data;
  }

  function sentSummary(c, data) {
    const where =
      data.slack && data.telegram ? "Slack and Telegram" : data.slack ? "Slack only" : "Telegram only";
    return `${cycleLabel(c)} sent to ${where} (${data.sent} lead${data.sent === 1 ? "" : "s"}).`;
  }

  // Run after leads join a cycle. If it is now full the server decides
  // (and de-duplicates) whether to send.
  async function afterCycleAdded(cycleId) {
    if (!cycleId) return;
    try {
      await loadCycles();
      const c = cycleById(cycleId);
      if (!c || !c.limit) return;

      const t = await SheetsAPI.getTable(CONFIG.TABS.LEADS);
      const count = cycleCount(c.id, t.rows.filter(isRealLead));
      if (count < c.limit || c.sentCount >= c.limit) return;

      const data = await callCycleWebhook(c.id, false);
      if (data.skipped) return;
      notice(cycleLabel(c) + " is full. " + sentSummary(c, data), false);
      await loadCycles();
      renderCycleFilter();
    } catch (e) {
      console.error("Auto-send failed:", e);
      notice(
        "A cycle is full but the Slack/Telegram message could not be sent (" +
          (e.message || "error") +
          "). Use Manage cycles → Send now.",
        true
      );
    }
  }

  // Validates putting a lead in a cycle and returns what to save.
  //   cycleId  - chosen cycle ("" = none)
  //   industry - the lead's industry from the form
  //   ownLead  - the lead being edited (so it doesn't count against the limit)
  async function resolveCycle(cycleId, industry, ownLead) {
    if (!cycleId) return { cycleId: "", industry };

    await loadCycles();
    const c = cycleById(cycleId);
    if (!c) throw new Error("That cycle no longer exists. Pick another.");

    let ind = industry;
    if (!ind) {
      ind = c.niche;
    } else if (c.niche && norm(ind) !== norm(c.niche)) {
      throw new Error(`${cycleLabel(c)} is for "${c.niche}" leads. Change the industry or pick another cycle.`);
    }

    const t = await SheetsAPI.getTable(CONFIG.TABS.LEADS);
    const ownId = ownLead ? String(ownLead["Lead ID"]).trim() : "";
    const others = t.rows
      .filter(isRealLead)
      .filter((r) => !ownId || String(r["Lead ID"]).trim() !== ownId);
    const count = cycleCount(c.id, others);

    if (c.limit && count >= c.limit) {
      throw new Error(
        `${cycleLabel(c)} is full (${count}/${c.limit}). The Owner or an approver can raise its limit in Manage cycles.`
      );
    }

    return { cycleId: c.id, industry: ind };
  }

  // <select> for the Add / Edit lead forms. "" when not applicable.
  function cycleFieldHtml(existingLead) {
    if (!cyclesOk || cycles.length === 0 || !hasLeadCol("Cycle")) return "";
    if (existingLead && !Auth.canApprove()) return ""; // editing: approvers only
    if (!Auth.isEditor()) return "";

    const current = existingLead ? lf(existingLead, "Cycle").trim() : "";
    const opts = cycles
      .map((c) => {
        const n = cycleCount(c.id);
        const full = c.limit && n >= c.limit && norm(c.id) !== norm(current);
        return `<option value="${escapeHtml(c.id)}" ${full ? "disabled" : ""}>${escapeHtml(
          `${cycleLabel(c)} · ${c.niche || "any niche"} (${n}/${c.limit || "∞"}${full ? ", full" : ""})`
        )}</option>`;
      })
      .join("");

    return `
      <div class="field">
        <label for="f_cycle">Cycle</label>
        <select id="f_cycle" data-placeholder="No cycle">
          <option value="">No cycle</option>${opts}
        </select>
      </div>`;
  }

  // null = this form has no Cycle field (leave the lead's Cycle alone).
  function cycleValue() {
    const el = document.getElementById("f_cycle");
    return el ? el.value : null;
  }

  function setCycleField(existingLead) {
    const el = document.getElementById("f_cycle");
    if (el && existingLead) el.value = lf(existingLead, "Cycle").trim();
  }

  // ----------------------------------------------------------
  // Bulk "Add to cycle"
  // ----------------------------------------------------------

  function closeBulkModal() {
    const el = document.getElementById("bulkModal");
    if (el) el.remove();
  }

  function openBulkModal() {
    closeBulkModal();
    const leads = selectedLeads();
    if (leads.length === 0) return;

    const opts = cycles
      .map((c) => {
        const n = cycleCount(c.id);
        return `<option value="${escapeHtml(c.id)}">${escapeHtml(
          `${cycleLabel(c)} · ${c.niche || "any niche"} (${n}/${c.limit || "∞"})`
        )}</option>`;
      })
      .join("");

    const overlay = modalShell(
      "bulkModal",
      `<h2 style="font-family:var(--font-display);font-size:20px;margin:0 0 4px;">Add ${leads.length} lead${leads.length === 1 ? "" : "s"} to a cycle</h2>
       <p class="sub" style="margin:0 0 14px;font-size:13px;">Leads must match the cycle's niche (a lead with no industry takes the cycle's niche) and the cycle must have room.</p>
       <div class="field"><label for="bulkCycle">Cycle</label>
         <select id="bulkCycle" data-placeholder="Choose a cycle"><option value="">Choose a cycle</option>${opts}</select></div>
       <div id="bulkError" style="color:var(--warn);font-size:13px;min-height:18px;margin-bottom:8px;white-space:pre-line;"></div>
       <div style="display:flex;gap:8px;">
         <button class="btn-primary" id="bulkConfirm">Add to cycle</button>
         <button id="bulkCancel">Cancel</button>
       </div>`
    );
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeBulkModal();
    });
    document.getElementById("bulkCancel").addEventListener("click", closeBulkModal);

    const btn = document.getElementById("bulkConfirm");
    const err = document.getElementById("bulkError");

    btn.addEventListener("click", async () => {
      const cycleId = document.getElementById("bulkCycle").value;
      if (!cycleId) {
        err.textContent = "Choose a cycle.";
        return;
      }
      err.textContent = "";
      btn.disabled = true;
      btn.textContent = "Adding…";

      try {
        const n = await addLeadsToCycle(leads, cycleId);
        leads.forEach((l) => selected.delete(leadKey(l)));
        closeBulkModal();
        await refresh();
        notice(`Added ${n} lead${n === 1 ? "" : "s"} to the cycle.`, false);
        afterCycleAdded(cycleId);
      } catch (e) {
        console.error("Bulk add failed:", e);
        err.textContent = e.message || "Could not add the leads.";
        btn.disabled = false;
        btn.textContent = "Add to cycle";
      }
    });
  }

  async function addLeadsToCycle(leads, cycleId) {
    await loadCycles();
    const c = cycleById(cycleId);
    if (!c) throw new Error("That cycle no longer exists.");

    const t = await SheetsAPI.getTable(CONFIG.TABS.LEADS);
    leadHeaders = t.headers;
    const cycleHeader = hdr(t.headers, "Cycle");
    if (!cycleHeader) throw new Error('The Leads sheet has no "Cycle" column.');
    const industryHeader = hdr(t.headers, "Industry");

    const real = t.rows.filter(isRealLead);
    const fresh = leads.map((l) => real.find((r) => leadKey(r) === leadKey(l))).filter(Boolean);
    if (fresh.length !== leads.length) {
      await refresh();
      throw new Error("Some selected leads no longer exist. The list has been refreshed.");
    }

    const problems = [];
    const todo = [];
    fresh.forEach((r) => {
      const label = String(r["Business Name"]).trim();
      const inCycle = lf(r, "Cycle").trim();
      if (inCycle && norm(inCycle) === norm(c.id)) return; // already there
      if (inCycle) {
        const other = cycleById(inCycle);
        problems.push(`${label}: already in ${other ? cycleLabel(other) : inCycle}`);
        return;
      }
      const ind = lf(r, "Industry").trim();
      if (ind && c.niche && norm(ind) !== norm(c.niche)) {
        problems.push(`${label}: industry is "${ind}", cycle is for "${c.niche}"`);
        return;
      }
      todo.push({ row: r, fillIndustry: !ind && c.niche });
    });

    const current = cycleCount(c.id, real);
    if (c.limit && current + todo.length > c.limit) {
      problems.push(
        `Only ${Math.max(0, c.limit - current)} free slot(s) left in ${cycleLabel(c)} (${current}/${c.limit}); you selected ${todo.length} new lead(s).`
      );
    }

    if (problems.length) {
      throw new Error("Nothing was changed:\n" + problems.join("\n"));
    }

    await Promise.all(
      todo.flatMap(({ row, fillIndustry }) => {
        const jobs = [
          SheetsAPI.updateCell(
            CONFIG.TABS.LEADS + "!" + SheetsAPI.colLetter(t.headers, cycleHeader) + row.__rowIndex,
            c.id
          ),
        ];
        if (fillIndustry && industryHeader) {
          jobs.push(
            SheetsAPI.updateCell(
              CONFIG.TABS.LEADS + "!" + SheetsAPI.colLetter(t.headers, industryHeader) + row.__rowIndex,
              c.niche
            )
          );
        }
        return jobs;
      })
    );

    return todo.length;
  }

  // ----------------------------------------------------------
  // Manage cycles (Owner + approvers)
  // ----------------------------------------------------------

  function closeCyclesModal() {
    const el = document.getElementById("cyclesModal");
    if (el) el.remove();
  }

  function nextCycleId() {
    const nums = cycles.map((c) => parseInt(String(c.id).replace(/\D/g, ""), 10)).filter((n) => !isNaN(n));
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return "C" + String(next).padStart(3, "0");
  }

  function cycleStatus(c, n) {
    if (c.sentAt) {
      return c.limit && n > c.sentCount ? `Sent ${c.sentAt} (${n - c.sentCount} added since)` : `Sent ${c.sentAt}`;
    }
    if (c.limit && n >= c.limit) return "Full, not sent";
    return "Open";
  }

  function cyclesBodyHtml() {
    if (!cyclesOk) {
      return `<p style="font-size:14px;color:var(--ink-soft);">Create a tab named <strong>${escapeHtml(
        CONFIG.TABS.CYCLES
        )}</strong> in the spreadsheet with these headers in row 1:<br><code>Cycle ID | Name | Number | Niche | Limit | Created By | Created At | Sent At | Sent Count</code></p>
      <p style="font-size:13px;color:var(--warn);">What the site got when it tried to read it: ${escapeHtml(cyclesProblem || "nothing")}</p>`;
    }

    const rows = cycles.length
      ? cycles
          .map((c) => {
            const n = cycleCount(c.id);
            return `<tr data-cycle="${escapeHtml(c.id)}">
              <td>${escapeHtml(c.name)}</td>
              <td>${escapeHtml(c.number)}</td>
              <td>${escapeHtml(c.niche)}</td>
              <td style="white-space:nowrap;">${n} / <input type="number" min="${Math.max(1, n)}" class="cy-limit" value="${c.limit || ""}" /></td>
              <td class="cy-status">${escapeHtml(cycleStatus(c, n))}</td>
              <td style="white-space:nowrap;">
                <button class="btn-quiet cy-save" style="padding:4px 8px;">Save limit</button>
                <button class="btn-quiet cy-send" style="padding:4px 8px;">Send now</button>
              </td></tr>`;
          })
          .join("")
      : `<tr><td colspan="6" style="color:var(--ink-soft);">No cycles yet. Create the first one below.</td></tr>`;

    const nums = cycles.map((c) => parseInt(c.number, 10)).filter((n) => !isNaN(n));
    const nextNum = (nums.length ? Math.max(...nums) : 0) + 1;
    const niches = (CONFIG.INDUSTRIES || [])
      .map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`)
      .join("");

    return `
      <div style="overflow-x:auto;"><table>
        <thead><tr><th>Name</th><th>No.</th><th>Niche</th><th>Leads / limit</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <h3 style="font-family:var(--font-display);font-size:16px;margin:20px 0 10px;">New cycle</h3>
      <div class="field-row">
        <div class="field"><label for="cyName">Name *</label><input type="text" id="cyName" placeholder="e.g. Pune batch" /></div>
        <div class="field"><label for="cyNumber">Number *</label><input type="text" id="cyNumber" value="${nextNum}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="cyNiche">Niche *</label>
          <select id="cyNiche" data-placeholder="Select a niche"><option value="">Select a niche</option>${niches}</select></div>
        <div class="field"><label for="cyLimit">Limit *</label><input type="number" id="cyLimit" min="1" value="${
          CONFIG.DEFAULT_CYCLE_LIMIT || 20
        }" /></div>
      </div>
      <button class="btn-primary" id="cyCreate">Create cycle</button>`;
  }

  async function openCyclesModal() {
    closeCyclesModal();
    await loadCycles();

    const overlay = modalShell(
      "cyclesModal",
      `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
         <h2 style="font-family:var(--font-display);font-size:20px;margin:0;margin-right:auto;">Lead cycles</h2>
         <button id="cyClose">Close</button></div>
       <p class="sub" style="margin:0 0 14px;font-size:13px;">A cycle is a named batch of leads from one niche. When it reaches its limit, one Slack and one Telegram message goes out with the cycle name, number, niche and its leads. You can raise the limit or send it any time.</p>
       <div id="cyBody">${cyclesBodyHtml()}</div>
       <div id="cyError" style="color:var(--warn);font-size:13px;min-height:18px;margin-top:10px;white-space:pre-line;"></div>`,
      760
    );
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeCyclesModal();
    });
    document.getElementById("cyClose").addEventListener("click", closeCyclesModal);
    overlay.addEventListener("click", onCyclesClick);
  }

  async function rerenderCyclesModal() {
    await loadCycles();
    const body = document.getElementById("cyBody");
    if (body) body.innerHTML = cyclesBodyHtml();
    renderCycleFilter();
    syncDropdowns();
  }

  async function onCyclesClick(e) {
    const err = document.getElementById("cyError");
    const btn = e.target.closest("button");
    if (!btn || !err) return;

    err.style.color = "var(--warn)";

    try {
      if (btn.id === "cyCreate") {
        await createCycle();
        await rerenderCyclesModal();
        err.textContent = "";
      } else if (btn.classList.contains("cy-save") || btn.classList.contains("cy-send")) {
        const tr = btn.closest("tr");
        const c = cycleById(tr.getAttribute("data-cycle"));
        if (!c) return;

        btn.disabled = true;
        try {
          if (btn.classList.contains("cy-save")) {
            await saveLimit(c, tr.querySelector(".cy-limit").value);
            await rerenderCyclesModal();
            err.textContent = "";
          } else {
            const original = btn.textContent;
            btn.textContent = "Sending…";
            // Refresh the leads first so the count is current.
            await refresh();
            if (cycleCount(c.id) === 0) throw new Error("This cycle has no leads yet.");
            const data = await callCycleWebhook(c.id, true);
            await rerenderCyclesModal();
            err.style.color = "var(--ok)";
            err.textContent = sentSummary(c, data);
            btn.textContent = original;
          }
        } finally {
          btn.disabled = false;
        }
      }
    } catch (ex) {
      console.error("Cycle action failed:", ex);
      err.textContent = ex.message || "Something went wrong.";
    }
  }

  async function createCycle() {
    const val = (id) => document.getElementById(id).value.trim();
    const name = val("cyName");
    const number = val("cyNumber");
    const niche = val("cyNiche");
    const limit = parseInt(val("cyLimit"), 10);

    if (!name || !number || !niche) throw new Error("Name, number and niche are required.");
    if (!limit || limit < 1) throw new Error("The limit must be a whole number of 1 or more.");

    await loadCycles();
    if (cycles.some((c) => norm(c.name) === norm(name) && norm(c.number) === norm(number))) {
      throw new Error("A cycle with that name and number already exists.");
    }

    const t = await SheetsAPI.getTable(CONFIG.TABS.CYCLES);
    if (!t.headers.length) throw new Error("The Cycles tab has no header row.");

    const vals = {
      "cycle id": nextCycleId(),
      name: safeText(name),
      number: number,
      niche: niche,
      limit: limit,
      "created by": Auth.getEmail() || "",
      "created at": stampNow(),
    };

    await SheetsAPI.appendRow(
      CONFIG.TABS.CYCLES,
      t.headers.map((h) => (vals[norm(h)] !== undefined ? vals[norm(h)] : ""))
    );
  }

  async function saveLimit(c, raw) {
    const limit = parseInt(raw, 10);
    if (!limit || limit < 1) throw new Error("The limit must be a whole number of 1 or more.");

    const n = cycleCount(c.id);
    if (limit < n) throw new Error(`${cycleLabel(c)} already has ${n} leads, so the limit can't be lower than that.`);

    const h = hdr(c.__headers, "Limit");
    if (!h) throw new Error('The Cycles tab has no "Limit" column.');

    await SheetsAPI.updateCell(
      CONFIG.TABS.CYCLES + "!" + SheetsAPI.colLetter(c.__headers, h) + c.__rowIndex,
      limit
    );
  }

  return {
    // data
    loadCycles,
    // leads.js hooks
    renderTabs,
    renderCycleFilter,
    activeStageTab,
    matches,
    headCells,
    rowCells,
    selectHead,
    selectCell,
    afterRender,
    openBulkModal,
    openCyclesModal,
    notifyCurrentStage,
    isStageTab,
    syncNotifyButton,
    // forms
    cycleFieldHtml,
    cycleValue,
    setCycleField,
    resolveCycle,
    afterCycleAdded,
    notice,
    // tab switching
    setTab(key) {
      activeTab = key;
    },
    // exposed for reuse / tests
    stageOf,
    canMoveStage,
  };
})();
