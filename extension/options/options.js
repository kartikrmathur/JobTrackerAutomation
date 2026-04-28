const PROFILE_FIELDS = [
  "firstName", "lastName", "email", "phone",
  "address", "city", "state", "zip", "country",
  "currentTitle", "currentCompany", "yearsExperience",
  "nationalIdentifier",
  "expectedSalary", "noticePeriod", "skills", "summary",
  "degree", "major", "university", "graduationYear", "gpa",
  "linkedin", "github", "portfolio"
];

let profiles = [];
let activeProfileId = null;

const profilesListEl = document.getElementById("profilesList");
const profileFormEl = document.getElementById("profileForm");
const statusEl = document.getElementById("optionsStatus");
const profileNameEl = document.getElementById("profileName");
const deleteProfileBtnEl = document.getElementById("deleteProfileBtn");
const newProfileBtnEl = document.getElementById("newProfileBtn");
const addExperienceBtnEl = document.getElementById("addExperienceBtn");
const experiencesListEl = document.getElementById("experiencesList");

function setStatus(message) {
  statusEl.textContent = message;
}

function makeEmptyData() {
  const data = {};
  for (const key of PROFILE_FIELDS) data[key] = "";
  data.experiences = [];
  return data;
}

function makeEmptyExperience() {
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

function normalizeExperiences(experiences) {
  if (!Array.isArray(experiences)) return [];
  return experiences.map((entry) => ({
    ...makeEmptyExperience(),
    ...(entry || {})
  }));
}

function renderExperiences(experiences) {
  experiencesListEl.textContent = "";
  const list = normalizeExperiences(experiences);
  if (list.length === 0) {
    list.push(makeEmptyExperience());
  }

  list.forEach((exp, index) => {
    const card = document.createElement("div");
    card.className = "exp-card";
    card.innerHTML = `
      <div class="exp-title">Experience ${index + 1}</div>
      <div><label>Employer Name</label><input data-exp-index="${index}" data-exp-key="employerName" value="${exp.employerName || ""}"></div>
      <div><label>Designation</label><input data-exp-index="${index}" data-exp-key="designation" value="${exp.designation || ""}"></div>
      <div><label>Start Month</label><input data-exp-index="${index}" data-exp-key="startMonth" value="${exp.startMonth || ""}"></div>
      <div><label>Start Year</label><input data-exp-index="${index}" data-exp-key="startYear" value="${exp.startYear || ""}"></div>
      <div><label>End Month</label><input data-exp-index="${index}" data-exp-key="endMonth" value="${exp.endMonth || ""}"></div>
      <div><label>End Year</label><input data-exp-index="${index}" data-exp-key="endYear" value="${exp.endYear || ""}"></div>
      <div class="full"><label>Responsibilities</label><textarea data-exp-index="${index}" data-exp-key="responsibilities">${exp.responsibilities || ""}</textarea></div>
      <button class="btn exp-remove" data-remove-exp="${index}" type="button">Remove Experience ${index + 1}</button>
    `;
    experiencesListEl.appendChild(card);
  });
}

function readExperiencesFromUI() {
  const map = new Map();
  const fields = experiencesListEl.querySelectorAll("[data-exp-index][data-exp-key]");
  fields.forEach((field) => {
    const index = Number(field.getAttribute("data-exp-index"));
    const key = field.getAttribute("data-exp-key");
    if (!map.has(index)) map.set(index, makeEmptyExperience());
    map.get(index)[key] = String(field.value || "").trim();
  });
  return Array.from(map.values()).filter((entry) =>
    Object.values(entry).some((value) => String(value || "").trim() !== "")
  );
}

function makeNewProfile() {
  return {
    id: `profile_${Date.now()}`,
    name: "New Job Profile",
    data: makeEmptyData()
  };
}

function getActiveProfile() {
  return profiles.find((profile) => profile.id === activeProfileId) || null;
}

function readFormData() {
  const data = {};
  for (const key of PROFILE_FIELDS) {
    data[key] = document.getElementById(key).value.trim();
  }
  data.experiences = readExperiencesFromUI();
  return data;
}

function writeFormData(profile) {
  const safeData = profile?.data || makeEmptyData();
  profileNameEl.value = profile?.name || "";
  for (const key of PROFILE_FIELDS) {
    document.getElementById(key).value = safeData[key] || "";
  }
  renderExperiences(safeData.experiences);
}

function renderProfilesList() {
  profilesListEl.textContent = "";
  for (const profile of profiles) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `profile-item${profile.id === activeProfileId ? " active" : ""}`;
    button.textContent = profile.name || "Untitled Profile";
    button.addEventListener("click", () => {
      activeProfileId = profile.id;
      writeFormData(getActiveProfile());
      renderProfilesList();
      updateDeleteButton();
    });
    profilesListEl.appendChild(button);
  }
}

