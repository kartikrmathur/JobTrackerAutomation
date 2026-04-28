# 🗂️ Job Tracker Automation — Track applications faster, fill forms with less repetition

![Status](https://img.shields.io/badge/status-active-brightgreen)
![Phase](https://img.shields.io/badge/phase-1%20%E2%80%94%20LinkedIn-blue)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

> A Chrome extension for job seekers: save job details in one click, export one clean CSV, and reuse profile data to autofill application forms.

![Demo](assets/demo.gif)

---

A practical workflow tool for active job search:

- Capture job details from LinkedIn, Greenhouse, and Naukri.
- Keep your application log in one exportable CSV.
- Reuse saved profile data to autofill common form fields.

Built for speed during high-volume applications, without requiring a backend or account signup.

## ✨ Features

- **Capture in one click** — save title, company, location, salary, experience, URL, and portal.
- **Local storage + dedupe** — jobs are stored in extension storage and duplicate saves are blocked.
- **Single CSV export** — export all saved jobs into `job_tracker_YYYY-MM-DD.csv`.
- **Layered extraction** — uses JSON-LD, site APIs, DOM selectors, and regex fallbacks.
- **Autofill profiles** — create and manage multiple profiles from the options page.
- **Shortcut + helper panel** — run autofill via popup or `Alt+F`, with an on-page copy helper for tricky fields.

## Supported sites

| Site | Example URL pattern | `Portal` column in CSV |
|------|---------------------|-------------------------|
| LinkedIn | `linkedin.com/jobs/...` | `linkedin.com` |
| Greenhouse | `*.greenhouse.io/.../jobs/...` | `greenhouse.io` |
| Naukri.com | `naukri.com/job-listings-...` or `naukri.com/myapply/...` | `naukri.com` |

## 🚀 Installation

1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select the `extension/` folder from this project.
4. The Job Tracker icon will appear in your Chrome toolbar. Pin it for quick access.

## 🖥️ How to Use

### Save a job

1. Open a supported job page (LinkedIn, Greenhouse, or Naukri.com job listing).
2. Click the Job Tracker extension icon in the toolbar.
3. Click **Save Applied Job**.
4. The popup will confirm: `Saved: Job Title @ Company`.

Repeat for as many jobs as you want. Each job is appended to the internal list.

**Note:** On Naukri apply confirmation pages (`/myapply/...`), only the job title can be extracted (Naukri blocks API access with CAPTCHA on these pages). For full details, save from the job listing page before applying.

### Export to CSV

1. Click the extension icon.
2. Click **Export All as CSV**.
3. A single file named `job_tracker_YYYY-MM-DD.csv` will download containing all your saved jobs.

### Clear saved jobs

1. Click the extension icon.
2. Click **Clear All Saved Jobs**.
3. Confirm the prompt. All stored data will be deleted.

## 📁 What Gets Captured / Output Format

| Column | Description |
|--------|-------------|
| Date of Apply | Date the job was saved |
| Organization | Company name |
| Salary | Salary if mentioned on the page |
| Location | City / region / country or work arrangement when detected |
| Role | Job title |
| Year of experience | Experience requirement extracted from the listing |
| Submission Status | Set to "Applied" by default |
| Portal | `linkedin.com`, `greenhouse.io`, or `naukri.com` |
| URL | Direct link to the job listing |
| Referred by | Empty — fill in manually |
| Result | Empty — fill in manually |

## How extraction works

1. **JSON-LD** — if the page embeds `schema.org/JobPosting`, title, organization, location, salary, and experience are read from there first.
2. **Naukri.com** — internal API (`/jobapi/v4/job/{id}`), DOM selectors (`span.exp-wrap`, `span.sal-wrap`, etc.), and body text regex. Apply confirmation pages extract job ID and title from URL parameters.
3. **LinkedIn** — DOM selectors, `document.title` pipe format, "About the job" text, and body regex for location and experience.
4. **Greenhouse** — URL slug for organization name, `h1` for title, location from lines after the title or body regex.

## Sync script

`sync_script.py` watches your Downloads folder for exported CSV files and appends them into your main Excel tracker. Update the paths at the top of the file to match your system.

## Project structure

```
extension/
  manifest.json               — Chrome extension manifest (v3)
  popup.html                  — Popup UI (tracking + autofill actions)
  popup.js                    — Job extraction, storage, export, popup autofill actions
  background.js               — Keyboard shortcut handler (`Alt+F`) for autofill
  content/autofill.js         — Form field detection, autofill engine, floating helper
  options/options.html        — Profile manager UI
  options/options.js          — Profile CRUD and local storage persistence
sync_script.py                — Optional: auto-sync exported CSVs to Excel
```

## Requirements

- Google Chrome (or any Chromium-based browser)
- For LinkedIn: being logged in usually gives the richest DOM.
- For sync script: Python 3 with `pandas` and `openpyxl`.

## Optional: Excel sync script (`sync_script.py`)

A utility script for syncing exported CSV data into your main Excel tracker file.

> **Note:** This is optional. The Chrome extension works standalone - this script is for power users who want automated syncing.

### What it does

- Watches your Downloads folder for `job_tracker*.csv` exports.
- Merges new rows into your Excel tracker.
- Removes duplicates by `URL` when possible.
- Deletes processed CSV files after successful sync.

### Setup

1. Open `sync_script.py`.
2. Update `DOWNLOADS_PATH` to your local Downloads path.
3. Update `EXCEL_FILE` to your target Excel tracker path.
4. Install dependencies:

```bash
pip install pandas openpyxl
```

### Usage

```bash
python sync_script.py
```

The script runs continuously and checks for new CSV files every 5 seconds.

## ⚠️ Known Limitations

- **LinkedIn DOM changes:** LinkedIn occasionally updates page structure, which can break CSS selector-based extraction. If fields stop being captured, open an issue and it can be patched quickly.
- **Login required:** The extension works best when logged into LinkedIn. Some data may not appear on public listings.
- **Salary data:** LinkedIn often does not display salary. If salary is missing on the page, the CSV field will be blank.
- **Portal coverage:** LinkedIn is the primary focus. Greenhouse and Naukri support exists but may need periodic selector updates as those sites evolve.
- **Autofill is heuristic-based:** Dynamic or highly custom widgets may not map perfectly and can require manual edits.
- **Permission scope:** The extension currently uses broad host permission (`<all_urls>`) so autofill can run across job portals and application pages.
