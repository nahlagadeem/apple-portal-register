const ROLE_VALUES = new Set(["student", "teacher", "parent", "other"]);

export function normalizeRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return ROLE_VALUES.has(role) ? role : "";
}

export function normalizeSaudiPhone(value) {
  const raw = String(value || "").trim().replace(/\s+/g, "");
  if (!raw) return "";

  if (/^05\d{8}$/.test(raw)) {
    return `+966${raw.slice(1)}`;
  }

  if (/^\+9665\d{8}$/.test(raw)) {
    return raw;
  }

  return null;
}

export function validateProfileInput(input) {
  const fullName = String(input.fullName || "").trim();
  const instituteName = String(input.instituteName || "").trim();
  const role = normalizeRole(input.role);
  const roleOther = String(input.roleOther || "").trim();
  const normalizedPhone = normalizeSaudiPhone(input.phoneSa);

  const errors = {
    fullName: fullName ? "" : "Full name is required.",
    instituteName: instituteName ? "" : "Institute name is required.",
    role: role ? "" : "Role is required.",
    roleOther: "",
    phoneSa: "",
  };

  if (role === "other" && !roleOther) {
    errors.roleOther = "Please specify your role.";
  }

  if (normalizedPhone === null) {
    errors.phoneSa = "Enter a valid Saudi phone number.";
  }

  const hasErrors = Object.values(errors).some(Boolean);
  return {
    hasErrors,
    errors,
    normalized: {
      fullName,
      instituteName,
      role,
      roleOther: role === "other" ? roleOther : "",
      phoneSa: normalizedPhone || "",
    },
  };
}
