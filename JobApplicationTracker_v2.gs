/**
 * ============================================================
 *  JOB APPLICATION TRACKER v2 — Google Apps Script
 *
 *  NEW in v2:
 *    • Maintains a live "Job Tracker" Google Sheet that mirrors
 *      your Excel (JobHunt 2026 columns exactly)
 *    • Auto-updates Result + Submission Status when Gmail
 *      detects a rejection / interview / offer
 *    • Adds new applications it finds in Gmail (not yet tracked)
 *    • Summary tab auto-computed with COUNTIF formulas
 *
 *  Gmail labels created/managed:
 *    Jobs/Applied  |  Jobs/Rejected  |  Jobs/Congratulations  |  Jobs/_Processed
 *
 *  HOW TO DEPLOY:
 *    1. Go to https://script.google.com → New project
 *    2. Paste this file → Save (Ctrl+S)
 *    3. Select "setup" from the dropdown → Run → Authorize
 *    4. Done. Runs every hour automatically.
 *
 *  HOW TO IMPORT YOUR EXCEL DATA:
 *    After running setup(), a Google Sheet named "Job Tracker" is created.
 *    Open it and paste your existing Excel rows under the headers.
 *    The script will match companies from Gmail to rows in this sheet.
 * ============================================================
 */

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const GMAIL_LABELS = {
  applied:         'Jobs/Applied',
  rejected:        'Jobs/Rejected',
  congratulations: 'Jobs/Congratulations',
  processed:       'Jobs/_Processed',
};

const SHEET_NAME   = 'Job Tracker';   // Google Sheet name
const TAB_TRACKER  = 'JobHunt 2026';  // Main data tab (mirrors your Excel)
const TAB_SUMMARY  = 'Summary';       // Summary tab

// ── Google Drive export (for D: drive sync) ──────────────────────────────────
// Your D: drive syncs to Google Drive. The Apps Script writes a CSV into the
// matching Google Drive folder. Google Drive Desktop syncs it to your D: drive.
// sync_script.py then reads that local file — no public URL needed.
//
// Set this to the EXACT name of the Google Drive folder where your Excel lives.
// e.g. if the file is at D:\...\04. Tracker And Analysis\JobTracker_Organized.xlsx
// then the folder name is '04. Tracker And Analysis'
const DRIVE_EXPORT_FOLDER  = '04. Tracker And Analysis';
const DRIVE_EXPORT_FILENAME = 'job_tracker_gs_export.csv';

// Excel-matching column headers (exact order)
const TRACKER_HEADERS = [
  'Date of Apply', 'Organization', 'Location', 'Role',
  'Exp. Required', 'Submission Status', 'Portal',
  'Salary', 'URL', 'Referred by', 'Result', 'Gmail Synced On',
];

// Column indices (1-based, matching TRACKER_HEADERS)
const COL = {
  date:       1,
  org:        2,
  location:   3,
  role:       4,
  exp:        5,
  status:     6,
  portal:     7,
  salary:     8,
  url:        9,
  referredBy: 10,
  result:     11,
  synced:     12,
};

// ─── CLASSIFICATION PATTERNS ─────────────────────────────────────────────────

