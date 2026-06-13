# Job Tracker Automation

![Status](https://img.shields.io/badge/status-active-brightgreen)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

> One click to save a job. Everything after that — logging, Gmail scanning, status updates, Excel sync — runs automatically.

---

## What this is

A four-layer automation system for job search tracking. Save a job once. The system handles the rest.

- **Chrome Extension** — captures job details from LinkedIn, Naukri, Greenhouse, Shine in one click. Autofills application forms. Fires data to the cloud instantly.
- **Google Apps Script** — receives jobs via HTTP POST, writes to Google Sheet, scans Gmail every hour, classifies responses, updates statuses automatically.
- **Google Drive (sync bus)** — Apps Script writes a CSV export to your Drive folder. Google Drive Desktop syncs it to your local machine. No extra services needed.
- **Python Daemon** — starts on Windows login, watches for the Drive CSV, merges changes into your local Excel tracker, then cleans up.

---

## Architecture

```
Chrome Extension
      │
      │  HTTP POST (job data)
      ▼
Google Apps Script (Web App)
      │
      ├── Writes job to Google Sheet immediately
      │
      └── Hourly trigger: scans Gmail
                │
                ├── Classifies: Applied / Rejected / Interviewing
                ├── Updates Google Sheet
                └── Writes job_tracker_gs_export.csv → Google Drive folder
                                                              │
                                          Google Drive Desktop syncs
                                                              │
                                                     D: drive (local)
                                                              │
                                                     Python Daemon picks up
                                                              │
                                              Merges into Excel tracker
                                              Deletes CSV after save
```

---

## Supported portals

| Portal | URL pattern | Status |
|--------|-------------|--------|
| LinkedIn | `linkedin.com/jobs/...` | Stable |
| Greenhouse | `*.greenhouse.io/.../jobs/...` | Stable |
| Naukri.com | `naukri.com/job-listings-...` | Partial on apply pages |
| Shine.com | `shine.com/jobs/{title}/{company}/{id}` | Stable |

---

## Setup

### 1. Chrome Extension

1. Open `chrome://extensions/` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked** → select the `extension/` folder.
4. Pin the extension to your toolbar.

### 2. Google Apps Script

1. Go to [script.google.com](https://script.google.com) → **New project**.
2. Paste the contents of `JobApplicationTracker_v2.gs`.
3. Update the `CONFIG` block at the top:
   - `SHEET_NAME` — your Google Sheet name
   - `TAB_TRACKER` — the tab name inside the sheet (default: `JobHunt 2026`)
   - `DRIVE_EXPORT_FOLDER` — the Google Drive folder name where the CSV export should land (must match your Drive folder exactly)
4. **Deploy as Web App:**
   - Click **Deploy → New deployment**
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy** → copy the Web App URL
5. Set up the hourly trigger:
   - Click **Triggers (clock icon)** → **Add trigger**
   - Function: `processJobEmails`
   - Event source: **Time-driven** → **Hour timer** → **Every hour**
6. Paste the Web App URL into the extension's Options page.

### 3. Google Drive sync

Ensure **Google Drive Desktop** is installed and your D: drive folder is synced. The `DRIVE_EXPORT_FOLDER` in the Apps Script config must match the exact folder name in your Google Drive where your Excel tracker lives.

The Apps Script will write `job_tracker_gs_export.csv` into that folder. Google Drive Desktop syncs it locally. The Python daemon picks it up from there.

### 4. Python daemon (auto-start on login)

1. Open `sync_script.py` and verify the paths at the top:
   - `EXCEL_FILE` — path to your local Excel tracker
   - `DRIVE_EXPORT_CSV` — path to the synced CSV (same folder as Excel)
2. Install dependencies:
   ```bash
   pip install pandas openpyxl
   ```
3. Right-click `install_startup.bat` → **Run as administrator**. This registers the sync script as a Windows Scheduled Task that runs silently on every login.
4. Check `sync_log.txt` in the project folder to verify it's running.

---

## How it works end to end

1. You open a job listing and click Save on the extension.
2. Job data is sent to the Apps Script Web App and written to Google Sheet instantly.
3. Every hour, the Gmail scanner runs — reads responses, classifies them by keyword patterns, updates the Google Sheet.
4. The Apps Script writes a CSV export to the Google Drive folder.
5. Google Drive Desktop syncs the CSV to your local D: drive within seconds.
6. The Python daemon detects the file, merges updates into your Excel tracker, deletes the CSV.

Your Excel file reflects reality without you touching it.

---

## What gets captured

| Column | Source |
|--------|--------|
| Date of Apply | Auto — date saved |
| Organization | Extracted from page |
| Location | Extracted from page |
| Role | Extracted from page |
| Exp. Required | Extracted from page |
| Salary | Extracted from page (if available) |
| Submission Status | Default: Applied |
| Portal | Detected automatically |
| URL | Job listing URL |
| Referred by | Manual |
| Result | Auto-updated by Gmail scanner |
| Gmail Synced On | Auto-updated by Gmail scanner |

---

## Project structure

```
extension/
  manifest.json          Chrome extension manifest (MV3)
  popup.html             Popup UI
  popup.js               Job extraction, storage, cloud sync, autofill
  background.js          Alt+F shortcut handler
  content/autofill.js    Form field detection and autofill engine
  options/options.html   Profile manager + Web App URL config
  options/options.js     Profile CRUD and settings persistence

JobApplicationTracker_v2.gs   Google Apps Script (deploy this to script.google.com)
sync_script.py                Python daemon — Drive CSV watcher and Excel sync
install_startup.bat           Registers sync_script.py as a Windows login task
sync_log.txt                  Auto-generated log (created on first run)
```

---

## Requirements

- **Chrome** (or any Chromium browser)
- **Google account** — for Apps Script, Google Sheet, Gmail, Google Drive
- **Google Drive Desktop** — installed and syncing your tracker folder to a local drive
- **Python 3** with `pandas` and `openpyxl`
- **Windows** — for Task Scheduler / install_startup.bat (sync script can be run manually on other platforms)

---

## Known limitations

- **Portal DOM changes** — extraction selectors may need updates after portal UI changes. Multi-layer fallbacks (JSON-LD, API, DOM, regex) reduce breakage frequency.
- **Naukri apply pages** — `/myapply/...` pages only return job title. Save from the listing page before applying for full detail.
- **Gmail classification is rule-based** — keyword patterns cover most cases but edge cases (unusual rejection phrasing) may need manual pattern additions in the Apps Script config.
- **Excel must be closed during sync** — openpyxl cannot write to a file that Excel has open. If locked, the sync retries next cycle automatically.
- **Apps Script quota** — the free tier allows ~6 minutes of execution per run. A time-guard at 4.5 minutes prevents quota errors on large inboxes.
