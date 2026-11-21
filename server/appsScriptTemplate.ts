export function generateAppsScriptCode(spreadsheetId?: string, driveFolderId?: string): string {
  const idLiteral = spreadsheetId || 'YOUR_SPREADSHEET_ID_HERE';
  const folderLiteral = driveFolderId || 'AUTO_CREATE_ROOT_FOLDER';
  return `/**
 * Trendy Unisex Salon Management System — Google Sheets DB & Google Drive Storage Bridge
 * Business: Trendy Unisex Salon, Busia District Road, Madibira 'A', Uganda
 * Currency: UGX
 *
 * ZERO Service Account Setup (Works on Vercel with any Google / Gmail account):
 * 1. Open your Salon Google Sheet -> Extensions -> Apps Script.
 * 2. Paste this entire file into Code.gs and click Save.
 * 3. Optional security: In Project Settings -> Script Properties, add SALON_BRIDGE_SECRET
 *    matching your Vercel GOOGLE_APPS_SCRIPT_SECRET env var.
 * 4. Click Deploy -> New deployment -> Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Copy the Web App URL (https://script.google.com/macros/s/.../exec) and set it as
 *    GOOGLE_APPS_SCRIPT_URL in Vercel (or paste it in Settings -> Google Workspace).
 */

var SPREADSHEET_ID = '${idLiteral}';
var DRIVE_ROOT_FOLDER_ID = '${folderLiteral}';
var SALON_DRIVE_ROOT_NAME = 'Trendy Unisex Salon - Records & Media';
var BRIDGE_SECRET = ''; // Optional fallback if not using Script Properties

var DRIVE_SUBFOLDERS = {
  'Employee Photo': 'Employee Photos',
  'National ID': 'National IDs',
  'Trading Licence': 'Business & Licensing',
  'Expense Receipt': 'Expense Receipts',
  'Staff Contract': 'Staff Contracts',
  'Salon Media': 'Salon Media',
  'Supplier Invoice': 'Supplier Invoices',
  'Backup': 'Backups & Exports',
  'Other': 'Other Documents'
};

function getSpreadsheet_(overrideId) {
  if (overrideId && overrideId !== 'YOUR_SPREADSHEET_ID_HERE') {
    return SpreadsheetApp.openById(overrideId);
  }
  var savedTargetId = PropertiesService.getScriptProperties().getProperty('TARGET_SPREADSHEET_ID');
  if (savedTargetId) {
    return SpreadsheetApp.openById(savedTargetId);
  }
  if (SPREADSHEET_ID && SPREADSHEET_ID !== 'YOUR_SPREADSHEET_ID_HERE') {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error('No Google Spreadsheet linked yet. Call createNewSheet or bind Code.gs to a Sheet.');
  }
  return active;
}

function verifySecret_(provided) {
  var expected =
    PropertiesService.getScriptProperties().getProperty('SALON_BRIDGE_SECRET') ||
    BRIDGE_SECRET;
  if (expected && String(provided || '') !== String(expected)) {
    throw new Error('Unauthorized Apps Script bridge secret.');
  }
}

function getOrCreateFolder_(name, parent) {
  var iter = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  while (iter.hasNext()) {
    var f = iter.next();
    if (!f.isTrashed()) return f;
  }
  return parent ? parent.createFolder(name) : DriveApp.createFolder(name);
}

function getSalonRootFolder_() {
  if (DRIVE_ROOT_FOLDER_ID && DRIVE_ROOT_FOLDER_ID !== 'AUTO_CREATE_ROOT_FOLDER') {
    try {
      var existing = DriveApp.getFolderById(DRIVE_ROOT_FOLDER_ID);
      if (existing && !existing.isTrashed()) return existing;
    } catch (e) {
      // Fallback to search/create by name
    }
  }
  return getOrCreateFolder_(SALON_DRIVE_ROOT_NAME, null);
}

function getCategoryFolder_(category) {
  var root = getSalonRootFolder_();
  var subName = DRIVE_SUBFOLDERS[category] || 'Other Documents';
  var sub = getOrCreateFolder_(subName, root);
  return { root: root, sub: sub, folderName: subName };
}

function formatCellValue_(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return val;
}

function getWorkbookData_(ss) {
  var allSheets = ss.getSheets();
  var sheetsMap = {};
  var summaries = [];
  for (var i = 0; i < allSheets.length; i++) {
    var sh = allSheets[i];
    var name = sh.getName();
    var lastRow = sh.getLastRow();
    var lastCol = sh.getLastColumn();
    if (name === '_SystemState' || lastRow < 2 || lastCol < 1) {
      summaries.push({
        name: name,
        rowCount: Math.max(0, lastRow - 1),
        headers: lastRow >= 1 && lastCol >= 1
          ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h || '').trim(); }).filter(Boolean)
          : []
      });
      continue;
    }
    var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
    var rawHeaders = values[0] || [];
    var headers = [];
    for (var c = 0; c < rawHeaders.length; c++) {
      var h = String(rawHeaders[c] || '').trim();
      headers.push(h || ('Column_' + (c + 1)));
    }
    var rowsOut = [];
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var obj = {};
      var hasContent = false;
      for (var c2 = 0; c2 < headers.length; c2++) {
        var cell = formatCellValue_(row[c2]);
        if (cell !== '' && cell !== null && cell !== undefined) {
          hasContent = true;
        }
        obj[headers[c2]] = cell === undefined || cell === null ? '' : cell;
      }
      if (hasContent) rowsOut.push(obj);
    }
    sheetsMap[name] = rowsOut;
    summaries.push({
      name: name,
      rowCount: rowsOut.length,
      headers: headers
    });
  }
  return {
    sheets: sheetsMap,
    tabSummaries: summaries,
    hasSystemState: Boolean(ss.getSheetByName('_SystemState'))
  };
}

function doGet(e) {
  var params = (e && e.parameter) || {};
  try {
    verifySecret_(params.secret);
    var action = params.action || 'health';
    var ss = getSpreadsheet_();
    if (action === 'health') {
      var root = getSalonRootFolder_();
      var wbMeta = getWorkbookData_(ss);
      return jsonResponse_({
        ok: true,
        business: 'Trendy Unisex Salon',
        spreadsheetId: ss.getId(),
        spreadsheetUrl: ss.getUrl(),
        rootFolderId: root.getId(),
        hasSystemState: wbMeta.hasSystemState,
        sheetTabs: wbMeta.tabSummaries
      });
    }
    if (action === 'readWorkbook') {
      var wb = getWorkbookData_(ss);
      return jsonResponse_({
        ok: true,
        spreadsheetId: ss.getId(),
        spreadsheetUrl: ss.getUrl(),
        hasSystemState: wb.hasSystemState,
        tabSummaries: wb.tabSummaries,
        sheets: wb.sheets
      });
    }
    if (action === 'readSheet') {
      var sheetName = params.sheet;
      if (!sheetName) return jsonResponse_({ error: 'Missing sheet parameter' });
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet) return jsonResponse_({ error: 'Sheet not found: ' + sheetName });
      return jsonResponse_({ ok: true, sheet: sheetName, rows: sheet.getDataRange().getValues() });
    }
    return jsonResponse_({ error: 'Unsupported action: ' + action });
  } catch (err) {
    return jsonResponse_({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    verifySecret_(payload.secret);
    var action = payload.action || 'health';

    if (action === 'createNewSheet') {
      var titleStr = payload.title || 'Trendy Unisex Salon - Database';
      var newSs = SpreadsheetApp.create(titleStr);
      PropertiesService.getScriptProperties().setProperty('TARGET_SPREADSHEET_ID', newSs.getId());
      var rootDirNew = getSalonRootFolder_();
      var initSheets = payload.sheets || {};
      var initTabs = Object.keys(initSheets);
      var newUpdatedCells = 0;
      for (var nIdx = 0; nIdx < initTabs.length; nIdx++) {
        var nTitle = initTabs[nIdx];
        var nRows = initSheets[nTitle] || [];
        var nSheet = newSs.getSheetByName(nTitle) || newSs.insertSheet(nTitle);
        nSheet.clearContents();
        if (nRows.length > 0) {
          var nMaxCols = 0;
          for (var nr = 0; nr < nRows.length; nr++) {
            if (nRows[nr].length > nMaxCols) nMaxCols = nRows[nr].length;
          }
          if (nMaxCols > 0) {
            var nPadded = [];
            for (var nr2 = 0; nr2 < nRows.length; nr2++) {
              var nCopy = nRows[nr2].slice();
              while (nCopy.length < nMaxCols) nCopy.push('');
              nPadded.push(nCopy);
            }
            nSheet.getRange(1, 1, nPadded.length, nMaxCols).setValues(nPadded);
            newUpdatedCells += nPadded.length * nMaxCols;
          }
        }
      }
      var defaultBlank = newSs.getSheetByName('Sheet1');
      if (defaultBlank && newSs.getSheets().length > 1) {
        newSs.deleteSheet(defaultBlank);
      }
      SpreadsheetApp.flush();
      return jsonResponse_({
        ok: true,
        spreadsheetId: newSs.getId(),
        spreadsheetUrl: newSs.getUrl(),
        rootFolderId: rootDirNew.getId(),
        sheetCount: initTabs.length,
        updatedCells: newUpdatedCells
      });
    }

    var ss = getSpreadsheet_(payload.spreadsheetId);

    if (action === 'health') {
      var rootFolder = getSalonRootFolder_();
      var postMeta = getWorkbookData_(ss);
      return jsonResponse_({
        ok: true,
        business: 'Trendy Unisex Salon',
        spreadsheetId: ss.getId(),
        spreadsheetUrl: ss.getUrl(),
        rootFolderId: rootFolder.getId(),
        hasSystemState: postMeta.hasSystemState,
        sheetTabs: postMeta.tabSummaries
      });
    }

    if (action === 'readWorkbook') {
      var postWb = getWorkbookData_(ss);
      return jsonResponse_({
        ok: true,
        spreadsheetId: ss.getId(),
        spreadsheetUrl: ss.getUrl(),
        hasSystemState: postWb.hasSystemState,
        tabSummaries: postWb.tabSummaries,
        sheets: postWb.sheets
      });
    }

    if (action === 'syncMatrix') {
      var sheetsObj = payload.sheets || {};
      var tabNames = Object.keys(sheetsObj);
      var updatedCells = 0;
      for (var i = 0; i < tabNames.length; i++) {
        var title = tabNames[i];
        var rows = sheetsObj[title] || [];
        var sheet = ss.getSheetByName(title);
        if (!sheet) {
          sheet = ss.insertSheet(title);
        }
        sheet.clearContents();
        if (rows.length > 0) {
          var maxCols = 0;
          for (var r = 0; r < rows.length; r++) {
            if (rows[r].length > maxCols) maxCols = rows[r].length;
          }
          if (maxCols > 0) {
            var padded = [];
            for (var r2 = 0; r2 < rows.length; r2++) {
              var rowCopy = rows[r2].slice();
              while (rowCopy.length < maxCols) rowCopy.push('');
              padded.push(rowCopy);
            }
            sheet.getRange(1, 1, padded.length, maxCols).setValues(padded);
            updatedCells += padded.length * maxCols;
          }
        }
      }
      SpreadsheetApp.flush();
      return jsonResponse_({
        ok: true,
        updatedCells: updatedCells,
        sheetTabs: tabNames,
        spreadsheetId: ss.getId(),
        spreadsheetUrl: ss.getUrl()
      });
    }

    if (action === 'readState') {
      var stateSheet = ss.getSheetByName('_SystemState');
      if (!stateSheet) {
        return jsonResponse_({ ok: true, rows: [] });
      }
      var stateRows = stateSheet.getDataRange().getValues();
      return jsonResponse_({
        ok: true,
        rows: stateRows,
        spreadsheetId: ss.getId(),
        spreadsheetUrl: ss.getUrl()
      });
    }

    if (action === 'readSheet') {
      var allSheets = ss.getSheets();
      var availableTabs = [];
      for (var s = 0; s < allSheets.length; s++) {
        availableTabs.push(allSheets[s].getName());
      }
      if (availableTabs.length === 0) {
        return jsonResponse_({ ok: true, availableTabs: [], activeTab: '', rows: [] });
      }
      var requestedTab = payload.sheetTitle;
      var activeTab = requestedTab && availableTabs.indexOf(requestedTab) !== -1
        ? requestedTab
        : availableTabs[0];
      var targetSheet = ss.getSheetByName(activeTab);
      var values = targetSheet ? targetSheet.getDataRange().getValues() : [];
      return jsonResponse_({
        ok: true,
        availableTabs: availableTabs,
        activeTab: activeTab,
        rows: values
      });
    }

    if (action === 'driveUpload') {
      var catInfo = getCategoryFolder_(payload.category || 'Other');
      var bytes = Utilities.base64Decode(payload.base64Data || '');
      var blob = Utilities.newBlob(
        bytes,
        payload.mimeType || 'application/octet-stream',
        payload.fileName || ('file_' + Date.now())
      );
      var createdFile = catInfo.sub.createFile(blob);
      if (payload.description) {
        createdFile.setDescription(payload.description);
      }
      return jsonResponse_({
        ok: true,
        rootFolderId: catInfo.root.getId(),
        folderId: catInfo.sub.getId(),
        folderName: catInfo.folderName,
        file: {
          id: createdFile.getId(),
          name: createdFile.getName(),
          mimeType: createdFile.getMimeType(),
          sizeBytes: createdFile.getSize(),
          webViewLink: createdFile.getUrl()
        }
      });
    }

    if (action === 'driveList') {
      var rootDir = getSalonRootFolder_();
      var filesOut = [];
      function collectFolder_(folder) {
        var fIter = folder.getFiles();
        while (fIter.hasNext() && filesOut.length < 100) {
          var fl = fIter.next();
          if (!fl.isTrashed()) {
            filesOut.push({
              id: fl.getId(),
              name: fl.getName(),
              mimeType: fl.getMimeType(),
              modifiedTime: fl.getLastUpdated().toISOString(),
              size: String(fl.getSize()),
              webViewLink: fl.getUrl(),
              parents: [folder.getId()]
            });
          }
        }
        var subIter = folder.getFolders();
        while (subIter.hasNext() && filesOut.length < 100) {
          var subF = subIter.next();
          if (!subF.isTrashed()) collectFolder_(subF);
        }
      }
      collectFolder_(rootDir);
      filesOut.sort(function(a, b) {
        return a.modifiedTime < b.modifiedTime ? 1 : -1;
      });
      return jsonResponse_({
        ok: true,
        rootFolderId: rootDir.getId(),
        files: filesOut.slice(0, 50)
      });
    }

    if (action === 'driveMedia') {
      var fileObj = DriveApp.getFileById(payload.fileId);
      if (!fileObj || fileObj.isTrashed()) {
        return jsonResponse_({ ok: false, error: 'File not found or trashed in Google Drive.' });
      }
      var fBlob = fileObj.getBlob();
      return jsonResponse_({
        ok: true,
        name: fileObj.getName(),
        mimeType: fBlob.getContentType() || 'application/octet-stream',
        base64Data: Utilities.base64Encode(fBlob.getBytes())
      });
    }

    if (action === 'driveDelete') {
      try {
        var delFile = DriveApp.getFileById(payload.fileId);
        if (delFile) delFile.setTrashed(true);
      } catch (notFoundErr) {
        // Ignore already deleted
      }
      return jsonResponse_({ ok: true });
    }

    return jsonResponse_({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse_({ ok: false, error: err && err.message ? err.message : String(err) });
  } finally {
    lock.releaseLock();
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
`;
}
