// ============================================================
// SHEETS API — thin wrapper. Every read/write goes through the
// signed-in user's own token, so Google enforces Viewer/Editor
// permissions for us; the site does not maintain its own DB.
// ============================================================

const SheetsAPI = (() => {
  const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

  async function request(path, options = {}) {
    const resp = await fetch(`${BASE}/${CONFIG.SPREADSHEET_ID}${path}`, {
      ...options,
      headers: {
        ...Auth.authHeaders(),
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Sheets API ${resp.status}: ${body}`);
    }
    return resp.status === 204 ? null : resp.json();
  }

  // For tabs WITH a real header row (Leads, Blacklisted, Called Rejected).
  async function getTable(tabName) {
    const data = await request(`/values/${encodeURIComponent(tabName)}`);
    const values = data.values || [];
    if (values.length === 0) return { headers: [], rows: [] };
    const [headers, ...rest] = values;
    const rows = rest.map((r, i) => {
      const obj = { __rowIndex: i + 2 };
      headers.forEach((h, idx) => (obj[h] = r[idx] ?? ""));
      return obj;
    });
    return { headers, rows };
  }

  // For plain key/value tabs with NO header row (Settings).
  async function getKeyValuePairs(tabName) {
    const data = await request(`/values/${encodeURIComponent(tabName)}!A:B`);
    const values = data.values || [];
    return values.map((row, i) => ({
      key: (row[0] || "").toString(),
      value: (row[1] || "").toString(),
      rowIndex: i + 1,
    }));
  }

  // Reads the exact option strings from a cell's own dropdown
  // (data validation) rule — guarantees the website matches the
  // Sheet's actual accepted values, character for character.
  async function getDropdownOptions(a1CellRange /* e.g. "Settings!B1" */) {
    const data = await request(
      `?ranges=${encodeURIComponent(a1CellRange)}&fields=sheets(data(rowData(values(dataValidation))))`
    );
    try {
      const cell = data.sheets[0].data[0].rowData[0].values[0];
      const values = cell.dataValidation.condition.values || [];
      return values.map((v) => v.userEnteredValue);
    } catch (e) {
      console.error(`Could not read dropdown options for ${a1CellRange}:`, e);
      return [];
    }
  }

  async function appendRow(tabName, rowValuesInHeaderOrder) {
    return request(
      `/values/${encodeURIComponent(tabName)}:append?valueInputOption=USER_ENTERED`,
      { method: "POST", body: JSON.stringify({ values: [rowValuesInHeaderOrder] }) }
    );
  }

  async function updateCell(a1Range, value) {
    return request(
      `/values/${encodeURIComponent(a1Range)}?valueInputOption=USER_ENTERED`,
      { method: "PUT", body: JSON.stringify({ values: [[value]] }) }
    );
  }

  const sheetIdCache = {};
  async function getSheetId(tabName) {
    if (sheetIdCache[tabName] !== undefined) return sheetIdCache[tabName];
    const meta = await request(`?fields=sheets(properties(sheetId,title))`);
    const match = meta.sheets.find((s) => s.properties.title === tabName);
    sheetIdCache[tabName] = match ? match.properties.sheetId : null;
    return sheetIdCache[tabName];
  }

  async function deleteRow(tabName, rowIndex) {
    const sheetId = await getSheetId(tabName);
    return request(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({
        requests: [
          { deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: rowIndex - 1, endIndex: rowIndex } } },
        ],
      }),
    });
  }

  function colLetter(headers, headerName) {
    const idx = headers.indexOf(headerName);
    if (idx === -1) return null;
    let n = idx + 1, s = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  return { getTable, getKeyValuePairs, getDropdownOptions, appendRow, updateCell, deleteRow, colLetter };
})();