# I Automated My Entire Job Search — Gmail, Chrome Extension, Excel, and Google Sheets All Talk to Each Other

Most engineers track job applications in a spreadsheet they forget to update.

I did too — until I realized I was spending more time maintaining the tracker than actually applying. Rows with no status. Rejections I never logged. Companies I applied to twice because I forgot.

The data was stale the moment I closed the tab.

So I did what any engineer would do: I over-engineered the solution.

---

## The Problem, Precisely

Job tracking has four friction points:

1. **Saving a job** — copy-pasting title, company, URL, salary into a spreadsheet manually
2. **Logging the application** — remembering to mark "Applied" after you submit
3. **Tracking responses** — Gmail gets the rejection, your spreadsheet doesn't know
4. **Status drift** — your tracker and reality diverge within days

Every tool I tried solved at most one of these. I wanted all four automated, with zero manual steps after applying.

---

## The Architecture

Here's the full system — four components, fully connected:

```
  [Chrome Extension]
       ↓  HTTP POST
  [Google Apps Script Web App]  ←→  [Google Sheet "Job Tracker"]
                                            ↓
                                    [Gmail Watcher]  (hourly trigger)
                                            ↓
                                    [Google Drive Folder]
                                            ↓  (synced via Google Drive Desktop)
                                    [sync_script.py]
                                            ↓
                               [JobTracker_Organized.xlsx]  (local Excel, D: drive)
```

Each arrow is automated. Let me walk through each layer.

---

## Layer 1: Chrome Extension — Capture at the Source

The extension runs on job portals (LinkedIn, Greenhouse, Naukri, Workday, Shine). When I hit "Apply," it extracts:

- Job title, company name, location
- Salary (where listed)
- Portal name and URL
- Experience required

One click saves the job locally to a CSV **and** fires an HTTP POST to the Google Apps Script Web App. The job is in the tracker before I even finish the application form.

The extension also autofills application forms using saved profile data — name, email, notice period, experience — cutting form-fill time from ~3 minutes to under 30 seconds.

---

## Layer 2: Google Apps Script Web App — The Bridge

The Apps Script acts as the central nervous system. It does three things:

**A) Receives jobs from the extension** via a `doPost()` endpoint deployed as a Web App:

```javascript
function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const sheet = _getTrackerTab();

  // Deduplication: skip if URL already exists
  if (data.url && _urlExists(sheet, data.url)) {
    return _jsonResponse({ ok: false, skipped: true });
  }

  sheet.appendRow([
    data.date, data.company, data.location, data.title,
    data.experience, 'Applied', data.portal, data.salary,
    data.url, '', '', new Date() + ' (extension)'
  ]);
  return _jsonResponse({ ok: true });
}
```

**B) Scans Gmail every hour** for job-related emails and classifies them:

```javascript
const PATTERNS = {
  rejected: [
    'we regret to inform', 'not moving forward',
    'position has been filled', 'has been closed',
    'closed or filled', 'unfortunately', 'candidature', ...
  ],
  congratulations: [
    'pleased to offer', 'invitation to interview',
    'schedule an interview', 'next round', 'offer letter', ...
  ],
  applied: [
    'application received', 'thank you for applying',
    'under review', ...
  ]
};
```

Priority order: `rejected > congratulations > applied`. If a rejection pattern fires, it wins — no matter what else is in the email.

**C) Updates the Google Sheet** with the classified result, fuzzy-matching company names:

```javascript
function _findCompanyRow(sheet, companyName) {
  const values = sheet.getRange(2, COL.org, sheet.getLastRow() - 1, 1).getValues();
  const target = companyName.toLowerCase().replace(/\s+/g, '');

  for (let i = 0; i < values.length; i++) {
    const cell = String(values[i][0]).toLowerCase().replace(/\s+/g, '');
    if (cell.includes(target) || target.includes(cell)) return i + 2;
  }
  return -1;
}
```

Fuzzy match handles "Ericsson Recruiting" → "Ericsson", "EY GDS" → "EY", etc.

---

## Layer 3: Google Drive Sync — No Public URL Needed

Here's the clever part most people miss.

My D: drive is already synced to Google Drive via Google Drive Desktop. So instead of publishing the Google Sheet as a public CSV (a common but ugly solution), the Apps Script writes a CSV directly into the Google Drive folder:

