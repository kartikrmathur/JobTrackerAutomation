// Job Tracker Automation — Popup (LinkedIn + Greenhouse + Naukri.com)

const CSV_HEADER = '"Date of Apply","Organization","Salary","Location","Role","Year of experience","Submission Status","Portal","URL","Referred by","Result"\n';
const PROFILE_FIELDS = [
    "firstName", "lastName", "email", "phone",
    "address", "city", "state", "zip", "country",
    "currentTitle", "currentCompany", "yearsExperience",
    "expectedSalary", "noticePeriod", "skills", "summary",
    "degree", "major", "university", "graduationYear", "gpa",
    "linkedin", "github", "portfolio"
];
const profileSelectEl = document.getElementById("profileSelect");
const autofillStatusEl = document.getElementById("autofillStatus");
const fillBtnEl = document.getElementById("fillBtn");
const openProfilesBtnEl = document.getElementById("openProfilesBtn");
let popupProfiles = [];
let popupActiveProfileId = "";

// ── Startup: show saved job count ──
chrome.storage.local.get({ jobs: [], profiles: [], activeProfileId: "" }, (res) => {
    updateJobCount(res.jobs.length);
    popupProfiles = Array.isArray(res.profiles) ? res.profiles : [];
    popupActiveProfileId = res.activeProfileId || "";
    renderProfiles();
});

function updateJobCount(count) {
    document.getElementById("jobCount").textContent =
        count === 0 ? "No jobs saved yet." : `${count} job${count > 1 ? "s" : ""} saved.`;
}

function setStatus(msg) {
    document.getElementById("status").textContent = msg;
}

function setAutofillStatus(msg) {
    autofillStatusEl.textContent = msg;
}

function makeEmptyProfileData() {
    const data = {};
    for (const key of PROFILE_FIELDS) data[key] = "";
    return data;
}

function normalizeProfilesFromStorage(rawProfiles) {
    const list = Array.isArray(rawProfiles) ? rawProfiles : [];
    return list.map((profile) => ({
        id: profile.id || `profile_${Date.now()}`,
        name: profile.name || "Untitled Profile",
        data: { ...makeEmptyProfileData(), ...(profile.data || {}) }
    }));
}

function renderProfiles() {
    popupProfiles = normalizeProfilesFromStorage(popupProfiles);
    profileSelectEl.textContent = "";

    if (popupProfiles.length === 0) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No profiles found. Create one in options.";
        profileSelectEl.appendChild(option);
        profileSelectEl.disabled = true;
        fillBtnEl.disabled = true;
        setAutofillStatus("Create a profile in 'Edit Profiles' to use autofill.");
        return;
    }

    if (!popupProfiles.some((profile) => profile.id === popupActiveProfileId)) {
        popupActiveProfileId = popupProfiles[0].id;
    }

    for (const profile of popupProfiles) {
        const option = document.createElement("option");
        option.value = profile.id;
        option.textContent = profile.name;
        profileSelectEl.appendChild(option);
    }
    profileSelectEl.value = popupActiveProfileId;
    profileSelectEl.disabled = false;
    fillBtnEl.disabled = false;
    setAutofillStatus("Select a profile and click 'Fill This Page'.");
}

profileSelectEl.addEventListener("change", () => {
    popupActiveProfileId = profileSelectEl.value;
    chrome.storage.local.set({ activeProfileId: popupActiveProfileId });
});

openProfilesBtnEl.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
});

