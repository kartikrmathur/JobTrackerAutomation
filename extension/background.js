const AUTOFILL_COMMAND = "trigger-autofill";

function buildEmptyProfileData() {
  return {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    country: "",
    currentTitle: "",
    currentCompany: "",
    yearsExperience: "",
    expectedSalary: "",
    noticePeriod: "",
    skills: "",
    summary: "",
    degree: "",
    major: "",
    university: "",
    graduationYear: "",
    gpa: "",
    linkedin: "",
    github: "",
    portfolio: ""
  };
}

async function getActiveProfile() {
  const { profiles = [], activeProfileId = "" } = await chrome.storage.local.get({
    profiles: [],
    activeProfileId: ""
  });

  if (!Array.isArray(profiles) || profiles.length === 0) {
    return null;
  }

  const selected = profiles.find((item) => item.id === activeProfileId) || profiles[0];
  return {
    id: selected.id,
    name: selected.name || "Untitled Profile",
    data: { ...buildEmptyProfileData(), ...(selected.data || {}) }
  };
}

async function sendAutofillToActiveTab() {
  const profile = await getActiveProfile();
  if (!profile) {
    return { ok: false, error: "no-profile" };
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];

  if (!tab?.id) {
    return { ok: false, error: "no-active-tab" };
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "AUTOFILL",
      profile
    });

    if (!response?.ok) {
      return { ok: false, error: "autofill-failed" };
    }

    return { ok: true, result: response.result };
  } catch (err) {
    return { ok: false, error: "content-script-unavailable" };
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== AUTOFILL_COMMAND) return;

  const result = await sendAutofillToActiveTab();
  await chrome.storage.local.set({
    lastShortcutAutofill: {
      ...result,
      at: Date.now()
    }
  });
});