const PATTERNS = {
  rejected: [
    'we regret to inform', 'regret to let you know',
    'not moving forward', 'not moving ahead',
    'decided not to move forward', 'decided to move forward with other',
    'not proceed with your application', 'will not be proceeding',
    'not been shortlisted', 'not shortlisted', 'not selected',
    'not a match', 'not the right fit', 'no longer being considered',
    'position has been filled', 'closed this position', 'filled this role',
    // EY-style "closed/filled" language
    'has been closed', 'been closed/filled', 'closed or filled', 'closed/filled',
    'requisition you applied for', 'role has been closed', 'job has been closed',
    'opening has been closed', 'opening has been filled',
    // Other common misses
    'application was not successful', 'application has not been successful',
    'after careful consideration', 'unfortunately', 'regretfully',
    'we\'ve decided', 'we have decided',
    'other candidates whose experience', 'candidature',
    'application status: rejected', 'status: declined',
    'thank you for your time, however',
    'we won\'t be moving', 'won\'t be able to move forward',
    // REMOVED C4: 'appreciate your interest', 'keep you in mind for future', 'future opportunities'
    // These appear in APPLICATION CONFIRMATION emails too (LinkedIn, Naukri auto-replies).
    // e.g. "We appreciate your interest. We'll keep you in mind for future opportunities."
    // Keeping them caused applied confirmations to be misclassified as rejections.
  ],
  congratulations: [
    'congratulations', 'pleased to offer', 'happy to offer',
    'would like to offer', 'offer letter', 'offer of employment', 'job offer',
    'we are pleased to inform', 'happy to inform you',
    'you have been selected', 'you\'ve been selected',
    'moving forward with your application',
    'we\'d like to invite you', 'invitation to interview', 'interview invitation',
    'schedule an interview', 'schedule a call',
    'technical round', 'technical interview', 'coding interview',
    'phone screen', 'phone interview', 'video interview',
    'next round', 'next steps in the process',
    'background check', 'reference check',
    'onboarding', 'start date', 'welcome to the team',
  ],
  applied: [
    'thank you for applying', 'thanks for applying',
    'application received', 'we received your application',
    'application has been submitted', 'application has been received',
    'successfully applied', 'thank you for submitting',
    'thank you for your interest in joining', 'thank you for your interest in',
    'your application for', 'application confirmation',
    'application under review', 'we will review your application',
    'is being reviewed', 'under review', 'will be in touch',
  ],
};

const JOB_SIGNALS = [
  'greenhouse.io', 'lever.co', 'workday.com', 'ashbyhq.com',
  'smartrecruiters.com', 'jobvite.com', 'icims.com', 'taleo.net',
  'successfactors.com', 'bamboohr.com', 'linkedin.com',
  'indeed.com', 'glassdoor.com',
  'recruiting', 'recruitment', 'talent acquisition', 'talent team',
  'careers@', 'jobs@', 'hr@',
  'your application', 'application for', 'application update',
  'job application', 'job opportunity', 'position at', 'role at',
];

// ─── WEB APP ENDPOINT (Chrome Extension → Google Sheet) ──────────────────────

/**
 * Called by the Chrome extension's Save button via HTTP POST.
 * Receives job JSON and adds a new row to the tracker sheet.
 *
 * Deploy as Web App:
 *   Apps Script → Deploy → New deployment → Type: Web App
 *   Execute as: Me | Who has access: Anyone
 *   → Copy the Web App URL → paste into extension Options page
 */
function doPost(e) {
  try {
    const raw  = e.postData ? e.postData.contents : '{}';
    const data = JSON.parse(raw);

    _ensureTrackerSheet();
    const sheet = _getTrackerTab();
    if (!sheet) return _jsonResponse({ ok: false, error: 'Sheet tab not found' });

    // De-duplicate: skip if URL already exists
    if (data.url && _urlExists(sheet, data.url)) {
      return _jsonResponse({ ok: false, skipped: true, reason: 'duplicate url' });
    }

    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');

    sheet.appendRow([
      data.date     || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      data.company  || '',
      data.location || '',
      data.title    || '',
      data.experience || '',
      'Applied',
      data.portal   || '',
      data.salary   || '',
      data.url      || '',
      '',            // Referred by (user fills manually)
      '',            // Result (filled by Gmail tracker)
      now + ' (extension)',
    ]);

    return _jsonResponse({ ok: true });
  } catch (err) {
    return _jsonResponse({ ok: false, error: err.message });
  }
}

/** Liveness check — open this URL in a browser to confirm the Web App is deployed.
 *  Q6 fix: Chrome extensions bypass CORS, so this is NOT needed for CORS preflight.
 *  It's purely for manual testing: paste the Web App URL in a browser tab to verify it works. */
