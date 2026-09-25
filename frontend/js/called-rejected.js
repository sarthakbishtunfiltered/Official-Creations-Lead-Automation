Auth.requireSession(() => {
  renderShell("called-rejected.html");
  document.getElementById("mainContent").innerHTML = `
    <div class="page-head">
      <div><h1>Called / Rejected</h1><div class="sub">Leads that were called and rejected</div></div>
    </div>
    <div class="panel">
      <div class="toolbar"><input type="text" id="searchInput" placeholder="Search business, location…" /></div>
      <div id="tableWrap">Loading…</div>
    </div>
  `;
  document.getElementById("searchInput").addEventListener("input", render);
  startPolling(refresh, CONFIG.POLL_INTERVAL_MS);
});

let rows = [];

async function refresh() {
  const table = await SheetsAPI.getTable(CONFIG.TABS.CALLED_REJECTED);
  rows = table.rows;
  render();
}

function render() {
  const search = document.getElementById("searchInput").value.trim().toLowerCase();
  const filtered = rows.filter((r) =>
    `${r["Business Name"]} ${r["Location"]}`.toLowerCase().includes(search)
  );
  if (filtered.length === 0) {
    document.getElementById("tableWrap").innerHTML = `<div class="empty-state">No records yet.</div>`;
    return;
  }
  const rowsHtml = filtered
    .map(
      (r) => `<tr>
        <td class="lead-id">${escapeHtml(r["Lead ID"])}</td>
        <td>${escapeHtml(r["Business Name"])}</td>
        <td>${escapeHtml(r["Industry"])}</td>
        <td>${escapeHtml(r["Location"])}</td>
        <td>${escapeHtml(r["Phone"])}</td>
        <td>${escapeHtml(r["Rejection Reason"])}</td>
        <td>${escapeHtml(r["Called At"])}</td>
        <td>${escapeHtml(r["Rejected At"])}</td>
      </tr>`
    )
    .join("");
  document.getElementById("tableWrap").innerHTML = `
    <table>
      <thead><tr><th>Lead ID</th><th>Business</th><th>Industry</th><th>Location</th><th>Phone</th><th>Reason</th><th>Called</th><th>Rejected</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
}