fillBtnEl.addEventListener("click", async () => {
    const selectedProfileId = profileSelectEl.value;
    const profile = popupProfiles.find((item) => item.id === selectedProfileId);

    if (!profile) {
        setAutofillStatus("No profile selected. Click 'Edit Profiles' to create one.");
        return;
    }

    let tab;
    try {
        [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch (e) {
        setAutofillStatus("Could not find active tab.");
        return;
    }

    if (!tab?.id) {
        setAutofillStatus("Could not find active tab.");
        return;
    }
    try {
        const response = await chrome.tabs.sendMessage(tab.id, {
            type: "AUTOFILL",
            profile
        });

        if (!response?.ok) {
            setAutofillStatus("Autofill failed on this page.");
            return;
        }

        const result = response.result || { filled: [], skipped: [], unmatched: [] };
        setAutofillStatus(
            `Filled ${result.filled.length} field(s), skipped ${result.skipped.length}, unmatched ${result.unmatched.length}.`
        );
    } catch (e) {
        setAutofillStatus(
            "Autofill is unavailable on this page. Reload the page once or open a standard http/https job application form."
        );
    }
});

// ── Save Button ──
document.getElementById("saveBtn").addEventListener("click", async () => {

    setStatus("Extracting job details...");

    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    let results;
    try {
        results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: extractJobDetails
        });
    } catch (e) {
        setStatus("Could not access this page. Make sure you're on a job posting.");
        return;
    }

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

        const isDupe = jobs.some(j =>
            j.portal === data.portal &&
            j.title === data.title &&
            (j.company === data.company || j.url === data.url)
        );
        if (isDupe) {
            setStatus(`Already saved: ${data.title} @ ${data.company}`);
            return;
        }

        const saveData = {...data};
        delete saveData._applyPageNote;
        jobs.push(saveData);
        chrome.storage.local.set({ jobs }, () => {
            updateJobCount(jobs.length);
            let msg = `Saved: ${data.title} @ ${data.company}`;
            if (data._applyPageNote) {
                msg += `\n\n⚠️ ${data._applyPageNote}`;
            }
            setStatus(msg);
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
            csv += `"${esc(j.date)}","${esc(j.company)}","${esc(j.salary)}","${esc(j.location)}","${esc(j.title)}","${esc(j.experience)}","${esc(j.status)}","${esc(j.portal)}","${esc(j.url)}","",""\n`;
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

// ── Injected into page: LinkedIn, Greenhouse, or Naukri.com ──
async function extractJobDetails() {

    const hostname = window.location.hostname;
    const isLinkedIn = hostname.includes("linkedin.com");
    const isGreenhouse = hostname.includes("greenhouse.io");
    const isNaukri = hostname.includes("naukri.com");

    if (!isLinkedIn && !isGreenhouse && !isNaukri) {
        return {
            error: "Supported sites: LinkedIn, Greenhouse (job-boards.greenhouse.io), and Naukri.com. Open a job posting and try again."
        };
    }

    // Skip pages that are clearly not job-related on Naukri
    if (isNaukri) {
        const path = window.location.pathname;
        if (/^\/(mnjuser|users|recruiter|cloudgate|middleware)\b/i.test(path)) {
            return {
                error: "This is not a job page. Please open a job listing, search results, or apply page on Naukri and try again."
            };
        }
    }

    let title = "N/A";
    let company = "N/A";
    let location = "N/A";
    let salary = "Not Mentioned";
    let experience = "Not Mentioned";

    let _bodyTextCache;
    const getBodyText = () => { if (_bodyTextCache === undefined) _bodyTextCache = document.body?.innerText || ""; return _bodyTextCache; };

    // ── Shared LAYER 1: JSON-LD (schema.org/JobPosting) — LinkedIn & Greenhouse ──
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
                            const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
                                .filter(Boolean)
                                .filter(p => p !== "-" && p !== "–");
                            // Deduplicate (e.g., "Gurugram, Gurugram" → "Gurugram")
                            const unique = [...new Set(parts.map(p => p.trim()))];
                            location = unique.join(", ") || location;
                        } else {
                            location = (Array.isArray(loc) ? loc[0] : loc).name || location;
                        }
                    }

                    const pay = item.baseSalary;
                    if (pay) {
                        const val = pay.value;
                        const currency = pay.currency || "";
                        if (typeof val === "object") {
                            const lo = val.minValue ?? val.min ?? val.value;
                            const hi = val.maxValue ?? val.max;
                            if (lo && hi) salary = `${currency} ${lo} - ${hi}`.trim();
                            else if (lo) salary = `${currency} ${lo}`.trim();
                        } else if (val !== undefined && val !== null) {
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

    if (isGreenhouse) {
        function humanizeSlug(slug) {
            if (!slug) return "N/A";
            return decodeURIComponent(slug)
                .replace(/[-_]+/g, " ")
                .replace(/\b\w/g, (c) => c.toUpperCase())
                .trim();
        }

        const pathMatch = window.location.pathname.match(/^\/([^/]+)\/jobs\//);
        if (company === "N/A" && pathMatch) {
            company = humanizeSlug(pathMatch[1]);
        }

        if (title === "N/A") {
            const h1s = document.querySelectorAll("h1");
            for (const h of h1s) {
                const t = h.innerText?.trim();
                if (!t || t.length < 3) continue;
                if (/^apply for this job$/i.test(t)) continue;
                title = t;
                break;
            }
        }

        if (title === "N/A") {
            const pageTitle = document.querySelector('meta[property="og:title"]')?.content || document.title || "";
            const mApp = pageTitle.match(/Job Application for\s+(.+?)\s+at\s+/i);
            if (mApp) title = mApp[1].trim();
            else {
                const pipe = pageTitle.split("|")[0]?.trim();
                if (pipe && pipe.length > 3) title = pipe;
            }
        }

        if (company === "N/A") {
            const pageTitle = document.querySelector('meta[property="og:title"]')?.content || document.title || "";
            const mCo = pageTitle.match(/\s+at\s+([^|]+?)(?:\s*\||$)/i);
            if (mCo) company = mCo[1].trim();
            const ogSite = document.querySelector('meta[property="og:site_name"]')?.content?.trim();
            if (company === "N/A" && ogSite) company = ogSite;
        }

        if (location === "N/A") {
            const h1 = document.querySelector("h1");
            if (h1 && h1.parentElement) {
                const container = h1.parentElement;
                const kids = Array.from(container.children);
                const idx = kids.indexOf(h1);
                for (let i = idx + 1; i < Math.min(idx + 4, kids.length); i++) {
                    const line = kids[i]?.innerText?.trim()?.split(/\n/)[0]?.trim();
                    if (!line || line.length > 120) continue;
                    if (/^apply$/i.test(line)) continue;
                    if (/,\s*[A-Z]{2,3}\b/.test(line) || /\b(Remote|Hybrid|On-site|On site)\b/i.test(line)) {
                        location = line.split(/[·•\u00b7\u2022]/)[0].trim();
                        break;
                    }
                }
            }
        }

        if (location === "N/A") {
            const head = getBodyText().slice(0, 3500);
            const locRe = head.match(/\b([A-Z][a-z]+(?:[\s-][A-Za-z]+)*,\s*[A-Z]{2,3})\b/);
            if (locRe) location = locRe[1].trim();
        }

        if (experience === "Not Mentioned") {
            const expPatterns = [
                /(\d+\s*[-–to]+\s*\d+)\s*\+?\s*(?:years?|yrs?)/i,
                /(\d+)\s*\+\s*(?:years?|yrs?)/i,
                /(?:at\s+least|minimum|min\.?)\s+(\d+)\s*\+?\s*(?:years?|yrs?)/i,
                /(\d+)\s*(?:years?|yrs?)\s*(?:of)?\s*(?:relevant|total|overall|hands[- ]?on)?\s*(?:experience|exp)/i,
                /experience\s*(?:of|:|-|–)?\s*(\d+)\s*\+?\s*(?:years?|yrs?)/i,
            ];
            for (const pattern of expPatterns) {
                const m = getBodyText().match(pattern);
                if (m) {
                    experience = m[0].trim();
                    break;
                }
            }
        }

        if (salary === "Not Mentioned") {
            const salaryPatterns = [
                /(?:salary|compensation|ctc|pay|package)\s*(?::|-)?\s*([\$₹€£]\s*[\d,\.]+\s*(?:[-–to]+\s*[\$₹€£]?\s*[\d,\.]+)?(?:\s*(?:LPA|lpa|CTC|ctc|per\s+(?:annum|year|month)))?)/i,
                /([\$₹€£]\s*[\d,\.]+\s*(?:[-–to]+\s*[\$₹€£]?\s*[\d,\.]+)?(?:\s*(?:LPA|lpa|CTC|ctc|per\s+(?:annum|year|month))))/i,
            ];
            for (const pattern of salaryPatterns) {
                const m = getBodyText().match(pattern);
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
            portal: "greenhouse.io",
            url: window.location.href
        };
    }

    // ── Naukri.com: dedicated extraction (API → DOM → body regex) ──
    if (isNaukri) {

        // ── NAUKRI LAYER 0: Find job ID (detail page URL → search page selected job) ──
        let jobId = null;
        let _jobIdSource = 'none';

        // Strategy 1: Direct job page URL
        const urlMatch = window.location.href.match(
            /(?:job-listings-.*?-|\/job\/)(\d{8,15})/
        );
        if (urlMatch) {
            jobId = urlMatch[1];
            _jobIdSource = 'url-path';
        }

        // Strategy 1b: Apply confirmation pages (/myapply/saveApply or /myapply/showAcp)
        if (!jobId && /\/myapply\//i.test(window.location.pathname)) {
            const params = new URLSearchParams(window.location.search);
            // saveApply uses strJobsarr=[JOBID]
            const jobsArr = params.get('strJobsarr');
            if (jobsArr) {
                const idMatch = jobsArr.match(/(\d{8,15})/);
                if (idMatch) { jobId = idMatch[1]; _jobIdSource = 'apply-page-strJobs'; }
            }
            // showAcp uses file=JOBID
            if (!jobId) {
                const fileParam = params.get('file');
                if (fileParam && /^\d{8,15}$/.test(fileParam)) { jobId = fileParam; _jobIdSource = 'apply-page-file'; }
            }
            // multiApplyResp contains {"JOBID":200}
            if (!jobId) {
                const multiResp = params.get('multiApplyResp');
                if (multiResp) {
                    const idMatch = multiResp.match(/(\d{8,15})/);
                    if (idMatch) { jobId = idMatch[1]; _jobIdSource = 'apply-page-multi'; }
                }
            }
            // Last resort: any 12+ digit number in the full URL query
            if (!jobId) {
                const fullMatch = window.location.search.match(/(\d{10,15})/);
                if (fullMatch) { jobId = fullMatch[1]; _jobIdSource = 'apply-page-url'; }
            }
        }

        const _isApplyPage = /\/myapply\//i.test(window.location.pathname);

        // Strategy 2: Search results page — find selected/active job card (skip on apply pages)
        if (!jobId && !_isApplyPage) {
            // Naukri uses .selected, [class*="selected"], or similar on the active card
            const selectedCard = document.querySelector(
                'article.selected, [class*="jobTupleHeader"].selected, ' +
                '[class*="selected"] article, [class*="cardBg"].active, ' +
                '.srp-jobtuple.selected, [class*="selected"][class*="tuple"], ' +
                '[data-job-id].selected, .list-header-section .selected'
            );
            // Also try: the first job card with a highlighted style
            const activeCard = selectedCard ||
                document.querySelector('[class*="selected"][data-job-id]') ||
                document.querySelector('[class*="active"][data-job-id]');

            if (activeCard) {
                const cardJobId = activeCard.getAttribute('data-job-id') ||
                    activeCard.querySelector('[data-job-id]')?.getAttribute('data-job-id');
                if (cardJobId && /^\d{6,15}$/.test(cardJobId)) {
                    jobId = cardJobId;
                    _jobIdSource = 'selected-card';
                }
                if (!jobId) {
                    const cardLink = activeCard.querySelector('a[href*="/job/"], a[href*="job-listings"]');
                    const linkMatch = cardLink?.href?.match(/(?:job-listings-.*?-|\/job\/)(\d{8,15})/);
                    if (linkMatch) { jobId = linkMatch[1]; _jobIdSource = 'selected-card-link'; }
                }
            }
        }

        // Strategy 3: Right-side JD panel (skip on apply pages)
        if (!jobId && !_isApplyPage) {
            const jdPanel = document.querySelector(
                '#job_desc_div, [class*="jdContainer"], [class*="job-desc"], ' +
                '[id*="jobDesc"], [class*="styles_jd-container"]'
            );
            if (jdPanel) {
                const applyLink = jdPanel.querySelector(
                    'a[href*="/job/"], a[href*="job-listings"], [data-job-id]'
                );
                const panelJobId = applyLink?.getAttribute('data-job-id') ||
                    applyLink?.href?.match(/(?:job-listings-.*?-|\/job\/)(\d{8,15})/)?.[1];
                if (panelJobId && /^\d{6,15}$/.test(panelJobId)) {
                    jobId = panelJobId;
                    _jobIdSource = 'jd-panel';
                }
            }
        }

        // Strategy 4: URL query params (skip on apply pages — already handled in 1b)
        if (!jobId && !_isApplyPage) {
            const params = new URLSearchParams(window.location.search);
            const qid = params.get('jid') || params.get('jobId') || params.get('jdp');
            if (qid && /^\d{6,15}$/.test(qid)) {
                jobId = qid;
                _jobIdSource = 'url-query';
            }
        }

        // Strategy 5: Any data-job-id (skip on apply pages — would grab recommendation cards)
        if (!jobId && !_isApplyPage) {
            const anyJobEl = document.querySelector('[data-job-id]');
            if (anyJobEl) {
                const fallbackId = anyJobEl.getAttribute('data-job-id');
                if (fallbackId && /^\d{6,15}$/.test(fallbackId)) {
                    jobId = fallbackId;
                    _jobIdSource = 'first-data-attr';
                }
            }
        }

        // Strategy 6: Scan all links (skip on apply pages)
        if (!jobId && !_isApplyPage) {
            const allLinks = document.querySelectorAll('a[href*="/job/"]');
            for (const link of allLinks) {
                const m = link.href?.match(/\/job\/(\d{8,15})/);
                if (m) { jobId = m[1]; _jobIdSource = 'first-job-link'; break; }
            }
        }

        // Skip API on apply pages — Naukri returns 406 "recaptcha required" from that context
        if (jobId && !_isApplyPage) {
            try {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 2000);
                const res = await fetch(`/jobapi/v4/job/${jobId}`, {
                    signal: ctrl.signal,
                    credentials: 'include',
                    headers: { 'appid': '109', 'systemid': 'Naukri', 'gid': 'LOCATION,ENTITY,OTHER', 'Content-Type': 'application/json' }
                });
                clearTimeout(timer);
                if (res.ok) {
                    const apiData = await res.json();
                    const jd = apiData.jobDetails || apiData;

                    if (jd.title) title = jd.title;
                    if (jd.experienceText) experience = jd.experienceText;

                    // Try every known company field path
                    company = jd.companyName || jd.company
                        || apiData.companyName || apiData.company
                        || jd.companyDetail?.name || apiData.companyDetail?.name
                        || jd.ambitionBoxData?.CompanyName || apiData.ambitionBoxData?.CompanyName
                        || jd.ambitionBoxData?.companyName || apiData.ambitionBoxData?.companyName
                        || jd.hostCompany?.name || apiData.hostCompany?.name
                        || jd.hiringCompany || apiData.hiringCompany
                        || jd.orgName || apiData.orgName
                        || jd.footerCompanyName || apiData.footerCompanyName
                        || company;

                    for (const ph of (jd.placeholders || [])) {
                        if (ph.type === "salary" && ph.label && ph.label !== "Not disclosed")
                            salary = ph.label;
                        if (ph.type === "location" && ph.label)
                            location = ph.label;
                        if (ph.type === "company" && ph.label)
                            company = ph.label;
                    }

                    if (salary === "Not Mentioned" && jd.salaryDetail) {
                        const sd = jd.salaryDetail;
                        if (!sd.hideSalary && sd.minimumSalary && sd.maximumSalary) {
                            const fmt = (v) => (v >= 100000)
                                ? (v / 100000).toFixed(1).replace(/\.0$/, '') + ' Lacs'
                                : v.toLocaleString('en-IN');
                            salary = `${sd.currency || 'INR'} ${fmt(sd.minimumSalary)} - ${fmt(sd.maximumSalary)} PA`;
                        }
                    }
                }
            } catch (e) {
                // API error (timeout or network) — will fall through to DOM extraction
            }
        }

        // ── Fallback for non-apply pages: DOM card parsing, script tags, links ──
        if (!_isApplyPage && (company === "N/A" || title === "N/A")) {
            // Card parser: scan structured job cards
            const CITIES_RE = /\b(Bengaluru|Bangalore|Mumbai|Hyderabad|Chennai|Pune|Delhi|New Delhi|Noida|Gurgaon|Gurugram|Kolkata|Ahmedabad|Jaipur|Lucknow|Kochi|Chandigarh|Indore|Coimbatore|Thiruvananthapuram|Bhopal|Nagpur|Visakhapatnam|Vadodara|Surat|Thane|Navi Mumbai|Ghaziabad|Faridabad|Greater Noida|Remote|Hybrid|Work from home|WFH)\b/i;
            const EXP_RE = /\d+\s*[-–]\s*\d+\s*(?:Yrs?|years?)/i;

            const allEls = document.querySelectorAll('div, section, article, li');
            for (const el of allEls) {
                const t = el.innerText?.trim();
                if (!t || t.length < 15 || t.length > 300) continue;
                const lines = t.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
                if (lines.length < 3 || lines.length > 8) continue;
                const hasExp = lines.some(l => EXP_RE.test(l));
                const hasCity = lines.some(l => CITIES_RE.test(l));
                if (!hasExp || !hasCity) continue;

                if (title === "N/A" && lines[0] && lines[0].length > 2 && lines[0].length < 100) title = lines[0];
                if (company === "N/A" && lines.length >= 2) {
                    const compLine = lines[1];
                    const cleaned = compLine.replace(/\d+\.?\d*\s*(?:reviews?|ratings?|stars?)?$/i, '').trim();
                    if (cleaned && cleaned.length > 1 && cleaned.length < 60 && !/naukri/i.test(cleaned)) {
                        company = cleaned;
                    }
                }
                for (const line of lines) {
                    if (experience === "Not Mentioned" && EXP_RE.test(line) && line.length < 30) experience = line;
                    if (salary === "Not Mentioned" && /\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:Lacs?|Lakh|Cr|LPA)/i.test(line)) salary = line;
                    if (CITIES_RE.test(line) && line.length < 50 && !EXP_RE.test(line)) location = line;
                }
                break;
            }

            // Script tags for company
            if (company === "N/A") {
                const scripts = document.querySelectorAll('script:not([src])');
                for (const s of scripts) {
                    const txt = s.textContent || '';
                    const coMatch = txt.match(/"companyName"\s*:\s*"([^"]+)"/);
                    if (coMatch) { company = coMatch[1]; break; }
                    const coMatch2 = txt.match(/"company"\s*:\s*"([^"]+)"/);
                    if (coMatch2 && !/naukri/i.test(coMatch2[1])) { company = coMatch2[1]; break; }
                }
            }
            if (company === "N/A") {
                const compLink = document.querySelector('a[href*="-jobs-careers-"], a[href*="/company/"]');
                if (compLink) {
                    const c = compLink.innerText?.trim();
                    if (c && c.length > 1 && c.length < 60 && !/naukri/i.test(c)) {
                        company = c;
                    }
                }
            }
        }

        // Apply page fallback: extract jobTitle from URL params if API didn't provide it
        if (_isApplyPage && title === "N/A") {
            const params = new URLSearchParams(window.location.search);
            const urlTitle = params.get('jobTitle');
            if (urlTitle) title = decodeURIComponent(urlTitle).trim();
        }

        // ── NAUKRI LAYER 2: DOM Selectors (only for missing fields) ──

        if (title === "N/A") {
            const h1 = document.querySelector("h1");
            const t = h1?.innerText?.trim();
            if (t && t.length >= 3 && t.length <= 150) title = t;
        }
        if (title === "N/A") {
            const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
            if (ogTitle) {
                const part = ogTitle.split(" - ")[0]?.trim();
                if (part && part.length > 2) title = part;
            }
        }
        if (title === "N/A") {
            const dt = document.title || "";
            const part = dt.split(" - ")[0]?.trim();
            if (part && part.length > 2 && !/naukri/i.test(part)) title = part;
        }
        if (title === "N/A") {
            const el = document.querySelector('a.title');
            if (el) title = el.innerText?.trim() || title;
        }

        if (company === "N/A" && !_isApplyPage) {
            const el = document.querySelector('a[href*="-jobs-careers-"]');
            if (el) company = el.innerText?.trim() || company;
        }
        if (company === "N/A") {
            const ogTitle = document.querySelector('meta[property="og:title"]')?.content || "";
            const mCo = ogTitle.match(/\s-\s(.+?)(?:\s*\||$)/);
            if (mCo) {
                const c = mCo[1].trim().replace(/\s*\|.*$/, '').trim();
                if (c && !/naukri/i.test(c)) company = c;
            }
        }
        if (company === "N/A" && !_isApplyPage) {
            const el = document.querySelector('a.comp-name');
            if (el) company = el.innerText?.trim() || company;
        }
        if (company === "N/A") {
            const s = document.querySelector('meta[property="og:site_name"]')?.content?.trim();
            if (s && !/naukri/i.test(s)) company = s;
        }

        if (experience === "Not Mentioned" && !_isApplyPage) {
            const el = document.querySelector('span.exp-wrap');
            if (el) { const t = el.innerText?.trim(); if (t && /\d/.test(t)) experience = t; }
        }

        if (salary === "Not Mentioned" && !_isApplyPage) {
            const el = document.querySelector('span.sal-wrap');
            if (el) { const t = el.innerText?.trim(); if (t && t !== "Not disclosed") salary = t; }
        }

        if (location === "N/A" && !_isApplyPage) {
            const el = document.querySelector('span.loc-wrap');
            if (el) { const t = el.innerText?.trim(); if (t && t.length >= 2 && t.length < 80 && !t.includes('\n')) location = t; }
        }

        // Single combined DOM scan for any remaining missing fields (skip on apply pages — would grab recommendation cards)
        const needExpDOM = !_isApplyPage && experience === "Not Mentioned";
        const needSalDOM = !_isApplyPage && salary === "Not Mentioned";
        const needLocDOM = !_isApplyPage && location === "N/A";
        if (needExpDOM || needSalDOM || needLocDOM) {
            const INDIAN_CITIES = /\b(Bengaluru|Bangalore|Mumbai|Hyderabad|Chennai|Pune|Delhi|New Delhi|Noida|Gurgaon|Gurugram|Kolkata|Ahmedabad|Jaipur|Lucknow|Kochi|Chandigarh|Indore|Coimbatore|Thiruvananthapuram|Bhopal|Nagpur|Visakhapatnam|Vadodara|Surat|Thane|Navi Mumbai|Ghaziabad|Faridabad|Greater Noida)\b/i;
            const allEls = document.querySelectorAll('span, div, a');
            let foundExp = !needExpDOM, foundSal = !needSalDOM, foundLoc = !needLocDOM;
            for (const el of allEls) {
                if (foundExp && foundSal && foundLoc) break;
                if (el.children.length > 3) continue;
                const t = el.innerText?.trim();
                if (!t || t.length < 2 || t.length > 80 || t.includes('\n')) continue;
                if (!foundExp && /^\d+\s*[-–]\s*\d+\s*(?:Yrs?|years?)$/i.test(t)) {
                    experience = t; foundExp = true; continue;
                }
                if (!foundSal && /\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:Lacs?|Lakh|Cr)\s*(?:PA)?/i.test(t) && t !== "Not disclosed") {
                    salary = t; foundSal = true; continue;
                }
                if (!foundLoc && (INDIAN_CITIES.test(t) || /\b(Remote|Hybrid|Work from home|WFH)\b/i.test(t))) {
                    location = t; foundLoc = true; continue;
                }
            }
        }


        // ── NAUKRI LAYER 3: Body Text Regex (only if still missing, skip on apply pages — body text contains recommendation cards) ──
        const needBodyRegex = !_isApplyPage && (experience === "Not Mentioned" || salary === "Not Mentioned" || location === "N/A");
        if (needBodyRegex) {
            const bodyTextLazy = getBodyText();

            if (experience === "Not Mentioned") {
                const expPatterns = [
                    /(\d+\s*[-–to]+\s*\d+)\s*\+?\s*(?:years?|yrs?)/i,
                    /(\d+)\s*\+\s*(?:years?|yrs?)/i,
                    /(?:at\s+least|minimum|min\.?)\s+(\d+)\s*\+?\s*(?:years?|yrs?)/i,
                    /(\d+)\s*(?:years?|yrs?)\s*(?:of)?\s*(?:relevant|total|overall|hands[- ]?on)?\s*(?:experience|exp)/i,
                    /experience\s*(?:of|:|-|–)?\s*(\d+)\s*\+?\s*(?:years?|yrs?)/i,
                ];
                for (const p of expPatterns) {
                    const m = bodyTextLazy.match(p);
                    if (m) { experience = m[0].trim(); break; }
                }
            }

            if (salary === "Not Mentioned") {
                const salaryPatterns = [
                    /(\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:Lacs?|Lakh)\s*(?:PA)?)/i,
                    /((?:INR|₹)\s*[\d,\.]+\s*(?:[-–to]+\s*(?:INR|₹)?\s*[\d,\.]+)?(?:\s*(?:LPA|lpa|CTC|ctc|per\s+(?:annum|year|month)))?)/i,
                    /(?:salary|compensation|ctc|pay|package)\s*(?::|-)?\s*([\$₹€£]\s*[\d,\.]+\s*(?:[-–to]+\s*[\$₹€£]?\s*[\d,\.]+)?(?:\s*(?:LPA|lpa|CTC|ctc|per\s+(?:annum|year|month)))?)/i,
                    /([\$₹€£]\s*[\d,\.]+\s*(?:[-–to]+\s*[\$₹€£]?\s*[\d,\.]+)?(?:\s*(?:LPA|lpa|CTC|ctc|per\s+(?:annum|year|month))))/i,
                    /(\d[\d,\.]+\s*[-–to]+\s*\d[\d,\.]+\s*(?:LPA|lpa|CTC|ctc))/i,
                ];
                for (const p of salaryPatterns) {
                    const m = bodyTextLazy.match(p);
                    if (m) { salary = m[1]?.trim() || m[0].trim(); break; }
                }
            }

            if (location === "N/A") {
                const CITIES = /\b(Bengaluru|Bangalore|Mumbai|Hyderabad|Chennai|Pune|Delhi|New Delhi|Noida|Gurgaon|Gurugram|Kolkata|Ahmedabad|Jaipur|Lucknow|Kochi|Chandigarh|Indore|Coimbatore)\b/i;
                const m = bodyTextLazy.match(CITIES);
                if (m) location = m[1];
            }
        }

        // Build a proper job URL if we found a job ID on a search page
        const finalUrl = (_jobIdSource !== 'url-path' && jobId)
            ? `https://www.naukri.com/job/${jobId}`
            : window.location.href;

        const _applyPageNote = _isApplyPage && company === "N/A"
            ? "Naukri blocks detailed extraction on apply confirmation pages. For full details (company, location, salary), save from the job listing page before applying."
            : null;

        return {
            date: new Date().toISOString().split("T")[0],
            company,
            salary,
            location,
            title,
            experience,
            status: "Applied",
            portal: "naukri.com",
            url: finalUrl,
            _applyPageNote
        };
    }

    // ── LinkedIn: LAYER 2 DOM extraction ──

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
                const m = getBodyText().match(pat);
                if (m && isLocation(m[1].trim())) {
                    location = m[1].trim();
                    break;
                }
            }
        }

        // Strategy 5: "City (Remote/On-site/Hybrid)" or standalone work type
        if (location === "N/A") {
            const wt = getBodyText().match(/([A-Z][a-zA-Z\s,]*?)\s*\((?:Remote|On-site|Hybrid|On site)\)/i);
            if (wt && isLocation(wt[1].trim())) {
                location = wt[0].trim();
            } else {
                const standalone = getBodyText().match(/\b(Remote|On-site|Hybrid)\b/i);
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
            const m = getBodyText().match(pattern);
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
            const m = getBodyText().match(pattern);
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
        portal: "linkedin.com",
        url: window.location.href
    };
}