function doGet(e) {
  return _jsonResponse({ ok: true, status: 'Job Tracker Web App is live' });
}

function _jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function _urlExists(sheet, url) {
  if (sheet.getLastRow() <= 1) return false;
  const urls = sheet.getRange(2, COL.url, sheet.getLastRow() - 1, 1).getValues();
  return urls.some(r => String(r[0]).trim() === url.trim());
}

// ─── ENTRY POINTS ────────────────────────────────────────────────────────────

/**
 * Run ONCE to set everything up.
 */
function setup() {
  Logger.log('═══ Job Application Tracker v2: Setup ═══');
  _ensureGmailLabels();
  _ensureTrackerSheet();
  _migrateExistingRejectedLabel();
  _processThreads(500);
  _setupTrigger();
  Logger.log('Setup complete. Tracker runs every hour.');
}

/**
 * Hourly auto-run (registered by setup).
 */
function processJobEmails() {
  Logger.log('═══ Hourly run ═══');
  _processThreads(100);
  exportCSVToGoogleDrive();  // write CSV → Drive folder → D: drive auto-syncs
}

/**
 * Exports the JobHunt 2026 tab as a CSV file directly into the Google Drive
 * folder that corresponds to your D: drive tracker directory.
 *
 * Because your D: drive is already synced to Google Drive, the CSV appears
 * in that local folder automatically — sync_script.py picks it up from there.
 * No public CSV URL needed.
 *
 * Safe to call manually: Apps Script → select exportCSVToGoogleDrive → Run
 */
function exportCSVToGoogleDrive() {
  try {
    const sheet = _getTrackerTab();
    if (!sheet || sheet.getLastRow() <= 1) {
      Logger.log('exportCSV: no data to export yet.');
      return;
    }

    // Build CSV from all rows including header
    const data = sheet.getDataRange().getValues();
    const csv  = data.map(row =>
      row.map(cell => {
        const s = String(cell == null ? '' : cell).replace(/"/g, '""');
        return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s}"` : s;
      }).join(',')
    ).join('\r\n');

    // Find the target folder in Google Drive
    const folders = DriveApp.getFoldersByName(DRIVE_EXPORT_FOLDER);
    if (!folders.hasNext()) {
      Logger.log(`exportCSV: Drive folder "${DRIVE_EXPORT_FOLDER}" not found.`);
      Logger.log('  → Check that DRIVE_EXPORT_FOLDER matches the exact folder name in Google Drive.');
      return;
    }
    const folder = folders.next();

    // Replace existing export file (avoid accumulating stale copies)
    const existing = folder.getFilesByName(DRIVE_EXPORT_FILENAME);
    while (existing.hasNext()) existing.next().setTrashed(true);

    folder.createFile(DRIVE_EXPORT_FILENAME, csv, MimeType.PLAIN_TEXT);
    Logger.log(`exportCSV: wrote ${data.length - 1} rows → Drive/"${DRIVE_EXPORT_FOLDER}"/${DRIVE_EXPORT_FILENAME}`);
    Logger.log('  Google Drive Desktop will sync this to your D: drive within seconds.');

  } catch (err) {
    Logger.log(`exportCSV error: ${err.message}`);
  }
}

/**
 * Quick stats — run manually from Apps Script.
 */
function generateReport() {
  const sheet = _getTrackerTab();
  if (!sheet) { Logger.log('Sheet not found — run setup() first.'); return; }

  const data = sheet.getDataRange().getValues().slice(1); // skip header
  let applied = 0, rejected = 0, interviewing = 0, offers = 0;

  data.forEach(row => {
    const status = String(row[COL.status - 1] || '').toLowerCase();
    const result = String(row[COL.result - 1] || '').toLowerCase();
    if (result.includes('reject'))         rejected++;
    else if (result.includes('offer') || result.includes('congrat')) offers++;
    else if (status.includes('interview') || status.includes('hr called')) interviewing++;
    else if (status.includes('applied') || status.includes('referred') || status.includes('mailed')) applied++;
  });

  Logger.log([
    '╔══════════════════════════════════════╗',
    '║   JOB APPLICATION TRACKER REPORT    ║',
    '╠══════════════════════════════════════╣',
    `║  ✅ Applied/Pending   : ${String(applied).padEnd(13)}║`,
    `║  🔄 Interviewing      : ${String(interviewing).padEnd(13)}║`,
    `║  ❌ Rejected          : ${String(rejected).padEnd(13)}║`,
    `║  🎉 Offer/Positive    : ${String(offers).padEnd(13)}║`,
    '╚══════════════════════════════════════╝',
  ].join('\n'));
}

