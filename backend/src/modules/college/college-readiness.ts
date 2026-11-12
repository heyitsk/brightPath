// The READY GATE (history.md D-087) and the fee totals. Pure functions: no database access, so they are easy to test
// and the same code answers "what is missing?" on the admin screen and "may this go live?" on the Mark ready button.
//
// A college goes live only when every item below is filled. Each problem has a `path` the admin screen can highlight
// and a plain-words `message` that says what to do.

export interface Missing {
  path: string;
  message: string;
}

export interface ReadinessInput {
  kind: "INDIA" | "ABROAD";
  name: string;
  city: string;
  stateId: string | null;
  countryId: string | null;
  ownership: string | null;
  description: string | null;
  courseLengthMonths: number | null;
  india: {
    nmcRecognised: boolean | null;
    nmcRecognitionCheckedAt: Date | null;
    mbbsSeats: number | null;
    hospitalName: string | null;
  } | null;
  abroad: {
    wdomsListed: "LISTED" | "NOT_LISTED" | "UNKNOWN";
    wdomsCheckedAt: Date | null;
    teachingLanguage: string | null;
    intakeMonths: number[];
    nmcLengthOk: boolean | null;
    nmcEnglishOk: boolean | null;
    nmcInternshipOk: boolean | null;
    nmcCheckedAt: Date | null;
  } | null;
  fees: Array<{ yearNumber: number; tuition: number; currency: string; hasSource: boolean }>;
  sourceLinkCount: number;
  /** Currencies that have an exchange rate on file (INR never needs one). */
  currenciesWithRate: ReadonlySet<string>;
}

/** Number of fee rows a course needs: one per started year. */
export const feeYearsRequired = (courseLengthMonths: number | null): number | null =>
  courseLengthMonths && courseLengthMonths > 0 ? Math.ceil(courseLengthMonths / 12) : null;

const blank = (v: string | null | undefined) => !v || !v.trim();

/** "year 2", "years 2 and 4", "years 2, 4 and 5". */
function years(list: number[]): string {
  const s = [...list].sort((a, b) => a - b).map(String);
  if (s.length === 1) return `year ${s[0]}`;
  return `years ${s.slice(0, -1).join(", ")} and ${s[s.length - 1]}`;
}

export function checkReadiness(c: ReadinessInput): Missing[] {
  const out: Missing[] = [];
  const need = (path: string, message: string) => out.push({ path, message });

  if (blank(c.name)) need("name", "Add the college name.");
  if (blank(c.city)) need("city", "Add the city.");
  if (!c.ownership) need("ownership", "Choose the ownership (government, private, deemed or trust).");
  if (blank(c.description)) need("description", "Write a short description in your own words.");
  if (!c.courseLengthMonths) need("courseLengthMonths", "Add the course length in months, so we know how many years of fees are needed.");

  if (c.kind === "INDIA") {
    if (!c.stateId) need("stateId", "Choose the state.");
    if (!c.india || c.india.nmcRecognised === null) need("india.nmcRecognised", "Say whether the college is recognised by NMC.");
    if (!c.india?.nmcRecognitionCheckedAt) need("india.nmcRecognitionCheckedAt", "Add the date you last checked NMC recognition.");
    if (c.india?.mbbsSeats == null) need("india.mbbsSeats", "Add the number of MBBS seats.");
    if (blank(c.india?.hospitalName)) need("india.hospitalName", "Add the name of the attached hospital.");
  } else {
    if (!c.countryId) need("countryId", "Choose the country.");
    const a = c.abroad;
    if (!a || a.wdomsListed === "UNKNOWN") need("abroad.wdomsListed", "Say whether the college is listed in WDOMS (listed or not listed).");
    if (!a?.wdomsCheckedAt) need("abroad.wdomsCheckedAt", "Add the date you last checked WDOMS.");
    if (blank(a?.teachingLanguage)) need("abroad.teachingLanguage", "Add the language of teaching.");
    if (!a || a.intakeMonths.length === 0) need("abroad.intakeMonths", "Add at least one intake month.");
    if (a?.nmcLengthOk == null) need("abroad.nmcLengthOk", "Answer whether the course length meets the NMC 2021 rule.");
    if (a?.nmcEnglishOk == null) need("abroad.nmcEnglishOk", "Answer whether teaching in English meets the NMC 2021 rule.");
    if (a?.nmcInternshipOk == null) need("abroad.nmcInternshipOk", "Answer whether the internship meets the NMC 2021 rule.");
    if (!a?.nmcCheckedAt) need("abroad.nmcCheckedAt", "Add the date you checked the NMC 2021 rules for this college.");
  }

  if (c.sourceLinkCount === 0) need("sources", "Add at least one source (an official page or notice) with the date you checked it.");

  // Fees: one row per course year, nothing missing, nothing beyond the course, every row sourced and convertible.
  const required = feeYearsRequired(c.courseLengthMonths);
  const have = new Set(c.fees.map((f) => f.yearNumber));
  if (c.fees.length === 0) {
    need("fees", required ? `Add the fees: one row for each of the ${required} years of the course.` : "Add the fees: one row for each year of the course.");
  } else if (required) {
    const missingYears = Array.from({ length: required }, (_, i) => i + 1).filter((y) => !have.has(y));
    if (missingYears.length) need("fees", `Fees are missing for ${years(missingYears)} (the course has ${required} years).`);
    const extra = c.fees.map((f) => f.yearNumber).filter((y) => y > required);
    if (extra.length) need("fees", `There are fees for ${years(extra)}, but the course is only ${required} years long. Remove them or change the course length.`);
  }
  for (const f of [...c.fees].sort((a, b) => a.yearNumber - b.yearNumber)) {
    if (!f.hasSource) need(`fees.${f.yearNumber}.sourceId`, `Year ${f.yearNumber} fees have no source. Choose where the figures come from.`);
    if (f.currency !== "INR" && !c.currenciesWithRate.has(f.currency)) {
      need(`fees.${f.yearNumber}.currency`, `Year ${f.yearNumber} fees are in ${f.currency}, but there is no ${f.currency} exchange rate yet. Add it on the Exchange rates page.`);
    }
  }
  return out;
}

