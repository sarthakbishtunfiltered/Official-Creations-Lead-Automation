Auth.requireSession(() => {
  renderShell("blacklisted.html");
  document.getElementById("mainContent").innerHTML = `
    <div class="page-head">
      <div><h1>Blacklisted</h1><div class="sub">Businesses excluded from discovery</div></div>
    </div>
    <div class="panel">
      <div class="toolbar"><input type="text" id="searchInput" placeholder="Search business, phone…" /></div>
      <div id="tableWrap">Loading…</div>
    </div>
  `;
  document.getElementById("searchInput").addEventListener("input", render);
  startPolling(refresh, CONFIG.POLL_INTERVAL_MS);
});

let rows = [];

async function refresh() {
  const table = await SheetsAPI.getTable(CONFIG.TABS.BLACKLISTED);
  rows = table.rows;
  render();
}

function render() {
  const search = document.getElementById("searchInput").value.trim().toLowerCase();
  const filtered = rows.filter((r) =>
    `${r["Business Name"]} ${r["Phone"]}`.toLowerCase().includes(search)
  );
  if (filtered.length === 0) {
    document.getElementById("tableWrap").innerHTML = `<div class="empty-state">Nothing blacklisted.</div>`;
    return;
  }
  const rowsHtml = filtered
    .map(
      (r) => `<tr>
        <td>${escapeHtml(r["Business Name"])}</td>
        <td>${escapeHtml(r["Phone"])}</td>
        <td>${escapeHtml(r["Instagram ID"])}</td>
        <td>${escapeHtml(r["Reason"])}</td>
        <td>${escapeHtml(r["Blacklisted At"])}</td>
      </tr>`
    )
    .join("");
  document.getElementById("tableWrap").innerHTML = `
    <table>
      <thead><tr><th>Business</th><th>Phone</th><th>Instagram</th><th>Reason</th><th>Blacklisted at</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
}