/**
 * Re-scans all already-processed threads and re-classifies any that were
 * missed (e.g. because patterns were added after they were first seen).
 *
 * Run manually: select reprocessMissed → Run
 * Safe to run multiple times — only adds labels, never removes them.
 */
function reprocessMissed() {
  Logger.log('═══ Re-processing missed threads ═══');
  const gmailLabels    = _getGmailLabels();
  const processedLabel = GmailApp.getUserLabelByName(GMAIL_LABELS.processed);
  const rejectedLabel  = GmailApp.getUserLabelByName(GMAIL_LABELS.rejected);
  const congratsLabel  = GmailApp.getUserLabelByName(GMAIL_LABELS.congratulations);

  if (!processedLabel) { Logger.log('No processed label found — run setup() first.'); return; }

  // FIX Q3: removed unused rejectedLabel + congratsLabel declarations (were wasteful API calls)

  // Get all _Processed threads that have NO category label yet
  const allProcessed = processedLabel.getThreads(0, 500);
  const uncategorised = allProcessed.filter(thread => {
    const names = thread.getLabels().map(l => l.getName());
    return !names.includes(GMAIL_LABELS.rejected) &&
           !names.includes(GMAIL_LABELS.congratulations) &&
           !names.includes(GMAIL_LABELS.applied);
  });

  Logger.log(`Checking ${uncategorised.length} previously uncategorised threads...`);
  let fixed = 0;

  const startTime = Date.now();
  for (const thread of uncategorised) {
    if (Date.now() - startTime > 4.5 * 60 * 1000) {
      Logger.log('Time limit — run again to continue.');
      break;
    }
    try {
      const corpus   = _buildCorpus(thread);
      const sender   = _extractSender(thread);
      const subject  = thread.getFirstMessageSubject();
      const date     = thread.getLastMessageDate();
      const category = _classify(corpus);
      if (category) {
        thread.addLabel(gmailLabels[category]);
        _syncToSheet(category, sender, subject, date, corpus);
        Logger.log(`[FIXED → ${category.toUpperCase()}] ${subject}`);
        fixed++;
      }
    } catch (e) {
      Logger.log(`Error: ${e.message}`);
    }
  }

  Logger.log(`Done — ${fixed} missed thread(s) recovered.`);
}

// ─── CORE PROCESSING ─────────────────────────────────────────────────────────

function _processThreads(maxThreads) {
  const gmailLabels = _getGmailLabels();
  const threads     = _fetchUnprocessedThreads(maxThreads);
  Logger.log(`Evaluating ${threads.length} threads`);

  const startTime  = Date.now();
  const TIME_LIMIT = 4.5 * 60 * 1000; // stop at 4.5 min to stay well under 6-min quota
  let processed = 0;

  for (const thread of threads) {
    if (Date.now() - startTime > TIME_LIMIT) {
      Logger.log(`Time limit reached — processed ${processed}/${threads.length}. Remainder handled next run.`);
      break;
    }
    try {
      _processThread(thread, gmailLabels);
      processed++;
    } catch (e) {
      Logger.log(`Thread error: ${e.message}`);
    }
  }

  Logger.log(`Done — ${processed} threads handled this run.`);
}

