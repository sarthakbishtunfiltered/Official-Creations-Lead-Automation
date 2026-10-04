// ============================================================
// SHEETS API — thin wrapper. Every read/write goes through the
// signed-in user's own token, so Google enforces Viewer/Editor
// permissions for us; the site does not maintain its own DB.
// ============================================================

const SheetsAPI = (() => {
  const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

  async function request(path, options = {}) {
    const resp = await fetch(
      `${BASE}/${CONFIG.SPREADSHEET_ID}${path}`,
      {
        ...options,
        headers: {
          ...Auth.authHeaders(),
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
      }
    );

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Sheets API ${resp.status}: ${body}`);
    }

    return resp.status === 204 ? null : resp.json();
  }

  // ============================================================
  // TABLE READER
  // ============================================================

  async function getTable(tabName) {
    const data = await request(
      `/values/${encodeURIComponent(tabName)}`
    );

    const values = data.values || [];

    if (values.length === 0) {
      return {
        headers: [],
        rows: [],
      };
    }

    const [headers, ...rest] = values;

    const rows = rest.map((r, i) => {
      const obj = {
        __rowIndex: i + 2,
      };

      headers.forEach((h, idx) => {
        obj[h] = r[idx] ?? "";
      });

      return obj;
    });

    return {
      headers,
      rows,
    };
  }

  // ============================================================
  // SETTINGS KEY/VALUE READER
  // ============================================================

  async function getKeyValuePairs(tabName) {
    const data = await request(
      `/values/${encodeURIComponent(tabName)}!A:B`
    );

    const values = data.values || [];

    return values.map((row, i) => ({
      key: (row[0] || "").toString(),
      value: (row[1] || "").toString(),
      rowIndex: i + 1,
    }));
  }

  // ============================================================
  // DROPDOWN OPTIONS
  // ============================================================

  async function getDropdownOptions(a1CellRange) {
    const data = await request(
      `?ranges=${encodeURIComponent(
        a1CellRange
      )}&fields=sheets(data(rowData(values(dataValidation))))`
    );

    try {
      const cell =
        data.sheets[0].data[0].rowData[0].values[0];

      const values =
        cell.dataValidation.condition.values || [];

      return values.map(
        (v) => v.userEnteredValue
      );
    } catch (e) {
      console.error(
        `Could not read dropdown options for ${a1CellRange}:`,
        e
      );

      return [];
    }
  }

  // ============================================================
  // SHEET METADATA
  // ============================================================

  async function getSheetProperties(tabName) {
    const meta = await request(
      `?fields=sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))`
    );

    const match = meta.sheets.find(
      (s) =>
        s.properties.title === tabName
    );

    if (!match) {
      throw new Error(
        `Sheet tab not found: ${tabName}`
      );
    }

    return match.properties;
  }

  // ============================================================
  // CHECK WHETHER A ROW IS A REAL LEAD
  //
  // For the Leads sheet, blank rows may still contain things
  // such as formatting, validation, or other leftover values.
  //
  // We only consider a row a real lead when it has a Lead ID
  // OR a Business Name.
  // ============================================================

  function isActualLeadRow(row, headers) {
    if (!Array.isArray(row)) {
      return false;
    }

    const leadIdIndex =
      headers.indexOf("Lead ID");

    const businessNameIndex =
      headers.indexOf("Business Name");

    const leadId =
      leadIdIndex !== -1
        ? String(
            row[leadIdIndex] ?? ""
          ).trim()
        : "";

    const businessName =
      businessNameIndex !== -1
        ? String(
            row[businessNameIndex] ?? ""
          ).trim()
        : "";

    return (
      leadId !== "" ||
      businessName !== ""
    );
  }

  // ============================================================
  // APPEND ROW
  //
  // IMPORTANT:
  //
  // This does NOT use the first blank row.
  // This does NOT use the last physical grid row.
  //
  // For Leads:
  //
  //   Row 1 = headers
  //   Row 2 = first real lead
  //   Row 3 = second real lead
  //
  // If there are blank rows anywhere, they are ignored.
  //
  // Example:
  //
  // Row 1 = Headers
  // Row 2 = Lead A
  // Row 3 = Lead B
  // Row 4 = blank
  // Row 5 = blank
  // Row 6 = blank
  //
  // New lead -> Row 4
  //
  // Even if Google Sheets has 1000 physical rows, the new
  // lead still goes immediately after Lead B.
  //
  // If there are no real leads:
  //
  // Row 1 = Headers
  // Row 2 = New lead
  // ============================================================

  async function appendRow(
    tabName,
    rowValuesInHeaderOrder
  ) {
    const data = await request(
      `/values/${encodeURIComponent(tabName)}`
    );

    const values = data.values || [];

    if (values.length === 0) {
      throw new Error(
        `The ${tabName} sheet has no header row.`
      );
    }

    const headers = values[0] || [];

    // ----------------------------------------------------------
    // Find the LAST ACTUAL LEAD.
    //
    // Do not trust values.length.
    // Do not trust the physical grid size.
    // Do not treat arbitrary cells in blank rows as leads.
    // ----------------------------------------------------------

    let lastLeadRow = 1;

    for (let i = 1; i < values.length; i++) {
      const row = values[i];

      if (
        isActualLeadRow(
          row,
          headers
        )
      ) {
        lastLeadRow = i + 1;
      }
    }

    // Immediately after the last real lead.
    //
    // If there are no real leads:
    // lastLeadRow = 1
    // targetRow = 2
    const targetRow =
      lastLeadRow + 1;

    // ----------------------------------------------------------
    // Make sure the physical Google Sheets grid has this row.
    // ----------------------------------------------------------

    const properties =
      await getSheetProperties(tabName);

    const currentRowCount =
      properties.gridProperties?.rowCount || 0;

    if (
      targetRow >
      currentRowCount
    ) {
      const rowsToAdd =
        targetRow -
        currentRowCount;

      await request(
        ":batchUpdate",
        {
          method: "POST",
          body: JSON.stringify({
            requests: [
              {
                appendDimension: {
                  sheetId:
                    properties.sheetId,
                  dimension: "ROWS",
                  length: rowsToAdd,
                },
              },
            ],
          }),
        }
      );
    }

    // ----------------------------------------------------------
    // Determine ending column.
    // ----------------------------------------------------------

    let n =
      rowValuesInHeaderOrder.length;

    let lastColumn = "";

    while (n > 0) {
      const remainder =
        (n - 1) % 26;

      lastColumn =
        String.fromCharCode(
          65 + remainder
        ) +
        lastColumn;

      n = Math.floor(
        (n - 1) / 26
      );
    }

    // ----------------------------------------------------------
    // Write directly into the target row.
    // ----------------------------------------------------------

    return request(
      `/values/${encodeURIComponent(
        tabName
      )}!A${targetRow}:${lastColumn}${targetRow}?valueInputOption=USER_ENTERED`,
      {
        method: "PUT",
        body: JSON.stringify({
          values: [
            rowValuesInHeaderOrder,
          ],
        }),
      }
    );
  }

  // ============================================================
  // UPDATE SINGLE CELL
  // ============================================================

  async function updateCell(
    a1Range,
    value
  ) {
    return request(
      `/values/${encodeURIComponent(
        a1Range
      )}?valueInputOption=USER_ENTERED`,
      {
        method: "PUT",
        body: JSON.stringify({
          values: [[value]],
        }),
      }
    );
  }

  // ============================================================
  // SHEET ID CACHE
  // ============================================================

  const sheetIdCache = {};

  async function getSheetId(tabName) {
    if (
      sheetIdCache[tabName] !== undefined
    ) {
      return sheetIdCache[tabName];
    }

    const meta = await request(
      `?fields=sheets(properties(sheetId,title))`
    );

    const match = meta.sheets.find(
      (s) =>
        s.properties.title ===
        tabName
    );

    sheetIdCache[tabName] =
      match
        ? match.properties.sheetId
        : null;

    return sheetIdCache[tabName];
  }

  // ============================================================
  // DELETE ONE ROW
  // ============================================================

  async function deleteRow(
    tabName,
    rowIndex
  ) {
    const sheetId =
      await getSheetId(tabName);

    if (sheetId === null) {
      throw new Error(
        `Sheet tab not found: ${tabName}`
      );
    }

    return request(
      ":batchUpdate",
      {
        method: "POST",
        body: JSON.stringify({
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId,
                  dimension: "ROWS",
                  startIndex:
                    rowIndex - 1,
                  endIndex:
                    rowIndex,
                },
              },
            },
          ],
        }),
      }
    );
  }

  // ============================================================
  // DELETE MULTIPLE ROWS
  // ============================================================

  async function deleteRows(
    tabName,
    rowIndexes
  ) {
    if (
      !rowIndexes ||
      rowIndexes.length === 0
    ) {
      return null;
    }

    const sheetId =
      await getSheetId(tabName);

    if (sheetId === null) {
      throw new Error(
        `Sheet tab not found: ${tabName}`
      );
    }

    const sorted = [
      ...new Set(rowIndexes),
    ].sort(
      (a, b) => b - a
    );

    const requests =
      sorted.map(
        (rowIndex) => ({
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex:
                rowIndex - 1,
              endIndex:
                rowIndex,
            },
          },
        })
      );

    return request(
      ":batchUpdate",
      {
        method: "POST",
        body: JSON.stringify({
          requests,
        }),
      }
    );
  }

  // ============================================================
  // COLUMN LETTER HELPER
  // ============================================================

  function colLetter(
    headers,
    headerName
  ) {
    const idx =
      headers.indexOf(
        headerName
      );

    if (idx === -1) {
      return null;
    }

    let n = idx + 1;
    let s = "";

    while (n > 0) {
      const remainder =
        (n - 1) % 26;

      s =
        String.fromCharCode(
          65 + remainder
        ) + s;

      n = Math.floor(
        (n - 1) / 26
      );
    }

    return s;
  }

  return {
    getTable,
    getKeyValuePairs,
    getDropdownOptions,
    appendRow,
    updateCell,
    deleteRow,
    deleteRows,
    colLetter,
  };
})();