export const INSTITUTES = [
  { key: "owis-riyadh", segment: "K12", label: "One World International School Riyadh", domain: "@owis.org" },
  { key: "sek", segment: "K12", label: "SEK International School", domain: "@sek.sa" },
  { key: "riyadh-schools-malqa", segment: "K12", label: "Riyadh Schools Al-Malqa Branch", domain: "@rsm.edu.sa" },
  { key: "riyadh-schools-hittin", segment: "K12", label: "Riyadh Schools Hittin Branch", domain: "@rsh.edu.sa" },
  {
    key: "bisr",
    segment: "K12",
    label: "British International School Riyadh",
    domain: "@bisr.com.sa",
    allowedBundleCollections: ["all-bundles"],
  },
  { key: "bisj", segment: "K12", label: "British International School Jeddah", domain: "@conti.sch.sa" },
  { key: "aisr", segment: "K12", label: "American International School Riyadh", domain: "@aisr.org" },
  { key: "aldenham", segment: "K12", label: "Aldenham Prep School", domain: "@aldenham.org" },
  { key: "king-faisal-school", segment: "K12", label: "King Faisal School", domain: "@kfs.sc" },
  { key: "brooke-house", segment: "K12", label: "Brooke House College", domain: "@bhc-riyadh.com" },
  {
    key: "maildrop-test",
    segment: "Testing",
    label: "Maildrop Test School",
    domain: "@maildrop.cc",
    allowedBundleCollections: ["all-bundles"],
  },
  { key: "pnu", segment: "Hi-Edu / Uni", label: "Princess Nourah Bint Abdulrahman University", domain: "@pnu.edu.sa" },
  { key: "alfaisal", segment: "Hi-Edu / Uni", label: "AlFaisal University", domain: "@alfaisal.edu" },
  { key: "imamu", segment: "Hi-Edu / Uni", label: "Imam Mohammad Ibn Saud Islamic University", domain: "@imamu.edu.sa" },
  { key: "kau", segment: "Hi-Edu / Uni", label: "King AbdulAziz University", domain: "@kau.edu.sa" },
  { key: "aou", segment: "Hi-Edu / Uni", label: "Arab Open University", domain: "@aou.edu.sa" },
  { key: "kaust", segment: "Hi-Edu / Uni", label: "King Abdullah University of Science and Technology", domain: "@kaust.edu.sa" },
  { key: "mu", segment: "Hi-Edu / Uni", label: "Majmaa University", domain: "@mu.edu.sa" },
  { key: "ksu", segment: "Hi-Edu / Uni", label: "King Saud University", domain: "@ksu.edu.sa" },
  { key: "kfupm", segment: "Hi-Edu / Uni", label: "King Fahd University of Petroleum and Minerals", domain: "@kfupm.edu.sa" },
  {
    key: "kfu",
    segment: "Hi-Edu / Uni",
    label: "King Faisal University",
    domain: "@kfu.edu.sa",
    allowedBundleCollections: ["all-bundles"],
  },
];

const INSTITUTE_BY_KEY = new Map(INSTITUTES.map((institute) => [institute.key, institute]));
const INSTITUTE_BY_LABEL = new Map(INSTITUTES.map((institute) => [institute.label.toLowerCase(), institute]));
const INSTITUTE_BY_DOMAIN = new Map(INSTITUTES.map((institute) => [institute.domain, institute]));
const DEFAULT_CUSTOMER_TAGS = ["student_portal"];

export function getInstituteByKey(key) {
  return INSTITUTE_BY_KEY.get(String(key || "").trim()) || null;
}

export function buildInstituteEmail(instituteKey, emailLocalPart) {
  const institute = getInstituteByKey(instituteKey);
  const localPart = String(emailLocalPart || "").trim().toLowerCase();
  if (!institute || !localPart) return "";
  return `${localPart}${institute.domain}`;
}

export function normalizeEmailLocalPart(value) {
  const localPart = String(value || "").trim().toLowerCase();
  if (!localPart) return "";
  if (/^[a-z0-9._%+-]+$/.test(localPart)) return localPart;
  return null;
}

export function getInstituteByLabel(label) {
  return INSTITUTE_BY_LABEL.get(String(label || "").trim().toLowerCase()) || null;
}

export function getInstituteByEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const domain = normalizedEmail.includes("@") ? `@${normalizedEmail.split("@")[1]}` : "";
  return INSTITUTE_BY_DOMAIN.get(domain) || null;
}

export function buildInstituteOptions() {
  return INSTITUTES.reduce((groups, institute) => {
    if (!groups[institute.segment]) groups[institute.segment] = [];
    groups[institute.segment].push(institute);
    return groups;
  }, {});
}

export function getInstituteBundleCollections(instituteKey) {
  const institute = getInstituteByKey(instituteKey);
  return Array.isArray(institute?.allowedBundleCollections) ? institute.allowedBundleCollections : [];
}

export function getInstituteCustomerTags(instituteKey) {
  const institute = getInstituteByKey(instituteKey);
  const tags = new Set(DEFAULT_CUSTOMER_TAGS);
  if (institute?.key) tags.add(`institute_${institute.key}`);
  for (const collectionHandle of getInstituteBundleCollections(instituteKey)) {
    tags.add(`bundle_access_${collectionHandle}`);
  }
  return Array.from(tags);
}

export function canAccessBundleCollectionForEmail(email, collectionHandle = "all-bundles") {
  const institute = getInstituteByEmail(email);
  return Boolean(institute?.allowedBundleCollections?.includes(collectionHandle));
}

export function getBundleCollectionAccessForEmail(email, collectionHandle = "all-bundles") {
  const institute = getInstituteByEmail(email);
  return {
    allowed: Boolean(institute?.allowedBundleCollections?.includes(collectionHandle)),
    instituteKey: institute?.key || "",
    instituteLabel: institute?.label || "",
    instituteDomain: institute?.domain || "",
    collectionHandle,
  };
}
