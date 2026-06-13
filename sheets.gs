// Paste this into your spreadsheet's Apps Script editor (Extensions > Apps Script)
// Then deploy as a Web App: Deploy > New deployment > Web App
// Execute as: Me | Who has access: Anyone
// Copy the Web App URL into the Counter app's Config screen

function findCounterHeaderRow_(sheet) {
  const lastRow = Math.max(sheet.getLastRow(), 1);
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const values = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();

  for (let r = 0; r < values.length; r++) {
    const row = values[r].map(String);
    if (row[0] !== 'Date') continue;

    const nextFirstCell = r + 1 < values.length ? String(values[r + 1][0]) : '';
    const hasCounterTableMetrics = row.includes('Total Ro Patients') || row.includes('Total Earned');
    const nextRowLooksLikeEntry = /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(nextFirstCell);

    if (hasCounterTableMetrics || nextRowLooksLikeEntry) {
      return r + 1; // Apps Script rows are 1-based.
    }
  }

  // Empty/legacy sheet fallback: use row 1 like the original script.
  return 1;
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(data.tabName);
    if (!sheet) throw new Error('Tab not found: ' + data.tabName);

    // Read or initialize the daily counter table header row. The Revenue Tracker
    // Counters tab now has a monthly summary above the daily counter table, so
    // row 1 must not be treated as the counter header row.
    const headerRow = findCounterHeaderRow_(sheet);
    const lastCol = Math.max(sheet.getLastColumn(), 1);
    let headers = sheet.getLastRow() === 0
      ? []
      : sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0].map(String);

    if (!headers.includes('Date')) {
      headers = ['Date'];
      sheet.getRange(headerRow, 1).setValue('Date');
    }

    // Add missing counter columns to the daily counter header row only.
    for (const name of Object.keys(data.counts)) {
      if (!headers.includes(name)) {
        headers.push(name);
        sheet.getRange(headerRow, headers.length).setValue(name);
      }
    }

    // Add Timer column if missing, again only on the daily counter header row.
    if (!headers.includes('Timer')) {
      headers.push('Timer');
      sheet.getRange(headerRow, headers.length).setValue('Timer');
    }

    // Find existing row for this date below the daily counter header, or append.
    const lastRow = sheet.getLastRow();
    let targetRow = lastRow + 1;
    if (lastRow > headerRow) {
      const dates = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, 1).getDisplayValues();
      for (let i = 0; i < dates.length; i++) {
        if (dates[i][0] === data.date) { targetRow = headerRow + 1 + i; break; }
      }
    }

    // Write date
    sheet.getRange(targetRow, 1).setValue(data.date);

    // Write counter values
    for (const [name, count] of Object.entries(data.counts)) {
      const col = headers.indexOf(name) + 1;
      if (col > 0) sheet.getRange(targetRow, col).setValue(count);
    }

    // Write timer
    const timerCol = headers.indexOf('Timer') + 1;
    if (timerCol > 0) sheet.getRange(targetRow, timerCol).setNumberFormat('@STRING@').setValue(data.timer);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
