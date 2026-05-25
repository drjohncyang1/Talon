// Paste this into your spreadsheet's Apps Script editor (Extensions > Apps Script)
// Then deploy as a Web App: Deploy > New deployment > Web App
// Execute as: Me | Who has access: Anyone
// Copy the Web App URL into the Counter app's Config screen

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(data.tabName);
    if (!sheet) throw new Error('Tab not found: ' + data.tabName);

    // Read or initialize header row
    const lastCol = Math.max(sheet.getLastColumn(), 1);
    let headers = sheet.getLastRow() === 0
      ? []
      : sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);

    if (!headers.includes('Date')) {
      headers = ['Date'];
      sheet.getRange(1, 1).setValue('Date');
    }

    // Add missing counter columns
    for (const name of Object.keys(data.counts)) {
      if (!headers.includes(name)) {
        headers.push(name);
        sheet.getRange(1, headers.length).setValue(name);
      }
    }

    // Add Timer column if missing
    if (!headers.includes('Timer')) {
      headers.push('Timer');
      sheet.getRange(1, headers.length).setValue('Timer');
    }

    // Find existing row for this date, or append
    const lastRow = sheet.getLastRow();
    let targetRow = lastRow + 1;
    if (lastRow > 1) {
      const dates = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < dates.length; i++) {
        if (String(dates[i][0]) === data.date) { targetRow = i + 2; break; }
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
    if (timerCol > 0) sheet.getRange(targetRow, timerCol).setValue(data.timer);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