function _processThread(thread, gmailLabels) {
  const corpus    = _buildCorpus(thread);
  const sender    = _extractSender(thread);
  const subject   = thread.getFirstMessageSubject();
  const date      = thread.getLastMessageDate();

  // FIX C1: Always mark as processed regardless of job relevance.
  // Previously, non-job threads returned early without the _Processed label,
  // causing them to be re-evaluated every hour forever.
  if (!_isJobRelated(corpus, thread)) {
    thread.addLabel(gmailLabels.processed);
    return;
  }

  const category = _classify(corpus);

  if (category) {
    thread.addLabel(gmailLabels[category]);
    _syncToSheet(category, sender, subject, date, corpus);
    Logger.log(`[${category.toUpperCase().padEnd(14)}] ${subject}`);
  }

  thread.addLabel(gmailLabels.processed);
}

// ─── SHEET SYNC ──────────────────────────────────────────────────────────────

function _syncToSheet(category, sender, subject, date, corpus) {
  const sheet = _getTrackerTab();
  if (!sheet) return;

  const companyName = _extractCompanyName(sender, subject, corpus);
  if (!companyName) return;

  const existingRow = _findCompanyRow(sheet, companyName);
  const dateStr     = Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const now         = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');

  if (existingRow > 0) {
    // Update existing row
    const resultMap = {
      rejected:        `Rejected on ${dateStr}`,
      congratulations: `Interview/Offer on ${dateStr}`,
      applied:         'Applied',
    };
    const statusMap = {
      rejected:        'Rejected',
      congratulations: 'Interviewing',
      applied:         'Applied',
    };

    const currentResult = sheet.getRange(existingRow, COL.result).getValue();
    // Only update if not already more specific
    if (!currentResult || currentResult.toString().toLowerCase() === 'applied') {
      sheet.getRange(existingRow, COL.result).setValue(resultMap[category]);
      sheet.getRange(existingRow, COL.status).setValue(statusMap[category]);
    }
    sheet.getRange(existingRow, COL.synced).setValue(now);

  } else if (category !== 'applied') {
    // Add new row for unknown company (only if we got a real signal)
    const roleFromSubject = _extractRoleFromSubject(subject);
    sheet.appendRow([
      dateStr,
      companyName,
      '',
      roleFromSubject,
      '',
      category === 'rejected' ? 'Rejected' : 'Interviewing',
      'Gmail (auto)',
      '', '', '',
      category === 'rejected' ? `Rejected on ${dateStr}` : `Positive on ${dateStr}`,
      now,
    ]);
  }
}

function _findCompanyRow(sheet, companyName) {
  if (sheet.getLastRow() <= 1) return -1; // no data rows yet
  const values = sheet.getRange(2, COL.org, sheet.getLastRow() - 1, 1).getValues();
  const target  = companyName.toLowerCase().replace(/\s+/g, '');

  for (let i = 0; i < values.length; i++) {
    const cell = String(values[i][0]).toLowerCase().replace(/\s+/g, '');
    // FIX C2: empty string passes target.includes('') which is always true.
    // An empty Organization cell would match every company — skip it.
    if (!cell) continue;
    if (cell.includes(target) || target.includes(cell)) {
      return i + 2; // 1-indexed + header offset
    }
  }
  return -1;
}

// ─── EXTRACTION HELPERS ──────────────────────────────────────────────────────

function _buildCorpus(thread) {
  return thread.getMessages().map(msg => [
    msg.getSubject(),
    msg.getFrom(),
    msg.getPlainBody().substring(0, 6000), // Q5: raised from 3000 — ATS emails have long boilerplate before the decision keyword
  ].join(' ').toLowerCase()).join(' ');
}

function _extractSender(thread) {
  return thread.getMessages()[0].getFrom();
}

/**
 * Extracts company name from sender email / display name.
 * e.g.  "Ericsson Recruiting <jobs@ericsson.com>"  →  "Ericsson"
 *        "Talent Acquisition . <noreply@akamai.com>" →  "Akamai"
 */
