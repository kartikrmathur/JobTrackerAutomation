// Job Tracker Automation - Popup Script (LinkedIn-only, Phase 1)

const CSV_HEADER = '"Date of Apply","Organization","Salary","Location","Role","Year of experience","Submission Status","Portal","Referred by","Result"\n';

// ── Startup: show saved job count ──
chrome.storage.local.get({ jobs: [] }, (res) => {
    updateJobCount(res.jobs.length);
});

function updateJobCount(count) {
    document.getElementById("jobCount").textContent =
        count === 0 ? "No jobs saved yet." : `${count} job${count > 1 ? "s" : ""} saved.`;
}

function setStatus(msg) {
    document.getElementById("status").textContent = msg;
}

// ── Save Button ──
document.getElementById("saveBtn").addEventListener("click", async () => {

    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractJobDetails
    }, (results) => {
        const data = results?.[0]?.result;
        if (!data) {
            setStatus("Could not extract job data from this page.");
            return;
        }

        if (data.error) {
            setStatus(data.error);
            return;
        }

        chrome.storage.local.get({ jobs: [] }, (res) => {
            const jobs = res.jobs;
            jobs.push(data);
            chrome.storage.local.set({ jobs }, () => {
                updateJobCount(jobs.length);
                setStatus(`Saved: ${data.title} @ ${data.company}\n${data.location}`);
            });
        });
    });
});

