# Job Tracker — LinkedIn

A Chrome extension that extracts job details from LinkedIn job pages and saves them into a single, exportable CSV file for easy tracking.

**Phase 1** — LinkedIn only. Other job portals will be added in future phases.

## Features

- **One-click save** — extracts job title, company, location, salary, experience, and more from any LinkedIn job page.
- **Persistent storage** — all saved jobs are stored inside the extension (no temp files cluttering your Downloads folder).
- **Single CSV export** — export all tracked jobs as one clean CSV file that matches a standard job tracker spreadsheet.
- **Smart extraction** — pulls data from JSON-LD metadata, LinkedIn DOM elements, page title, and the "About the job" section as layered fallbacks.

## Installation

1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select the `extension/` folder from this project.
4. The Job Tracker icon will appear in your Chrome toolbar. Pin it for quick access.

## Usage

### Save a job

1. Open any LinkedIn job page (e.g. `linkedin.com/jobs/view/...`).
2. Click the Job Tracker extension icon in the toolbar.
3. Click **Save LinkedIn Job**.
4. The popup will confirm: `Saved: Job Title @ Company`.

Repeat for as many jobs as you want. Each job is appended to the internal list.

### Export to CSV

1. Click the extension icon.
2. Click **Export All as CSV**.
3. A single file named `job_tracker_YYYY-MM-DD.csv` will download containing all your saved jobs.

### Clear saved jobs

1. Click the extension icon.
2. Click **Clear All Saved Jobs**.
3. Confirm the prompt. All stored data will be deleted.

## CSV Columns

| Column | Description |
|--------|-------------|
| Date of Apply | Date the job was saved |
| Organization | Company name |
| Salary | Salary if mentioned on the page |
| Location | City, state, country or work type (Remote/On-site/Hybrid) |
| Role | Job title |
| Year of experience | Experience requirement extracted from the listing |
| Submission Status | Set to "Applied" by default |
| Portal | Always "linkedin.com" for Phase 1 |
| Referred by | Empty — fill in manually |
| Result | Empty — fill in manually |

## How Extraction Works

The extension uses a layered strategy to extract data reliably:

1. **JSON-LD** — checks for structured `schema.org/JobPosting` data embedded in the page.
2. **LinkedIn DOM** — tries known CSS selectors for the job title, company, and location elements.
3. **Page title** — parses `document.title` (format: `"ROLE | Company | LinkedIn"`).
4. **About the job section** — scans the job description for explicit location/experience/salary mentions.
5. **Body text patterns** — regex-based extraction from visible page text as a final fallback.

## Project Structure

```
extension/
  manifest.json   — Chrome extension manifest (v3)
  popup.html      — Extension popup UI
  popup.js        — All logic: extraction, storage, export
```

## Requirements

- Google Chrome (or any Chromium-based browser)
- LinkedIn account (logged in for best results)

## Roadmap

- **Phase 1** (current): LinkedIn job tracking
- **Phase 2**: Support for additional job portals (Indeed, Naukri, Glassdoor, etc.)
