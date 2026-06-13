# I Built a System That Tracks Every Job Application Automatically — So I Can Focus on Actually Getting the Job

Most people in a job search are doing two jobs at once.

The actual job search. And the admin work of tracking it.

Spreadsheets. Copy-pasting. Manually updating statuses. Checking Gmail to remember if that company even replied. Applying to the same role twice because you lost track.

I refused to spend mental energy on that. So I spent a weekend building a system that does all of it automatically — and now the only thing I focus on is preparation, learning, and showing up sharp.

Here's what I built and how it works.

---

## The Problem I Was Actually Solving

A job tracker fails the moment you close the tab.

You apply, forget to log it, get a rejection two weeks later, and your spreadsheet still says "Applied — Pending." The data is always behind reality. And when you're applying to 20-30 companies, that lag compounds fast.

The real problem isn't the spreadsheet. It's that the spreadsheet needs you to update it. Any system that requires human input will eventually have gaps.

I wanted a system with zero manual steps after clicking Apply.

---

## The Architecture — Four Layers, Fully Connected

I'll spare you the code. Here's the mental model:

**Layer 1 — Capture at the source (Chrome Extension)**

I built a Chrome extension that lives on job portals — LinkedIn, Naukri, Greenhouse, Workday. The moment I land on a job listing, it extracts everything: title, company, location, salary, portal, URL. One click saves the job and logs it. It also autofills application forms using my saved profile — name, email, notice period, experience — so I'm not retyping the same details 30 times a day.

The extension doesn't just save locally. It fires a live signal to the cloud the instant I save a job.

**Layer 2 — The Cloud Brain (Google Apps Script)**

This is where the intelligence lives. I deployed a Google Apps Script as a Web App — essentially a serverless endpoint sitting on Google's infrastructure, completely free.

When the extension saves a job, it sends the data here. The script validates it, deduplicates it, and writes it into a live Google Sheet. Instantly. No middle step, no delay.

But the more powerful part runs every hour, automatically — a Gmail scanner. It reads through my inbox, identifies job-related emails, and classifies them: Applied, Rejected, or Interviewing. Not with AI — with carefully built keyword patterns that I've tuned to catch even the sneaky corporate rejections that never say "unfortunately." It matches the email back to the correct company in the Google Sheet using fuzzy name matching and updates the status automatically.

My Google Sheet is always current. I never touch it.

**Layer 3 — The Bridge (Google Drive as a Sync Bus)**

Here's the part I'm most proud of because it's a bit unconventional.

My D: drive is already synced to Google Drive via Google Drive Desktop. So instead of setting up any fancy API integration or exposing a public endpoint to pull data out of Google Sheets, I made the Apps Script write a small CSV file directly into that Google Drive folder. Google Drive Desktop syncs it to my local D: drive within seconds. No credentials, no tokens, no public URLs. The filesystem itself becomes the message queue. 

Simple. Elegant. Zero extra infrastructure.

**Layer 4 — Local Sync Daemon (Python in the background)**

A lightweight Python script runs silently on Windows startup. It watches for that CSV file to appear on D: drive. The moment it does, it reads the latest statuses from the Google Sheet export, updates only the relevant cells in my original Excel file — preserving all other sheets, formatting, and formulas — and deletes the CSV. Clean cycle, every hour.

My Excel tracker on my laptop reflects reality without me touching it once.

---

## What the Flow Looks Like in Practice

I find a job. I hit Save on the extension. Done.

From that point:

- The job is in my Google Sheet
- An hour later, Gmail is scanned, any response is classified
- The Google Sheet is updated with the result
- The CSV is written to Google Drive
- Google Drive syncs it to my laptop
- My Excel file is updated

All of that happens while I'm doing something else entirely.

---

## Why This Actually Matters

Time is the most underrated resource in a job search.

Every minute I spent updating spreadsheets was a minute I wasn't spending on DSA practice, system design revision, building side projects, or simply being mentally rested before an interview.

When you're preparing for roles at product companies or trying to break into competitive teams, the margin between candidates is razor thin. You can't afford to spend cognitive energy on admin work. That energy belongs to preparation.

This system gave me back roughly 30-40 minutes every day. Across a 2-month search, that's close to 40 hours. That's an entire week of preparation time that would have been wasted on copy-paste and status updates.

More importantly, it gave me mental clarity. I always knew exactly where I stood — which companies had responded, which hadn't, which were moving forward. No anxiety from uncertainty. No missed follow-ups. No duplicate applications.

---

## What I'd Add Next

The system is already working well, but I'm thinking about:

- Replacing keyword classification with an LLM call for more nuanced email understanding
- Auto-generating a company research brief the moment an interview invite is detected
- A response-rate dashboard by portal and company size — to apply smarter, not just more

---

## The Bigger Point

I'm not sharing this to show off the tech stack. I'm sharing it because I think most people in a job search are burning energy in the wrong places.

If you can code, automate the admin. Completely.

If you can't code yet — this is exactly the kind of problem that will teach you how real systems are built. Not toy projects. Not tutorials. A real thing that solves a real problem you actually have.

The best engineers I know build tools for themselves first.

---

*Stack used: Chrome Extension (MV3), Google Apps Script, Google Sheets, Gmail API, Python (pandas + openpyxl), Google Drive Desktop, Windows Task Scheduler.*

*Happy to share more on any layer — drop a comment.*

---

**#BuildInPublic #JobSearch #SoftwareEngineering #Automation #AndroidDeveloper #GoogleAppsScript #ChromeExtension #Python #Focus**