function _extractCompanyName(sender, subject, corpus) {
  // 1. Try display name before the email address
  const displayMatch = sender.match(/^([^<]+)</);
  if (displayMatch) {
    let name = displayMatch[1].trim();
    // Strip generic words
    name = name.replace(/\b(recruiting|talent acquisition|talent team|hr|noreply|no-reply|careers|jobs|notifications|team|hiring)\b/gi, '').trim();
    name = name.replace(/[.\-_,]+$/, '').trim();
    if (name.length > 2) return _toTitleCase(name);
  }

  // 2. Try domain of the email address
  const emailMatch = sender.match(/@([a-zA-Z0-9-]+)\./);
  if (emailMatch) {
    const domain = emailMatch[1];
    if (!['gmail','yahoo','outlook','hotmail','icloud','noreply','linkedin','indeed','greenhouse','lever'].includes(domain)) {
      return _toTitleCase(domain);
    }
  }

  // 3. Try subject line  "Application for Senior Engineer at Google"
  const subjectMatch = subject.match(/\bat\s+([A-Z][A-Za-z0-9\s&'-]{2,30})/);
  if (subjectMatch) return subjectMatch[1].trim();

  return null;
}

function _extractRoleFromSubject(subject) {
  // "Application Update: Senior Android Developer, Req 12345" → "Senior Android Developer"
  const cleaned = subject
    .replace(/application (update|confirmation|received|status|for)[:–-]?\s*/i, '')
    .replace(/,?\s*(req|ref|job|position|id|#|requisition|773306|\d{4,})[^\s]*/gi, '')
    .trim();
  return cleaned.substring(0, 80);
}

function _toTitleCase(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

// ─── CLASSIFICATION ──────────────────────────────────────────────────────────

function _classify(corpus) {
  if (_matches(corpus, PATTERNS.rejected))        return 'rejected';
  if (_matches(corpus, PATTERNS.congratulations)) return 'congratulations';
  if (_matches(corpus, PATTERNS.applied))         return 'applied';
  return null;
}

function _isJobRelated(corpus, thread) {
  const existingNames = thread.getLabels().map(l => l.getName().toLowerCase());
  if (existingNames.some(n => n.includes('reject') || n.includes('job') || n.includes('applied'))) return true;
  return _matches(corpus, [...JOB_SIGNALS, ...PATTERNS.applied, ...PATTERNS.rejected, ...PATTERNS.congratulations]);
}

function _matches(text, patterns) {
  return patterns.some(p => text.includes(p.toLowerCase()));
}

// ─── GMAIL LABELS ────────────────────────────────────────────────────────────

function _ensureGmailLabels() {
  Object.values(GMAIL_LABELS).forEach(_getOrCreateGmailLabel);
}

function _getGmailLabels() {
  const result = {};
  Object.entries(GMAIL_LABELS).forEach(([k, v]) => { result[k] = _getOrCreateGmailLabel(v); });
  return result;
}

function _getOrCreateGmailLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function _fetchUnprocessedThreads(max) {
  const query = [
    '-label:' + GMAIL_LABELS.processed,
    '(',
      'subject:(application OR applied OR interview OR offer OR recruiting OR "software engineer" OR "android" OR "developer" OR "engineer" OR position OR role)',
      'OR from:(recruiting OR talent OR careers OR hr OR greenhouse OR lever OR workday OR indeed OR linkedin)',
      'OR label:Rejected',
    ')',
  ].join(' ');

  const seen = new Map();
  ['', 'in:anywhere '].forEach(prefix => {
    try {
      GmailApp.search(prefix + query, 0, max).forEach(t => seen.set(t.getId(), t));
    } catch(e) {}
  });
  return Array.from(seen.values());
}

function _migrateExistingRejectedLabel() {
  const oldLabel = GmailApp.getUserLabelByName('Rejected');
  if (!oldLabel) return;

  const newRejected = _getOrCreateGmailLabel(GMAIL_LABELS.rejected);
  const processed   = _getOrCreateGmailLabel(GMAIL_LABELS.processed);
  const threads     = oldLabel.getThreads(0, 500);

  Logger.log(`Migrating ${threads.length} threads from "Rejected"`);
  threads.forEach(t => { t.addLabel(newRejected); t.addLabel(processed); });
}

// ─── GOOGLE SHEET SETUP ──────────────────────────────────────────────────────

function _ensureTrackerSheet() {
  let ss = _getSpreadsheet();
  if (!ss) {
    ss = SpreadsheetApp.create(SHEET_NAME);
    Logger.log(`Created new sheet: ${ss.getUrl()}`);
    PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  }

  _ensureTab(ss, TAB_TRACKER, TRACKER_HEADERS);
  _ensureSummaryTab(ss);
  return ss;
}

function _ensureTab(ss, tabName, headers) {
  let sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    // Write headers
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    // Style header row
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#1a73e8');
    headerRange.setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    headers.forEach((_, i) => sheet.setColumnWidth(i + 1, 150));
    Logger.log(`Created tab: ${tabName}`);
  }
  return sheet;
}

function _ensureSummaryTab(ss) {
  let sheet = ss.getSheetByName(TAB_SUMMARY);
  if (!sheet) {
    sheet = ss.insertSheet(TAB_SUMMARY, 0);
  }
  sheet.clearContents();

  const trackerRef = `'${TAB_TRACKER}'`;

  // Build summary with COUNTIF formulas — fully dynamic
  const summaryData = [
    ['Job Hunt Tracker — Live Summary', ''],
    ['', ''],
    ['2026 — Total Applications',  `=COUNTA(${trackerRef}!B2:B5000)`],
    ['✅ Applied (Pending)',         `=COUNTIF(${trackerRef}!F2:F5000,"Applied")+COUNTIF(${trackerRef}!F2:F5000,"Form Filled")+COUNTIF(${trackerRef}!F2:F5000,"Mailed")`],
    ['📩 Referred',                  `=COUNTIF(${trackerRef}!F2:F5000,"Referred")`],
    ['🔄 Interviewing',              `=COUNTIF(${trackerRef}!F2:F5000,"Interviewing")+COUNTIF(${trackerRef}!F2:F5000,"Hr Called")+COUNTIF(${trackerRef}!F2:F5000,"interviewed")`],
    ['❌ Rejected',                   `=COUNTIF(${trackerRef}!F2:F5000,"Rejected")+COUNTIF(${trackerRef}!K2:K5000,"Rejected*")`],
    ['🎉 Offers / Positive',         `=COUNTIF(${trackerRef}!K2:K5000,"*offer*")+COUNTIF(${trackerRef}!K2:K5000,"*congrat*")`],
    ['', ''],
    ['Last auto-sync',               `=TEXT(NOW(),"yyyy-mm-dd hh:mm")`],
  ];

  sheet.getRange(1, 1, summaryData.length, 2).setValues(summaryData);

  // Style
  sheet.getRange(1, 1).setFontWeight('bold').setFontSize(14);
  sheet.setColumnWidth(1, 260);
  sheet.setColumnWidth(2, 120);
  sheet.getRange(3, 2, 6, 1).setFontWeight('bold').setHorizontalAlignment('center');
}

// ─── SHEET ACCESSORS ─────────────────────────────────────────────────────────

function _getSpreadsheet() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch(e) {}
  }
  // Try to find by name
  const files = DriveApp.getFilesByName(SHEET_NAME);
  if (files.hasNext()) {
    const ss = SpreadsheetApp.open(files.next());
    PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
    return ss;
  }
  return null;
}

function _getTrackerTab() {
  const ss = _getSpreadsheet();
  return ss ? ss.getSheetByName(TAB_TRACKER) : null;
}

// ─── TRIGGER ─────────────────────────────────────────────────────────────────

function _setupTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'processJobEmails')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('processJobEmails').timeBased().everyHours(1).create();
  Logger.log('Hourly trigger registered.');
}