```javascript
function exportCSVToGoogleDrive() {
  const folder = DriveApp.getFoldersByName('04. Tracker And Analysis').next();

  // Delete stale export, write fresh one
  const existing = folder.getFilesByName('job_tracker_gs_export.csv');
  while (existing.hasNext()) existing.next().setTrashed(true);

  folder.createFile('job_tracker_gs_export.csv', csv, MimeType.PLAIN_TEXT);
}
```

Google Drive Desktop syncs this to `D:\...\04. Tracker And Analysis\` within seconds. No public endpoints. No auth tokens in the script. The filesystem is the message queue.

---

## Layer 4: sync_script.py — Closing the Loop to Excel

A lightweight Python daemon (runs silently via `pythonw` on Windows login) watches for the CSV that just appeared on D:

```python
def sync_from_drive_csv(existing_df):
    if not os.path.exists(DRIVE_EXPORT_CSV):
        return existing_df, 0, 0

    sheet_df = pd.read_csv(DRIVE_EXPORT_CSV, dtype=str).fillna("")

    # Update Result, Submission Status, Gmail Synced On
    for idx, row in existing_df.iterrows():
        url = str(row.get("URL", "")).strip()
        if url in sheet_by_url.index:
            for col in ["Result", "Submission Status", "Gmail Synced On"]:
                new_val = str(sheet_by_url.loc[url][col] or "").strip()
                if new_val and new_val != str(row.get(col, "")):
                    existing_df.at[idx, col] = new_val

    os.remove(DRIVE_EXPORT_CSV)  # clean up; Apps Script writes fresh each hour
    return existing_df, added, updated
```

It uses `openpyxl` to write back to Excel — preserving all other sheets, formatting, and formulas. The original file is never recreated from scratch, just surgically updated.

---

## The End-to-End Flow

```
Apply to a job (30 seconds with autofill)
  → Extension saves job + POSTs to Apps Script
  → Google Sheet updated instantly

[1 hour later, automatically]
  → Apps Script scans Gmail
  → Classifies: Applied / Rejected / Interviewing
  → Updates Google Sheet
  → Exports CSV to Google Drive folder

[Seconds later, automatically]
  → Google Drive Desktop syncs CSV to D: drive
  → sync_script.py merges status into Excel
  → JobTracker_Organized.xlsx reflects reality
```

Zero manual steps after clicking Apply.

---

## A Few Gotchas Worth Sharing

**Apps Script has a 6-minute execution limit.** I have 500+ threads to process. The fix: a time-guard that stops at 4.5 minutes and logs remaining count. The hourly trigger handles the rest incrementally.

**Excel can't be modified while open.** `openpyxl` throws `PermissionError`. The script catches it, logs "Excel is open — will retry," and tries again next cycle.

**EY-style rejections are sneaky.** Their emails say "the role you applied for has been closed or filled" — no "unfortunately," no "regret." I had to add 8 extra patterns to catch this class of corporate-speak rejections.

**Company name matching is fuzzy, not exact.** "Ericsson Recruiting" ≠ "Ericsson" in a string compare. The solution: strip whitespace, lowercase, then check if either string *contains* the other.

---

## What I'd Build Next

- **NLP classification** instead of keyword patterns — LLM-based scoring would catch edge cases much better
- **Interview prep trigger** — when a thread is classified as `congratulations`, auto-generate a company research doc
- **Analytics dashboard** — response rate by portal, average time-to-rejection by company size, best day of week to apply

---

## Stack Summary

| Layer | Tech |
|---|---|
| Job capture | Chrome Extension (MV3) |
| Cloud bridge | Google Apps Script (Web App + hourly trigger) |
| Live data layer | Google Sheets |
| Email classification | Gmail API via Apps Script |
| Local sync daemon | Python (pandas + openpyxl) |
| Excel persistence | openpyxl (surgical cell writes) |
| OS integration | Windows Task Scheduler + Google Drive Desktop |

---

The whole system cost $0 and runs entirely on tools I already had. The only "infrastructure" is a Google account and a D: drive that syncs to Google Drive.

If you're in a job search and spending more than 5 minutes a week updating a tracker — you're doing it wrong.

---

*Built this during an active job search. Happy to open-source the extension + Apps Script if there's interest — drop a comment.*

---

**#JobSearch #ChromeExtension #GoogleAppsScript #Python #Automation #SoftwareEngineering #AndroidDeveloper #BuildInPublic**
