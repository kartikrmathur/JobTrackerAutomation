/**
 * Extract plain text from .docx / .pdf and map heuristically to JobFill profile fields.
 * Depends on globals: JSZip, pdfjsLib, chrome.runtime (for pdf worker URL).
 */
(function initResumeParser(global) {
  const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

  const SECTION_REGEX =
    /^(professional\s+summary|summary|objective|about\s+me|skills|technical\s+skills|core\s+competencies|experience|work\s+experience|professional\s+experience|employment|projects|education|academic|certifications)(\s*|[:.\-])/i;

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error("Could not read file."));
      r.readAsArrayBuffer(file);
    });
  }

  async function extractDocxText(ab) {
    const zip = await JSZip.loadAsync(ab);
    const entry = zip.file("word/document.xml");
    if (!entry) throw new Error("Invalid .docx (missing word/document.xml).");

    const xmlStr = await entry.async("string");
    const doc = new DOMParser().parseFromString(xmlStr, "application/xml");
    const paragraphs = doc.getElementsByTagNameNS(W_NS, "p");
    const lines = [];
    for (const p of paragraphs) {
      const texts = p.getElementsByTagNameNS(W_NS, "t");
      let line = "";
      for (const t of texts) line += t.textContent || "";
      const trimmed = line.replace(/\s+/g, " ").trim();
      if (trimmed) lines.push(trimmed);
    }
    return lines.join("\n");
  }

  async function extractPdfText(ab) {
    if (!global.pdfjsLib) throw new Error("PDF engine not loaded.");
    global.pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.min.js");
    const pdf = await global.pdfjsLib.getDocument({ data: ab }).promise;
    const pageChunks = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const line = content.items.map((item) => item.str).join(" ");
      if (line.trim()) pageChunks.push(line.replace(/\s+/g, " ").trim());
    }
    return pageChunks.join("\n\n");
  }

  function normalizeText(t) {
    return String(t || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function linesFromText(text) {
    return normalizeText(text)
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }

  function findSectionBounds(lines) {
    const headers = [];
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i].trim();
      const short = L.length < 60 && !L.includes("@");
      if (short && SECTION_REGEX.test(L)) {
        headers.push({ name: L.replace(/[:.\-\s]+$/g, "").trim(), start: i });
      }
    }
    const ranges = {};
    for (let h = 0; h < headers.length; h++) {
      const { name, start } = headers[h];
      const end = h + 1 < headers.length ? headers[h + 1].start : lines.length;
      const key = name.toLowerCase();
      if (/summary|objective|about/.test(key)) ranges.summary = { start: start + 1, end };
      else if (/skill|competenc/.test(key)) ranges.skills = { start: start + 1, end };
      else if (/experience|employment/.test(key)) ranges.experience = { start: start + 1, end };
      else if (/education|academic/.test(key)) ranges.education = { start: start + 1, end };
    }
    return ranges;
  }

  function sliceSection(lines, range) {
    if (!range) return "";
    return lines.slice(range.start, range.end).join("\n").trim();
  }

  function extractUrls(text) {
    const urlRe = /(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/in\/[^\s|,;]+|github\.com\/[^\s|,;]+|[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s|,;]*)?)/gi;
    const urls = text.match(urlRe) || [];
    const normalizeCandidateUrl = (raw) => {
      const cleaned = String(raw || "").replace(/^[|]+/, "").replace(/[|]+$/, "").trim();
      if (!cleaned) return "";
      if (/^https?:\/\//i.test(cleaned)) return cleaned.split("?")[0];
      return `https://${cleaned}`.split("?")[0];
    };
    let linkedin = "";
    let github = "";
    let portfolio = "";
    for (const u of urls) {
      if (!linkedin && /linkedin\.com\/in\//i.test(u)) linkedin = normalizeCandidateUrl(u);
      else if (!github && /github\.com\/[^/\s]+/i.test(u)) github = normalizeCandidateUrl(u);
      else if (!portfolio && !/linkedin\.com|github\.com|gmail\.com|yahoo\.com|outlook\.com/i.test(u)) portfolio = normalizeCandidateUrl(u);
    }
    return { linkedin, github, portfolio };
  }

  function extractEmail(text) {
    const m = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    return m ? m[0] : "";
  }

  /** India + generic international-ish phone hints */
  function extractPhone(text) {
    const tidy = text.replace(/[\u00a0]/g, " ");
    const patterns = [
      /\+?\d{1,3}[\s.-]?\d{5}[\s.-]?\d{5}/,
      /\b\+91[\s.-]?[6-9]\d{9}\b/,
      /\b[6-9]\d{9}\b/,
      /\(\d{3}\)\s*\d{3}[-.\s]?\d{4}/,
      /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/
    ];
    for (const re of patterns) {
      const m = tidy.match(re);
      if (m) return m[0].replace(/\s+/g, " ").trim();
    }
    return "";
  }

  /** Total years — prefer explicit "X years"; else max from ranges */
  function extractYearsExperience(text) {
    const t = text.toLowerCase();
    const mParen = text.match(/\((\d+)\+?\s*(?:years?|yrs?)\)/i);
    if (mParen) return `${mParen[1]}+ years`;

    const mWord = text.match(/\b(\d+)\+?\s*(?:years?|yrs?)(?:\s+of\s+experience)?\b/i);
    if (mWord) return mWord[0];

    const mRange = text.match(/\b(\d+)\s*[-–]\s*(\d+)\s*(?:years?|yrs?)\b/i);
    if (mRange) return mRange[0];

    let maxSpan = 0;
    const yearRe = /\b(19|20)\d{2}\b/g;
    let m;
    while ((m = yearRe.exec(text)) !== null) {
      const y = parseInt(m[0], 10);
      const slice = text.slice(m.index, m.index + 40);
      const rest = slice.match(/\b(19|20)\d{2}\b/g);
      if (rest && rest.length >= 2) {
        const ys = rest.map(Number).sort((a, b) => a - b);
        const span = ys[ys.length - 1] - ys[0];
        if (span > maxSpan && span <= 45) maxSpan = span;
      }
    }
    if (maxSpan > 0) return `~${maxSpan}+ years`;

    return "";
  }

  function guessName(lines, skipSet) {
    for (let i = 0; i < Math.min(lines.length, 14); i++) {
      const L = lines[i];
      if (skipSet.has(i)) continue;
      if (/^page\s*\d|^curriculum|^resume|^cv\b/i.test(L)) continue;
      if (/@|http:/i.test(L)) continue;
      if (/^\d+\s*[-–]\s*\d+/.test(L)) continue;
      if (L.length > 70 || L.length < 2) continue;
      if (/[|•]/.test(L) && L.split(/\s+/).length > 8) continue;
      let normalizedLine = L;
      if (/^[A-Z](?:\s+[A-Z]){3,}$/.test(L)) {
        normalizedLine = L.replace(/\s+/g, "");
      }
      const words = normalizedLine.split(/\s+/).filter(Boolean);
      if (words.length >= 2 && words.length <= 6) {
        const looksTitle = words.every((w) => /^[A-Za-z][A-Za-z'.-]*$/.test(w));
        if (looksTitle) return { line: normalizedLine, index: i };
      }
    }
    return null;
  }

  function splitName(full) {
    const parts = full.trim().split(/\s+/);
    if (parts.length === 1) return { firstName: parts[0], lastName: "" };
    return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
  }

  function parseEducationBlock(block) {
    const result = { degree: "", major: "", university: "", graduationYear: "" };
    const yearMatch = block.match(/\b((?:19|20)\d{2})\b/);
    if (yearMatch) result.graduationYear = yearMatch[1];

    const lines = linesFromText(block);
    const headline = lines[0] || block;
    // "B.Tech. Computer Science — IIT X" / "MBA, Finance, university"
    let rest = headline;
    if (/^bachelor|master|b\.?tech|m\.?tech|b\.?e\.?|m\.?e\.?|bba|mba|msc|m\.sc|ph\.?d/i.test(headline)) {
      result.degree = headline.split(/[,|—\-–]/)[0].trim();

      const afterDeg = headline.slice(result.degree.length).replace(/^[,|—\-–]\s*/, "");
      const bits = afterDeg.split(/[,|—\-–]/).map((s) => s.trim()).filter(Boolean);
      if (bits[0] && !/university|college|institute/i.test(bits[0])) result.major = bits[0];

      const uniLine =
        lines.find((l) => /university|college|institute|school/i.test(l)) ||
        bits.find((b) => /university|college|institute|school/i.test(b));
      if (uniLine) result.university = uniLine.trim();

      if (!result.university && bits.length >= 2) {
        result.university = bits[bits.length - 1];
      }
    } else if (lines.length >= 2) {
      result.university = lines[0];
      result.degree = lines[1];
    }

    const tableLike = block.match(/((?:19|20)\d{2})\s+([^\n]{3,120}?)(?:\s{2,}|\s+)([^\n]{3,180})/i);
    if (tableLike) {
      result.graduationYear = result.graduationYear || tableLike[1];
      if (!result.degree) result.degree = tableLike[2].trim();
      if (!result.university) result.university = tableLike[3].trim();
      if (!result.major) {
        const m = result.degree.match(/\b(in|of)\s+([A-Za-z&\s]+)/i);
        if (m) result.major = m[2].trim();
      }
    }

    Object.keys(result).forEach((k) => {
      if (typeof result[k] === "string") result[k] = result[k].replace(/\s+/g, " ").trim();
    });
    return result;
  }

  function makeEmptyExp() {
    return {
      employerName: "",
      designation: "",
      startMonth: "",
      startYear: "",
      endMonth: "",
      endYear: "",
      responsibilities: ""
    };
  }

  function parseExperienceSection(sectionText) {
    const trimmed = normalizeText(sectionText);
    if (!trimmed) return [];

    const rows = [];
    const lines = trimmed
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/^--\s*\d+\s+of\s+\d+\s*--$/i.test(l));

    const parseDatesIntoRow = (line, row) => {
      const dateRange =
        line.match(
          /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|\d{1,2}\/\d{4}|(?:19|20)\d{2})\s*[-–—]\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|Present|Current|Till\s*date|Pursuing|\d{1,2}\/\d{4}|(?:19|20)\d{2})/i
        ) || line.match(/\b((?:19|20)\d{2})\s*[-–]\s*((?:19|20)\d{2}|Present|Current)\b/i);
      if (!dateRange) return line;

      const [a, b] = [dateRange[1].trim(), dateRange[2].trim()];
      const m1 = a.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*)\.?\s*((?:19|20)\d{2})/i);
      const m2 = b.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*)\.?\s*((?:19|20)\d{2})/i);
      if (m1) {
        row.startMonth = m1[1];
        row.startYear = m1[2];
      } else if (/(?:19|20)\d{2}/.test(a)) {
        row.startYear = a.match(/((?:19|20)\d{2})/)[1];
      }
      if (/present|current|till|pursuing/i.test(b)) {
        row.endMonth = "Present";
      } else if (m2) {
        row.endMonth = m2[1];
        row.endYear = m2[2];
      } else if (/(?:19|20)\d{2}/.test(b)) {
        row.endYear = b.match(/((?:19|20)\d{2})/)[1];
      }
      return line.replace(dateRange[0], "").trim();
    };

    const isSectionBreak = (line) =>
      /^(projects?|education|technical skills|strengths|certification|other experiences)/i.test(line);
    const isCompanyLine = (line) =>
      /^[A-Z][A-Za-z0-9&'.\-\s]+(?:LLP|Ltd|Limited|Technologies|Infotech|India|Jio|Deloitte|Elxsi)?\s+[A-Z][A-Za-z.\-\s]+,\s*[A-Za-z.\-\s]+$/.test(line);
    const isRoleDateLine = (line) =>
      /(?:software|java|backend|intern|engineer|developer|trainee|lead|consultant|architect)/i.test(line) &&
      /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|19\d{2}|20\d{2})/i.test(line);
    const isBullet = (line) => /^[•\-\*\u2022\u25cf●]/.test(line);

    let current = null;
    const flush = () => {
      if (!current) return;
      current.responsibilities = current.responsibilities.trim();
      const hasAny = current.employerName || current.designation || current.responsibilities || current.startYear || current.endYear;
      if (hasAny) rows.push(current);
      current = null;
    };

    for (const rawLine of lines) {
      const line = rawLine.replace(/\s+/g, " ").trim();
      if (!line) continue;
      if (isSectionBreak(line)) break;
      if (/^(experience|early experience)$/i.test(line)) continue;

      if (isCompanyLine(line)) {
        flush();
        current = makeEmptyExp();
        current.employerName = line.replace(/\s+[A-Z][A-Za-z.\-\s]+,\s*[A-Za-z.\-\s]+$/, "").trim();
        continue;
      }

      if (!current && isRoleDateLine(line)) current = makeEmptyExp();
      if (!current) continue;

      if (!current.designation && isRoleDateLine(line)) {
        const noDates = parseDatesIntoRow(line, current);
        current.designation = noDates.trim();
        continue;
      }

      if (isBullet(line)) {
        current.responsibilities += `${current.responsibilities ? "\n" : ""}${line.replace(/^[•\-\*\u2022\u25cf●]\s*/, "").trim()}`;
        continue;
      }

      if (!current.designation && / at /i.test(line)) {
        const noDates = parseDatesIntoRow(line, current);
        const mm = noDates.match(/^(.+?)\s+at\s+(.+)$/i);
        if (mm) {
          current.designation = mm[1].trim();
          if (!current.employerName) current.employerName = mm[2].trim();
          continue;
        }
      }

      const maybeDateReduced = parseDatesIntoRow(line, current);
      if (!current.designation && maybeDateReduced !== line) {
        current.designation = maybeDateReduced.trim();
      } else if (!/^\d{4}$/.test(line)) {
        current.responsibilities += `${current.responsibilities ? "\n" : ""}${line}`;
      }
    }
    flush();

    return rows.slice(0, 8);
  }

  function extractSkillsFromText(lines, sectionSkills) {
    const fromSection = String(sectionSkills || "").replace(/\n+/g, ", ").trim();
    const skillKeywords = [
      "Java", "Spring", "Spring Boot", "Maven", "Azure", "Docker", "Kubernetes", "CI/CD",
      "REST API", "MongoDB", "JPA", "Hibernate", "PostgreSQL", "MySQL", "GraphQL",
      "OAuth2", "JWT", "Spring Security", "Git", "GitHub", "Junit", "Mockito", "Redis"
    ];
    const found = [];
    const hay = lines.join(" ").toLowerCase();
    for (const kw of skillKeywords) {
      const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*")}\\b`, "i");
      if (re.test(hay)) found.push(kw);
    }
    const unique = [...new Set(found)];
    if (unique.length >= 5) return unique.join(", ");
    return fromSection;
  }

  function currentJobFromExperiences(exps) {
    if (!exps || !exps.length) return { currentTitle: "", currentCompany: "" };
    const first = exps[0];
    return {
      currentTitle: first.designation || "",
      currentCompany: first.employerName || ""
    };
  }

  function parseFilenameYears(filename) {
    const m = filename.match(/(\d+)\s*Yrs?/i);
    return m ? `${m[1]} years` : "";
  }

  function parseResumeText(rawText, filename) {
    const text = normalizeText(rawText);
    const lines = linesFromText(text);
    const bounds = findSectionBounds(lines);

    const email = extractEmail(text);
    const phone = extractPhone(text);
    const urls = extractUrls(text);

    const skipForName = new Set();
    lines.forEach((L, i) => {
      if (L.includes(email) && email) skipForName.add(i);
      if (L.includes(phone) && phone) skipForName.add(i);
    });

    const nameGuess = guessName(lines, skipForName);
    const fullName = nameGuess ? nameGuess.line : "";
    const { firstName, lastName } = fullName ? splitName(fullName) : { firstName: "", lastName: "" };

    const summary = sliceSection(lines, bounds.summary);
    const skills = extractSkillsFromText(lines, sliceSection(lines, bounds.skills));
    const experienceBlock = sliceSection(lines, bounds.experience);
    const educationBlock = sliceSection(lines, bounds.education);
    const eduParsed = educationBlock ? parseEducationBlock(educationBlock) : { degree: "", major: "", university: "", graduationYear: "" };

    let experiences = parseExperienceSection(experienceBlock);
    if (!experiences.length && experienceBlock) {
      experiences = [
        {
          ...makeEmptyExp(),
          responsibilities: experienceBlock.slice(0, 4000)
        }
      ];
    }

    const { currentTitle, currentCompany } = currentJobFromExperiences(experiences);
    let yearsExperience = extractYearsExperience(text);
    if (!yearsExperience && filename) {
      const fromFn = parseFilenameYears(filename);
      if (fromFn) yearsExperience = fromFn;
    }

    return {
      firstName,
      lastName,
      email,
      phone,
      address: "",
      city: "",
      state: "",
      zip: "",
      country: "",
      currentTitle,
      currentCompany,
      yearsExperience,
      nationalIdentifier: "",
      expectedSalary: "",
      noticePeriod: "",
      skills,
      summary,
      degree: eduParsed.degree,
      major: eduParsed.major,
      university: eduParsed.university,
      graduationYear: eduParsed.graduationYear,
      gpa: "",
      linkedin: urls.linkedin,
      github: urls.github,
      portfolio: urls.portfolio,
      experiences,
      suggestedProfileName: fullName || `${firstName} ${lastName}`.trim()
    };
  }

  async function extractTextFromFile(file) {
    const name = (file && file.name) || "";
    const low = name.toLowerCase();
    const ab = await readFileAsArrayBuffer(file);

    if (low.endsWith(".pdf") || (file.type && file.type === "application/pdf")) {
      return extractPdfText(ab);
    }
    if (
      low.endsWith(".docx") ||
      (file.type && file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    ) {
      return extractDocxText(ab);
    }

    throw new Error("Please use a .pdf or .docx file.");
  }

  global.ResumeParser = {
    extractTextFromFile,
    parseResumeText,
    normalizeText
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