export interface FeeLineAmounts {
  yearNumber: number;
  tuition: number;
  hostel: number;
  other: number;
  currency: string;
}

/** What one fee row costs in its own currency (tuition + hostel + other), kept to 2 decimals. */
export const lineTotalLocal = (f: Pick<FeeLineAmounts, "tuition" | "hostel" | "other">): number => Math.round((f.tuition + f.hostel + f.other) * 100) / 100;

/** Rupee value of one fee row at `rate` (rupees per unit of its currency; 1 for INR), or null if there is no rate. */
export const lineTotalInr = (f: FeeLineAmounts, rates: ReadonlyMap<string, number>): number | null => {
  const rate = f.currency === "INR" ? 1 : rates.get(f.currency);
  return rate === undefined ? null : Math.round(lineTotalLocal(f) * rate);
};

/**
 * Whole-course fee in rupees, or null when it cannot be stated honestly: the course length is unknown, a year has no fee row,
 * a row is beyond the course, or a currency has no exchange rate. (A partial total would wrongly pass a student's budget filter.)
 */
export function courseTotalInr(courseLengthMonths: number | null, fees: FeeLineAmounts[], rates: ReadonlyMap<string, number>): number | null {
  const required = feeYearsRequired(courseLengthMonths);
  if (!required || fees.length !== required) return null;
  const have = new Set(fees.map((f) => f.yearNumber));
  for (let y = 1; y <= required; y++) if (!have.has(y)) return null;
  let sum = 0;
  for (const f of fees) {
    const v = lineTotalInr(f, rates);
    if (v === null) return null;
    sum += v;
  }
  return sum;
}

/** "Meets NMC 2021 rules", worked out from the three answers: any "no" -> DOES_NOT_MEET; all "yes" -> MEETS; otherwise not yet known. */
export function nmc2021Status(p: { nmcLengthOk: boolean | null; nmcEnglishOk: boolean | null; nmcInternshipOk: boolean | null }): "MEETS" | "DOES_NOT_MEET" | "UNKNOWN" {
  const v = [p.nmcLengthOk, p.nmcEnglishOk, p.nmcInternshipOk];
  if (v.includes(false)) return "DOES_NOT_MEET";
  return v.every((x) => x === true) ? "MEETS" : "UNKNOWN";
}
