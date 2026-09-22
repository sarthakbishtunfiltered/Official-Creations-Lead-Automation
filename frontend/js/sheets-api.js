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

  // Returns { headers: [...], rows: [ {header: value, ...}, ... ] }
  async function getTable(tabName) {
    const data = await request(`/values/${encodeURIComponent(tabName)}`);
    const values = data.values || [];
    if (values.length === 0) return { headers: [], rows: [] };
    const [headers, ...rest] = values;
    const rows = rest.map((r, i) => {
      const obj = { __rowIndex: i + 2 }; // sheet row number (1 = header)
      headers.forEach((h, idx) => (obj[h] = r[idx] ?? ""));
      return obj;
    });
    return { headers, rows };
  }

  async function appendRow(tabName, rowValuesInHeaderOrder) {
    return request(
      `/values/${encodeURIComponent(tabName)}:append?valueInputOption=USER_ENTERED`,
      {
        method: "POST",
        body: JSON.stringify({ values: [rowValuesInHeaderOrder] }),
      }
    );
  }

  // Update a single cell by A1 notation, e.g. "Leads!F5"
  async function updateCell(a1Range, value) {
    return request(
      `/values/${encodeURIComponent(a1Range)}?valueInputOption=USER_ENTERED`,
      {
        method: "PUT",
        body: JSON.stringify({ values: [[value]] }),
      }
    );
  }

  // Delete a specific row from a tab by its sheet row number.
  // Requires the tab's numeric sheetId (fetched once and cached).
  const sheetIdCache = {};
  async function getSheetId(tabName) {
    if (sheetIdCache[tabName] !== undefined) return sheetIdCache[tabName];
    const meta = await request(`?fields=sheets(properties(sheetId,title))`);
    const match = meta.sheets.find((s) => s.properties.title === tabName);
    sheetIdCache[tabName] = match ? match.properties.sheetId : null;
    return sheetIdCache[tabName];
  }

  async function deleteRow(tabName, rowIndex /* 1-based sheet row */) {
    const sheetId = await getSheetId(tabName);
    return request(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: rowIndex - 1,
                endIndex: rowIndex,
              },
            },
          },
        ],
      }),
    });
  }

  function colLetter(headers, headerName) {
    const idx = headers.indexOf(headerName);
    if (idx === -1) return null;
    let n = idx + 1;
    let s = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  return { getTable, appendRow, updateCell, deleteRow, colLetter };
})();