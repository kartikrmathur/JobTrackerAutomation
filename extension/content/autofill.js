(function () {
  const FIELD_PATTERNS = {
    firstName: [/first.?name/i, /\bfname\b/i, /given.?name/i],
    lastName: [/last.?name/i, /\blname\b/i, /family.?name/i, /surname/i],
    email: [/\bemail\b/i, /e-?mail/i],
    phone: [/\bphone\b/i, /mobile/i, /contact.?number/i, /telephone/i],
    address: [/address/i, /street/i, /address.?line/i],
    city: [/\bcity\b/i, /town/i],
    state: [/\bstate\b/i, /province/i, /region/i],
    zip: [/\bzip\b/i, /postal.?code/i, /pin.?code/i],
    country: [/\bcountry\b/i, /nation/i],
    currentTitle: [/current.?title/i, /job.?title/i, /designation/i, /position/i],
    currentCompany: [/current.?company/i, /employer/i, /company.?name/i, /organization/i],
    yearsExperience: [/years?.?experience/i, /\bexperience\b/i, /total.?experience/i],
    expectedSalary: [/expected.?salary/i, /salary.?expectation/i, /compensation/i, /ctc/i],
    noticePeriod: [/notice.?period/i, /available.?from/i, /joining/i],
    skills: [/\bskills?\b/i, /technologies/i, /stack/i],
    summary: [/summary/i, /about.?you/i, /cover.?letter/i, /bio/i, /profile/i],
    degree: [/\bdegree\b/i, /qualification/i],
    major: [/\bmajor\b/i, /specialization/i, /stream/i, /field.?of.?study/i],
    university: [/university/i, /college/i, /institution/i, /school/i],
    graduationYear: [/graduation.?year/i, /passing.?year/i, /year.?of.?graduation/i],
    gpa: [/\bgpa\b/i, /grade.?point/i, /cgpa/i],
    nationalIdentifier: [/national.?identifier/i, /\bnational.?id\b/i, /\baadhaar\b/i, /\bssn\b/i, /\bsocial.?security\b/i, /\bpan\b/i],
    linkedin: [/linkedin/i],
    github: [/github/i],
    portfolio: [/portfolio/i, /personal.?website/i, /website/i]
  };

  const PANEL_FIELDS = [
    ["firstName", "First Name"],
    ["lastName", "Last Name"],
    ["email", "Email"],
    ["phone", "Phone"],
    ["nationalIdentifier", "National ID"],
    ["currentCompany", "Current Company"],
    ["currentTitle", "Current Title"],
    ["yearsExperience", "Years Experience"],
    ["expectedSalary", "Expected Salary"],
    ["noticePeriod", "Notice Period"],
    ["linkedin", "LinkedIn"],
    ["github", "GitHub"],
    ["portfolio", "Portfolio"]
  ];

  function normalize(text) {
    return String(text || "").trim().toLowerCase();
  }

  function getLabelText(el) {
    if (!el) return "";
    if (el.labels && el.labels.length) {
      return Array.from(el.labels).map((label) => label.textContent || "").join(" ");
    }
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.textContent || "";
    }
    return "";
  }

  function extractFieldSignals(el) {
    const parent = el.parentElement;
    return [
      el.name,
      el.id,
      el.placeholder,
      el.getAttribute("aria-label"),
      el.getAttribute("autocomplete"),
      el.getAttribute("data-testid"),
      el.getAttribute("data-automation-id"),
      getLabelText(el),
      parent?.getAttribute("data-qa"),
      parent?.getAttribute("data-testid"),
      parent?.className
    ]
      .filter(Boolean)
      .join(" ");
  }

  function detectFieldType(el) {
    const signals = normalize(extractFieldSignals(el));
    if (!signals) return null;

    let winner = null;
    let score = 0;

    for (const [fieldKey, patterns] of Object.entries(FIELD_PATTERNS)) {
      let local = 0;
      for (const pattern of patterns) {
        if (pattern.test(signals)) local += 1;
      }
      if (local > score) {
        score = local;
        winner = fieldKey;
      }
    }

    return score > 0 ? winner : null;
  }

  function isVisibleField(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.tagName === "INPUT" && normalize(el.type) === "hidden") return false;
    if (el.hasAttribute("hidden")) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;

    const style = window.getComputedStyle(el);
    if (!style) return false;
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    return true;
  }

  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor?.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  function fillField(el, value) {
    if (value == null || value === "") return false;
    if (!isVisibleField(el)) return false;

    const normalizedValue = String(value);
    const tag = el.tagName.toLowerCase();
    const type = normalize(el.type);

    if (tag === "select") {
      const options = Array.from(el.options || []);
      const exact = options.find((option) => normalize(option.value) === normalize(normalizedValue));
      const textMatch = options.find((option) => normalize(option.textContent) === normalize(normalizedValue));
      const option = exact || textMatch;
      if (!option) return false;
      el.value = option.value;
    } else if (tag === "textarea" || tag === "input") {
      if (type === "checkbox" || type === "radio") return false;
      setNativeValue(el, normalizedValue);
    } else {
      return false;
    }

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }

  function collectFillableElements(root = document) {
    return Array.from(root.querySelectorAll("input, textarea, select"));
  }

  /** Field types that rarely appear together unless it is a job or HR-style form */
  const STRONG_JOB_FIELD_TYPES = new Set([
    "currentTitle",
    "currentCompany",
    "yearsExperience",
    "expectedSalary",
    "noticePeriod",
    "degree",
    "major",
    "university",
    "graduationYear",
    "gpa",
    "nationalIdentifier",
    "linkedin",
    "github",
    "portfolio",
    "summary",
    "skills"
  ]);

  const WEAK_JOB_FIELD_TYPES = new Set([
    "firstName",
    "lastName",
    "email",
    "phone",
    "address",
    "city",
    "state",
    "zip",
    "country"
  ]);

  function pageHintsJobApplication() {
    const href = normalize(location.href);
    if (
      /(\/apply|\/application|\/careers|\/jobs\/|\/job\/|\/vacancy|\/position|greenhouse\.io|lever\.co|myworkday|workday|taleo|icims|smartrecruiters|ashbyhq|jobvite|bamboohr|recruitee|naukri\.com\/|indeed\.com\/apply|linkedin\.com\/jobs)/i.test(
        href
      )
    ) {
      return true;
    }
    const title = normalize(document.title);
    if (/(apply|application|careers|job application|upload (your )?cv|upload (your )?resume|cover letter|work history|employment)/i.test(title)) {
      return true;
    }
    const body = document.body?.innerText || "";
    const sample = body.slice(0, 12000);
    if (/(job application|apply for this (role|job|position)|upload (your )?(resume|cv)|cover letter|work history|years of experience|notice period|expected (salary|ctc)|linkedin profile)/i.test(sample)) {
      return true;
    }
    return false;
  }

  function hasResumeFileInput(elements) {
    for (const el of elements) {
      if (!isVisibleField(el)) continue;
      if (el.tagName !== "INPUT") continue;
      if (normalize(el.type) !== "file") continue;
      const signals = normalize(`${extractFieldSignals(el)} ${el.accept || ""} ${el.getAttribute("name") || ""}`);
      if (/(resume|cv|curriculum|vitae)/i.test(signals)) return true;
    }
    return false;
  }

  function isLikelyLoginOnlyForm(elements, detectedTypes) {
    const hasPassword = elements.some(
      (el) => el.tagName === "INPUT" && normalize(el.type) === "password" && isVisibleField(el)
    );
    if (!hasPassword) return false;
    const strong = [...detectedTypes].filter((t) => STRONG_JOB_FIELD_TYPES.has(t));
    if (strong.length > 0) return false;
    if (detectedTypes.size >= 3) return false;
    return detectedTypes.size <= 2;
  }

  /**
   * Heuristic: show JobFill only when the page looks like a job application (not generic contact/login/search).
   */
  function shouldShowJobApplicationHelper() {
    if (window.top !== window) return false;

    const elements = collectFillableElements(document);
    const detectedTypes = new Set();
    for (const el of elements) {
      if (!isVisibleField(el)) continue;
      const t = detectFieldType(el);
      if (t) detectedTypes.add(t);
    }

    const strongTypes = [...detectedTypes].filter((t) => STRONG_JOB_FIELD_TYPES.has(t));
    const weakTypes = [...detectedTypes].filter((t) => WEAK_JOB_FIELD_TYPES.has(t));
    const resumeFile = hasResumeFileInput(elements);
    const hints = pageHintsJobApplication();

    if (resumeFile) return true;
    if (strongTypes.length >= 2) return true;
    if (strongTypes.length >= 1 && weakTypes.length >= 2) return true;
    if (detectedTypes.size >= 4 && strongTypes.length >= 1) return true;
    if (detectedTypes.size >= 3 && hints) return true;
    if (strongTypes.length >= 1 && hints) return true;

    if (isLikelyLoginOnlyForm(elements, detectedTypes)) return false;
    if (detectedTypes.size <= 1 && !hints && !resumeFile) return false;

    return false;
  }

  let jobFormWatchObserver = null;
  let jobFormWatchChecks = 0;
  const JOB_FORM_WATCH_MAX_CHECKS = 80;

  function stopJobFormWatcher() {
    if (jobFormWatchObserver) {
      jobFormWatchObserver.disconnect();
      jobFormWatchObserver = null;
    }
  }

  function startJobFormWatcher() {
    if (window.top !== window) return;
    if (jobFormWatchObserver || document.getElementById("jobfill-floating-panel")) return;
    jobFormWatchChecks = 0;

    let debounceTimer = null;
    const runCheck = () => {
      if (document.getElementById("jobfill-floating-panel")) {
        stopJobFormWatcher();
        return;
      }
      jobFormWatchChecks += 1;
      if (jobFormWatchChecks > JOB_FORM_WATCH_MAX_CHECKS) {
        stopJobFormWatcher();
        return;
      }
      if (shouldShowJobApplicationHelper()) {
        stopJobFormWatcher();
        createFloatingPanel();
      }
    };

    jobFormWatchObserver = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runCheck, 350);
    });
    jobFormWatchObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function tryInstallFloatingPanel() {
    if (window.top !== window) return;
    if (document.getElementById("jobfill-floating-panel")) return;
    if (shouldShowJobApplicationHelper()) {
      stopJobFormWatcher();
      createFloatingPanel();
      return;
    }
    startJobFormWatcher();
  }

  function autofillPage(profileData) {
    const filled = [];
    const skipped = [];
    const unmatched = [];
    const elements = collectFillableElements(document);
    const comboboxCount = document.querySelectorAll('[role="combobox"]').length;
    const contentEditableCount = document.querySelectorAll('[contenteditable="true"]').length;
    const ariaTextboxCount = document.querySelectorAll('[role="textbox"]').length;
    const openShadowHostCount = Array.from(document.querySelectorAll("*")).filter((el) => el.shadowRoot).length;
    let experienceDetectedCount = 0;
    let nationalIdDetectedCount = 0;
    let experienceKeywordCandidates = 0;
    const experienceCandidateSamples = [];

    for (const el of elements) {
      if (!isVisibleField(el)) {
        skipped.push({ reason: "hidden", name: el.name || el.id || el.tagName.toLowerCase() });
        continue;
      }

      const fieldType = detectFieldType(el);
      if (!fieldType) {
        const signals = normalize(extractFieldSignals(el));
        if (/(experience|employer|designation|start date|end date|responsibilities|years?)/i.test(signals)) {
          experienceKeywordCandidates += 1;
          if (experienceCandidateSamples.length < 5) {
            experienceCandidateSamples.push({
              element: el.name || el.id || el.tagName.toLowerCase(),
              signalSnippet: signals.slice(0, 120)
            });
          }
        }
        unmatched.push(el.name || el.id || el.placeholder || el.tagName.toLowerCase());
        continue;
      }
      if (fieldType === "yearsExperience") experienceDetectedCount += 1;
      if (fieldType === "nationalIdentifier") nationalIdDetectedCount += 1;

      const value = profileData[fieldType];
      const success = fillField(el, value);
      if (success) {
        filled.push({ fieldType, element: el.name || el.id || el.tagName.toLowerCase() });
      } else {
        skipped.push({ fieldType, reason: "empty-or-unsupported" });
      }
    }

    return { filled, skipped, unmatched };
  }

  function detectFields() {
    const elements = collectFillableElements(document).filter(isVisibleField);
    return elements.map((el) => ({
      element: el.name || el.id || el.placeholder || el.tagName.toLowerCase(),
      detectedType: detectFieldType(el),
      signals: extractFieldSignals(el)
    }));
  }

  async function copyTextToClipboard(value) {
    if (!value) return false;
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (_err) {
      const el = document.createElement("textarea");
      el.value = value;
      el.style.position = "fixed";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      el.remove();
      return ok;
    }
  }

  function createFloatingPanel() {
    if (window.top !== window) return;
    if (document.getElementById("jobfill-floating-panel")) return;

    const style = document.createElement("style");
    style.textContent = `
      #jobfill-floating-toggle{position:fixed;right:14px;bottom:14px;z-index:2147483646;background:#4ade80;color:#03240f;border:0;border-radius:999px;padding:8px 11px;font:600 12px/1.2 "DM Sans",Arial,sans-serif;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25)}
      #jobfill-floating-panel{position:fixed;right:14px;bottom:58px;z-index:2147483646;width:290px;max-height:72vh;overflow:auto;background:#0d0f12;color:#e5e7eb;border:1px solid #253041;border-radius:10px;box-shadow:0 10px 24px rgba(0,0,0,.35);font:12px/1.4 "DM Sans",Arial,sans-serif}
      #jobfill-floating-panel .jf-header{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:#151a20;border-bottom:1px solid #253041;cursor:move}
      #jobfill-floating-panel .jf-title{font-weight:600}
      #jobfill-floating-panel .jf-actions button{background:#1f2937;color:#e5e7eb;border:1px solid #334155;border-radius:6px;padding:2px 8px;cursor:pointer}
      #jobfill-floating-panel .jf-body{padding:9px}
      #jobfill-floating-panel .jf-row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;margin-bottom:6px}
      #jobfill-floating-panel .jf-key{color:#9ca3af;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #jobfill-floating-panel .jf-copy{background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:6px;padding:3px 8px;cursor:pointer}
      #jobfill-floating-panel .jf-copy:disabled{opacity:.45;cursor:not-allowed}
      #jobfill-floating-panel .jf-section{margin-top:10px;border-top:1px dashed #273244;padding-top:8px}
      #jobfill-floating-panel .jf-status{margin-top:6px;color:#9ca3af;min-height:15px}
      #jobfill-floating-panel .jf-exp-card{border:1px solid #253041;border-radius:8px;padding:7px;margin-bottom:7px;background:#111820}
      #jobfill-floating-panel .jf-exp-title{font-weight:600;color:#9ca3af;margin-bottom:5px}
      #jobfill-floating-panel .jf-profile-select{width:100%;margin-bottom:7px;background:#111827;color:#e5e7eb;border:1px solid #334155;border-radius:6px;padding:5px}
      #jobfill-floating-panel .jf-copy-focus{width:100%;margin-top:5px;background:#1f2937;color:#e5e7eb;border:1px solid #334155;border-radius:6px;padding:6px;cursor:pointer}
    `;
    document.documentElement.appendChild(style);

    const toggleBtn = document.createElement("button");
    toggleBtn.id = "jobfill-floating-toggle";
    toggleBtn.textContent = "JobFill";
    document.body.appendChild(toggleBtn);

    const panel = document.createElement("div");
    panel.id = "jobfill-floating-panel";
    panel.innerHTML = `
      <div class="jf-header">
        <div class="jf-title">JobFill Helper</div>
        <div class="jf-actions"><button type="button" id="jf-close">-</button></div>
      </div>
      <div class="jf-body">
        <select class="jf-profile-select" id="jf-profile"></select>
        <div id="jf-fields"></div>
        <div class="jf-section">
          <div class="jf-title">Experience</div>
          <div id="jf-experiences"></div>
        </div>
        <button class="jf-copy-focus" type="button" id="jf-copy-focus">Copy focused field label</button>
        <div class="jf-status" id="jf-status"></div>
      </div>
    `;
    document.body.appendChild(panel);

    let currentProfiles = [];
    let currentProfile = null;
    const profileSelect = panel.querySelector("#jf-profile");
    const fieldsWrap = panel.querySelector("#jf-fields");
    const expsWrap = panel.querySelector("#jf-experiences");
    const statusEl = panel.querySelector("#jf-status");

    const setStatus = (msg) => { statusEl.textContent = msg; };

    function renderPanelData() {
      fieldsWrap.textContent = "";
      expsWrap.textContent = "";
      if (!currentProfile) {
        setStatus("Create a profile in extension options.");
        return;
      }
      const data = currentProfile.data || {};
      for (const [key, label] of PANEL_FIELDS) {
        const row = document.createElement("div");
        row.className = "jf-row";
        const value = String(data[key] || "");
        row.innerHTML = `<span class="jf-key">${label}: ${value || "-"}</span>`;
        const copyBtn = document.createElement("button");
        copyBtn.className = "jf-copy";
        copyBtn.textContent = "Copy";
        copyBtn.disabled = !value;
        copyBtn.addEventListener("click", async () => {
          const ok = await copyTextToClipboard(value);
          setStatus(ok ? `Copied ${label}` : `Copy failed for ${label}`);
        });
        row.appendChild(copyBtn);
        fieldsWrap.appendChild(row);
      }

      const experiences = Array.isArray(data.experiences) ? data.experiences : [];
      experiences.forEach((exp, idx) => {
        const card = document.createElement("div");
        card.className = "jf-exp-card";
        card.innerHTML = `<div class="jf-exp-title">Experience ${idx + 1}</div>`;
        const entries = [
          ["Employer", exp.employerName],
          ["Designation", exp.designation],
          ["Start", [exp.startMonth, exp.startYear].filter(Boolean).join(" ")],
          ["End", [exp.endMonth, exp.endYear].filter(Boolean).join(" ")],
          ["Responsibilities", exp.responsibilities]
        ];
        entries.forEach(([k, v]) => {
          const row = document.createElement("div");
          row.className = "jf-row";
          row.innerHTML = `<span class="jf-key">${k}: ${v || "-"}</span>`;
          const btn = document.createElement("button");
          btn.className = "jf-copy";
          btn.textContent = "Copy";
          btn.disabled = !v;
          btn.addEventListener("click", async () => {
            const ok = await copyTextToClipboard(String(v || ""));
            setStatus(ok ? `Copied ${k}` : `Copy failed for ${k}`);
          });
          row.appendChild(btn);
          card.appendChild(row);
        });
        expsWrap.appendChild(card);
      });
      if (experiences.length === 0) {
        expsWrap.innerHTML = `<div class="jf-key">No experience rows saved yet.</div>`;
      }
    }

    function chooseProfile(activeProfileId) {
      currentProfile = currentProfiles.find((p) => p.id === activeProfileId) || currentProfiles[0] || null;
      profileSelect.textContent = "";
      currentProfiles.forEach((profile) => {
        const opt = document.createElement("option");
        opt.value = profile.id;
        opt.textContent = profile.name || "Untitled Profile";
        profileSelect.appendChild(opt);
      });
      if (currentProfile) profileSelect.value = currentProfile.id;
      renderPanelData();
    }

    async function loadProfilesForPanel() {
      const storage = await chrome.storage.local.get({ profiles: [], activeProfileId: "" });
      currentProfiles = Array.isArray(storage.profiles) ? storage.profiles : [];
      chooseProfile(storage.activeProfileId || "");
    }

    profileSelect.addEventListener("change", async () => {
      const selected = profileSelect.value;
      currentProfile = currentProfiles.find((p) => p.id === selected) || null;
      await chrome.storage.local.set({ activeProfileId: selected });
      renderPanelData();
    });

    panel.querySelector("#jf-copy-focus").addEventListener("click", async () => {
      const activeEl = document.activeElement;
      if (!activeEl || !(activeEl instanceof HTMLElement)) {
        setStatus("Focus any field first.");
        return;
      }
      const label = extractFieldSignals(activeEl);
      const ok = await copyTextToClipboard(label || "");
      setStatus(ok ? "Copied focused field label/signals" : "Nothing to copy.");
    });

    toggleBtn.addEventListener("click", () => { panel.style.display = panel.style.display === "none" ? "block" : "none"; });
    panel.querySelector("#jf-close").addEventListener("click", () => { panel.style.display = "none"; });

    let dragStartX = 0;
    let dragStartY = 0;
    let panelStartX = 0;
    let panelStartY = 0;
    const header = panel.querySelector(".jf-header");
    const onMove = (e) => {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.left = `${panelStartX + dx}px`;
      panel.style.top = `${panelStartY + dy}px`;
    };
    header.addEventListener("mousedown", (e) => {
      const rect = panel.getBoundingClientRect();
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      panelStartX = rect.left;
      panelStartY = rect.top;
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", () => document.removeEventListener("mousemove", onMove), { once: true });
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.profiles || changes.activeProfileId) {
        loadProfilesForPanel().catch(() => {});
      }
    });

    loadProfilesForPanel().catch(() => {
      setStatus("Could not load profiles.");
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;

    if (message.type === "AUTOFILL") {
      const profileData = message.profile?.data || {};
      const result = autofillPage(profileData);
      sendResponse({ ok: true, result });
      return true;
    }

    if (message.type === "DETECT_FIELDS") {
      sendResponse({ ok: true, result: detectFields() });
      return true;
    }

    return false;
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tryInstallFloatingPanel, { once: true });
  } else {
    tryInstallFloatingPanel();
  }
})();