function updateDeleteButton() {
  deleteProfileBtnEl.disabled = !activeProfileId;
}

function persistProfiles(onDone) {
  chrome.storage.local.set(
    { profiles, activeProfileId: activeProfileId || "" },
    () => {
      onDone?.();
    }
  );
}

function ensureActiveProfile() {
  if (profiles.length === 0) {
    const profile = makeNewProfile();
    profiles = [profile];
    activeProfileId = profile.id;
    return;
  }

  if (!profiles.some((profile) => profile.id === activeProfileId)) {
    activeProfileId = profiles[0].id;
  }
}

function loadProfiles() {
  chrome.storage.local.get(
    { profiles: [], activeProfileId: "" },
    (result) => {
      profiles = Array.isArray(result.profiles) ? result.profiles : [];
      profiles = profiles.map((profile) => ({
        ...profile,
        data: {
          ...makeEmptyData(),
          ...(profile.data || {}),
          experiences: normalizeExperiences(profile.data?.experiences)
        }
      }));
      activeProfileId = result.activeProfileId || "";
      ensureActiveProfile();
      persistProfiles(() => {
        renderProfilesList();
        writeFormData(getActiveProfile());
        updateDeleteButton();
        setStatus(`Loaded ${profiles.length} profile${profiles.length > 1 ? "s" : ""}.`);
      });
    }
  );
}

newProfileBtnEl.addEventListener("click", () => {
  const profile = makeNewProfile();
  profiles.unshift(profile);
  activeProfileId = profile.id;
  renderProfilesList();
  writeFormData(profile);
  updateDeleteButton();
  setStatus("New profile created. Fill details and save.");
});

addExperienceBtnEl.addEventListener("click", () => {
  const profile = getActiveProfile();
  if (!profile) return;
  const current = readExperiencesFromUI();
  current.push(makeEmptyExperience());
  renderExperiences(current);
});

experiencesListEl.addEventListener("click", (event) => {
  const removeIndexRaw = event.target?.getAttribute?.("data-remove-exp");
  if (removeIndexRaw == null) return;
  const removeIndex = Number(removeIndexRaw);
  const current = readExperiencesFromUI();
  const updated = current.filter((_, idx) => idx !== removeIndex);
  renderExperiences(updated);
});

deleteProfileBtnEl.addEventListener("click", () => {
  if (!activeProfileId) return;

  const profile = getActiveProfile();
  if (!profile) return;

  const confirmed = confirm(`Delete profile "${profile.name}"?`);
  if (!confirmed) return;

  profiles = profiles.filter((item) => item.id !== activeProfileId);
  if (profiles.length === 0) {
    const fallback = makeNewProfile();
    profiles = [fallback];
    activeProfileId = fallback.id;
  } else {
    activeProfileId = profiles[0].id;
  }

  persistProfiles(() => {
    renderProfilesList();
    writeFormData(getActiveProfile());
    updateDeleteButton();
    setStatus("Profile deleted.");
  });
});

profileFormEl.addEventListener("submit", (event) => {
  event.preventDefault();

  const profile = getActiveProfile();
  if (!profile) {
    return;
  }

  profile.name = profileNameEl.value.trim() || "Untitled Profile";
  profile.data = readFormData();

  persistProfiles(() => {
    renderProfilesList();
    setStatus(`Saved profile "${profile.name}".`);
  });
});

profileFormEl.addEventListener("invalid", (event) => {
  void event;
}, true);

loadProfiles();
