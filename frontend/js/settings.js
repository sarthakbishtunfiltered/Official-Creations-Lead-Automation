// ============================================================
// SETTINGS PAGE
// Settings tab has NO header row — row 1 is real data.
// Column A = setting label, column B = value.
// Industries / Discovery sources options are read directly from
// the dropdown's own validation rule (Settings!B1 / Settings!B3)
// so the website always matches the Sheet exactly, character for
// character — no manual retyping, no mismatch risk.
// ============================================================

const FIELD_KEYS = {
  industries: "Industries",
  cities: "Cities / Locations",
  sources: "Discovery sources",
  signalWindow: "Buying-signal window",
  minAge: "Minimum business age",
};

let kvPairs = [];
let industryOptions = [];
let sourceOptions = [];

Auth.requireSession(() => {
  renderShell("settings.html");
  const isEditor = Auth.isEditor();

  document.getElementById("mainContent").innerHTML = `
    <div class="page-head">
      <div><h1>Settings</h1><div class="sub">Synced with the Settings tab in Google Sheets</div></div>
    </div>
    <div class="panel">
      <div class="field">
        <label>Industries</label>
        <div id="industriesCheckboxes">Loading…</div>
      </div>
      <div class="field">
        <label>Cities / locations (comma-separated)</label>
        <input type="text" id="f_cities" ${isEditor ? "" : "disabled"} />
      </div>
      <div class="field">
        <label>Discovery sources</label>
        <div id="sourcesCheckboxes">Loading…</div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Buying-signal window (days)</label>
          <input type="text" id="f_signal" ${isEditor ? "" : "disabled"} />
        </div>
        <div class="field">
          <label>Minimum business age (months)</label>
          <input type="text" id="f_age" ${isEditor ? "" : "disabled"} />
        </div>
      </div>
      ${isEditor
        ? '<button class="btn-primary" id="saveBtn">Save settings</button><span id="saveMsg" class="sub" style="margin-left:10px;"></span>'
        : '<span class="badge-readonly">Read-only — Editor access required to change settings</span>'}
    </div>
  `;

  if (isEditor) {
    document.getElementById("saveBtn").addEventListener("click", saveSettings);
  }

  load();
});

function renderCheckboxes(options, groupName, isEditor) {
  if (options.length === 0) {
    return `<div class="sub">No options found on this dropdown — check the Sheet's validation rule.</div>`;
  }
  return `
    <div style="display:flex; flex-wrap:wrap; gap:8px 16px; margin-top:4px;">
      ${options
        .map(
          (opt, i) => `
        <label style="display:flex; align-items:center; gap:6px; font-size:13.5px; color:var(--ink); font-weight:400; margin:0;">
          <input type="checkbox" class="${groupName}-checkbox" value="${escapeHtml(opt)}" id="${groupName}_${i}" ${isEditor ? "" : "disabled"} />
          ${escapeHtml(opt)}
        </label>
      `
        )
        .join("")}
    </div>
  `;
}

function getCheckedValues(groupName) {
  return Array.from(document.querySelectorAll(`.${groupName}-checkbox:checked`)).map((el) => el.value);
}

function setCheckedValues(groupName, selectedValues) {
  document.querySelectorAll(`.${groupName}-checkbox`).forEach((el) => {
    el.checked = selectedValues.includes(el.value);
  });
}

function findPair(key) {
  return kvPairs.find((p) => p.key.trim() === key);
}

async function load() {
  const isEditor = Auth.isEditor();

  const [pairs, industries, sources] = await Promise.all([
    SheetsAPI.getKeyValuePairs(CONFIG.TABS.SETTINGS),
    SheetsAPI.getDropdownOptions(`${CONFIG.TABS.SETTINGS}!B1`),
    SheetsAPI.getDropdownOptions(`${CONFIG.TABS.SETTINGS}!B3`),
  ]);

  kvPairs = pairs;
  industryOptions = industries;
  sourceOptions = sources;

  document.getElementById("industriesCheckboxes").innerHTML = renderCheckboxes(industryOptions, "industry", isEditor);
  document.getElementById("sourcesCheckboxes").innerHTML = renderCheckboxes(sourceOptions, "source", isEditor);

  const industriesRaw = findPair(FIELD_KEYS.industries)?.value || "";
  const sourcesRaw = findPair(FIELD_KEYS.sources)?.value || "";

  setCheckedValues("industry", splitList(industriesRaw));
  setCheckedValues("source", splitList(sourcesRaw));

  document.getElementById("f_cities").value = findPair(FIELD_KEYS.cities)?.value || "";
  document.getElementById("f_signal").value = findPair(FIELD_KEYS.signalWindow)?.value || "";
  document.getElementById("f_age").value = findPair(FIELD_KEYS.minAge)?.value || "";
}

function splitList(raw) {
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

async function saveSettings() {
  const btn = document.getElementById("saveBtn");
  const msg = document.getElementById("saveMsg");
  btn.disabled = true;
  msg.textContent = "Saving…";
  try {
    await writeSetting(FIELD_KEYS.industries, getCheckedValues("industry").join(", "));
    await writeSetting(FIELD_KEYS.cities, document.getElementById("f_cities").value);
    await writeSetting(FIELD_KEYS.sources, getCheckedValues("source").join(", "));
    await writeSetting(FIELD_KEYS.signalWindow, document.getElementById("f_signal").value);
    await writeSetting(FIELD_KEYS.minAge, document.getElementById("f_age").value);
    msg.textContent = "Saved.";
    setTimeout(() => (msg.textContent = ""), 2500);
    await load();
  } finally {
    btn.disabled = false;
  }
}

async function writeSetting(keyLabel, value) {
  const existing = findPair(keyLabel);
  if (existing) {
    await SheetsAPI.updateCell(`${CONFIG.TABS.SETTINGS}!B${existing.rowIndex}`, value);
  } else {
    await SheetsAPI.appendRow(CONFIG.TABS.SETTINGS, [keyLabel, value]);
  }
}