// ── Export Button — single CSV file with all saved jobs ──
document.getElementById("exportBtn").addEventListener("click", () => {
    chrome.storage.local.get({ jobs: [] }, (res) => {
        const jobs = res.jobs;
        if (jobs.length === 0) {
            setStatus("Nothing to export yet. Save some jobs first.");
            return;
        }

        const esc = (v) => String(v ?? "").replace(/"/g, '""');
        let csv = CSV_HEADER;
        for (const j of jobs) {
            csv += `"${esc(j.date)}","${esc(j.company)}","${esc(j.salary)}","${esc(j.location)}","${esc(j.title)}","${esc(j.experience)}","${esc(j.status)}","${esc(j.portal)}","",""\n`;
        }

        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `job_tracker_${new Date().toISOString().split("T")[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);

        setStatus(`Exported ${jobs.length} job${jobs.length > 1 ? "s" : ""} to CSV.`);
    });
});

// ── Clear Button ──
document.getElementById("clearBtn").addEventListener("click", () => {
    if (!confirm("Delete all saved jobs? This cannot be undone.")) return;
    chrome.storage.local.set({ jobs: [] }, () => {
        updateJobCount(0);
        setStatus("All jobs cleared.");
    });
});

// ── Content script: runs on the LinkedIn page ──
function extractJobDetails() {

    const hostname = window.location.hostname;
    if (!hostname.includes("linkedin.com")) {
        return {
            error: "This version supports LinkedIn jobs only. Open a LinkedIn job page and try again."
        };
    }

    let title = "N/A";
    let company = "N/A";
    let location = "N/A";
    let salary = "Not Mentioned";
    let experience = "Not Mentioned";

    const bodyText = document.body?.innerText || "";

    // ── LAYER 1: JSON-LD structured data (schema.org/JobPosting) ──
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
        try {
            let data = JSON.parse(script.textContent);
            const items = Array.isArray(data) ? data : [data];
            for (const item of items) {
                if (item["@type"] === "JobPosting") {
                    title = item.title || title;
                    company = item.hiringOrganization?.name || company;

                    const loc = item.jobLocation;
                    if (loc) {
                        const addr = (Array.isArray(loc) ? loc[0] : loc).address;
                        if (addr) {
                            location = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
                                .filter(Boolean).join(", ") || location;
                        } else {
                            location = (Array.isArray(loc) ? loc[0] : loc).name || location;
                        }
                    }

                    const pay = item.baseSalary;
                    if (pay) {
                        const val = pay.value;
                        const currency = pay.currency || "";
                        if (typeof val === "object" && val.minValue) {
                            salary = `${currency} ${val.minValue} - ${val.maxValue}`.trim();
                        } else if (val) {
                            salary = `${currency} ${val}`.trim();
                        }
                    }

                    if (item.experienceRequirements) {
                        const exp = item.experienceRequirements;
                        if (typeof exp === "string") {
                            experience = exp;
                        } else if (exp.monthsOfExperience) {
                            experience = Math.round(exp.monthsOfExperience / 12) + " years";
                        }
                    }

                    break;
                }
            }
        } catch (e) { /* skip malformed JSON-LD */ }
    }

    // ── LAYER 2: LinkedIn DOM extraction ──

    if (title === "N/A") {
        title =
            document.querySelector('.jobs-unified-top-card__job-title')?.innerText?.trim() ||
            document.querySelector('.job-details-jobs-unified-top-card__job-title')?.innerText?.trim() ||
            document.querySelector('.top-card-layout__title')?.innerText?.trim() ||
            document.querySelector('h1 a')?.innerText?.trim() ||
            document.querySelector('h1')?.innerText?.trim() ||
            "N/A";
    }

    if (company === "N/A") {
        company =
            document.querySelector('.jobs-unified-top-card__company-name a')?.innerText?.trim() ||
            document.querySelector('.job-details-jobs-unified-top-card__company-name a')?.innerText?.trim() ||
            document.querySelector('.topcard__org-name-link')?.innerText?.trim() ||
            document.querySelector('a[href*="/company/"]')?.innerText?.trim() ||
            "N/A";
    }

    if (location === "N/A") {
        const NOT_LOCATION = /developer|engineer|manager|analyst|designer|architect|lead|senior|junior|intern|director|specialist|consultant|coordinator|admin|software|android|java|python|react|angular|node|full.?stack|front.?end|back.?end|mobile|web|data|cloud|devops|QA|test|automation|notification|alert|search|save|share|apply|promoted|hiring|recruit|role|position|job|click|show|people|response|hirer|get job|for this/i;

        function isLocation(text) {
            if (!text || text.length < 3 || text.length > 80) return false;
            if (NOT_LOCATION.test(text)) return false;
            return true;
        }

        // Strategy 1: CSS selectors — validate before accepting
        const cssCandidates = [
            document.querySelector('.jobs-unified-top-card__bullet')?.innerText?.trim(),
            document.querySelector('.job-details-jobs-unified-top-card__bullet')?.innerText?.trim(),
            document.querySelector('.topcard__flavor--bullet')?.innerText?.trim(),
        ];
        for (const c of cssCandidates) {
            if (c && isLocation(c)) { location = c; break; }
        }

        // Strategy 2: DOM walk from company link — location is always near company name
        if (location === "N/A") {
            const companyEl = document.querySelector('a[href*="/company/"]');
            if (companyEl) {
                let container = companyEl.closest('div') || companyEl.parentElement;
                for (let i = 0; i < 6 && container; i++) container = container.parentElement;
                if (container) {
                    const spans = container.querySelectorAll('span, div');
                    for (const el of spans) {
                        if (el.children.length > 2) continue;
                        const t = el.innerText?.trim();
                        if (!t || t.length > 80) continue;
                        const part = t.split(/[·•\u00b7\u2022]/)[0].trim();
                        if (part && isLocation(part) && /,/.test(part)) {
                            location = part;
                            break;
                        }
                    }
                }
            }
        }

        // Strategy 3: "About the job" section — parse location from job description
        if (location === "N/A") {
            const aboutText = (() => {
                const allEls = document.querySelectorAll('h2, h3, span, div');
                for (const el of allEls) {
                    const t = el.innerText?.trim();
                    if (t && /^about the job$|^about this role$|^job description$/i.test(t)) {
                        const section = el.closest('section') || el.closest('[class*="description"]') || el.parentElement?.parentElement;
                        return section?.innerText || "";
                    }
                }
                const descEl = document.querySelector('[class*="description__text"]') ||
                               document.querySelector('[class*="show-more"]') ||
                               document.querySelector('#job-details');
                return descEl?.innerText || "";
            })();

            if (aboutText) {
                const locPatterns = [
                    /(?:location|job location|work location|base location|office location|office)\s*[:\-–]\s*([A-Za-z][A-Za-z\s,/]+)/i,
                    /(?:based (?:in|at|out of)|located (?:in|at)|position (?:in|at)|work(?:ing)? from)\s+([A-Z][a-zA-Z\s,]+?)(?:\.|,?\s*\n|\s*$)/im,
                    /(?:location|city)\s*[:\-–]\s*(.+)/im,
                ];
                for (const pat of locPatterns) {
                    const m = aboutText.match(pat);
                    if (m) {
                        const candidate = m[1].trim().replace(/[.\n].*/, '').trim();
                        if (isLocation(candidate)) {
                            location = candidate;
                            break;
                        }
                    }
                }
            }
        }

        // Strategy 4: body text — "City, State, Country" followed by separator
        if (location === "N/A") {
            const patterns = [
                /([A-Z][a-zA-Z\s]+,\s*[A-Z][a-zA-Z\s]+(?:,\s*[A-Z][a-zA-Z\s]+)?)\s*[·•\u00b7\u2022]/,
                /([A-Z][a-zA-Z\s]+,\s*[A-Z][a-zA-Z\s]+(?:,\s*[A-Z][a-zA-Z\s]+)?)\s*\((?:Remote|On-site|Hybrid|On site)\)/i,
            ];
            for (const pat of patterns) {
                const m = bodyText.match(pat);
                if (m && isLocation(m[1].trim())) {
                    location = m[1].trim();
                    break;
                }
            }
        }

        // Strategy 5: "City (Remote/On-site/Hybrid)" or standalone work type
        if (location === "N/A") {
            const wt = bodyText.match(/([A-Z][a-zA-Z\s,]*?)\s*\((?:Remote|On-site|Hybrid|On site)\)/i);
            if (wt && isLocation(wt[1].trim())) {
                location = wt[0].trim();
            } else {
                const standalone = bodyText.match(/\b(Remote|On-site|Hybrid)\b/i);
                if (standalone) location = standalone[1];
            }
        }
    }

    // Fallback: extract from document.title / og:title
    if (company === "N/A" || location === "N/A" || title === "N/A") {
        const pageTitle =
            document.querySelector('meta[property="og:title"]')?.content ||
            document.title || "";

        // Logged-in format: "ROLE | Company | LinkedIn"
        const pipeParts = pageTitle.split("|").map(p => p.trim());
        if (pipeParts.length >= 3 && /linkedin/i.test(pipeParts[pipeParts.length - 1])) {
            if (title === "N/A" && pipeParts[0]) title = pipeParts[0];
            if (company === "N/A" && pipeParts[1]) company = pipeParts[1];
        }

        // Guest/public format: "Company hiring Role in Location | LinkedIn"
        if (company === "N/A") {
            const m = pageTitle.match(/^(.+?)\s+hiring\s+/i);
            if (m) company = m[1].trim();
        }
        if (title === "N/A") {
            const m = pageTitle.match(/hiring\s+(.+?)\s+in\s+/i);
            if (m) title = m[1].trim();
        }
        if (location === "N/A") {
            const m = pageTitle.match(/\s+in\s+(.+?)(?:\s*\||$)/i);
            if (m) location = m[1].trim();
        }
    }

    // ── LAYER 3: Extract experience from body text ──
    if (experience === "Not Mentioned") {
        const expPatterns = [
            /(\d+\s*[-–to]+\s*\d+)\s*\+?\s*(?:years?|yrs?)/i,
            /(\d+)\s*\+\s*(?:years?|yrs?)/i,
            /(?:at\s+least|minimum|min\.?)\s+(\d+)\s*\+?\s*(?:years?|yrs?)/i,
            /(\d+)\s*(?:years?|yrs?)\s*(?:of)?\s*(?:relevant|total|overall|hands[- ]?on)?\s*(?:experience|exp)/i,
            /experience\s*(?:of|:|-|–)?\s*(\d+)\s*\+?\s*(?:years?|yrs?)/i,
        ];
        for (const pattern of expPatterns) {
            const m = bodyText.match(pattern);
            if (m) {
                experience = m[0].trim();
                break;
            }
        }
    }

    // ── LAYER 3: Extract salary from body text ──
    if (salary === "Not Mentioned") {
        const salaryPatterns = [
            /(?:salary|compensation|ctc|pay|package)\s*(?::|-)?\s*([\$₹€£]\s*[\d,\.]+\s*(?:[-–to]+\s*[\$₹€£]?\s*[\d,\.]+)?(?:\s*(?:LPA|lpa|CTC|ctc|per\s+(?:annum|year|month)))?)/i,
            /([\$₹€£]\s*[\d,\.]+\s*(?:[-–to]+\s*[\$₹€£]?\s*[\d,\.]+)?(?:\s*(?:LPA|lpa|CTC|ctc|per\s+(?:annum|year|month))))/i,
            /(\d[\d,\.]+\s*[-–to]+\s*\d[\d,\.]+\s*(?:LPA|lpa|CTC|ctc))/i,
        ];
        for (const pattern of salaryPatterns) {
            const m = bodyText.match(pattern);
            if (m) {
                salary = m[1]?.trim() || m[0].trim();
                break;
            }
        }
    }

    return {
        date: new Date().toISOString().split("T")[0],
        company,
        salary,
        location,
        title,
        experience,
        status: "Applied",
        portal: "linkedin.com"
    };
}
