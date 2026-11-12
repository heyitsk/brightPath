import { describe, expect, test } from "bun:test";
import { checkReadiness, courseTotalInr, feeYearsRequired, lineTotalInr, lineTotalLocal, type ReadinessInput } from "../src/modules/college/college-readiness";

const day = new Date("2026-11-01");
const rates = new Map([["USD", 88.5], ["RUB", 0.95]]);

const fee = (yearNumber: number, over: Partial<ReadinessInput["fees"][number]> = {}) => ({ yearNumber, tuition: 5000, currency: "USD", hasSource: true, ...over });

function abroad(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    kind: "ABROAD", name: "Sample University", city: "Kazan", stateId: null, countryId: "c1", ownership: "GOVERNMENT",
    description: "A description.", courseLengthMonths: 72,
    india: null,
    abroad: { wdomsListed: "LISTED", wdomsCheckedAt: day, teachingLanguage: "English", intakeMonths: [9], nmcLengthOk: true, nmcEnglishOk: true, nmcInternshipOk: true, nmcCheckedAt: day },
    fees: [1, 2, 3, 4, 5, 6].map((y) => fee(y)),
    sourceLinkCount: 1,
    currenciesWithRate: new Set(["USD"]),
    ...over,
  };
}

function india(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    kind: "INDIA", name: "Sample Medical College", city: "Pune", stateId: "s1", countryId: null, ownership: "PRIVATE",
    description: "A description.", courseLengthMonths: 66,
    india: { nmcRecognised: true, nmcRecognitionCheckedAt: day, mbbsSeats: 150, hospitalName: "Sample Hospital" },
    abroad: null,
    fees: [1, 2, 3, 4, 5, 6].map((y) => fee(y, { currency: "INR" })),
    sourceLinkCount: 1,
    currenciesWithRate: new Set(),
    ...over,
  };
}

const paths = (i: ReadinessInput) => checkReadiness(i).map((m) => m.path);

describe("checkReadiness", () => {
  test("a fully filled abroad college and a fully filled India college have nothing missing", () => {
    expect(checkReadiness(abroad())).toEqual([]);
    expect(checkReadiness(india())).toEqual([]);
  });

  test("an empty draft lists everything that is needed, each with a path and a plain-words message", () => {
    const m = checkReadiness(abroad({ name: "", city: " ", ownership: null, description: null, courseLengthMonths: null, countryId: null, abroad: null, fees: [], sourceLinkCount: 0 }));
    expect(m.map((x) => x.path)).toEqual([
      "name", "city", "ownership", "description", "courseLengthMonths", "countryId",
      "abroad.wdomsListed", "abroad.wdomsCheckedAt", "abroad.teachingLanguage", "abroad.intakeMonths",
      "abroad.nmcLengthOk", "abroad.nmcEnglishOk", "abroad.nmcInternshipOk", "abroad.nmcCheckedAt", "sources", "fees",
    ]);
    for (const x of m) expect(x.message.length).toBeGreaterThan(10);
  });

  test("each abroad requirement is enforced on its own", () => {
    const a = abroad().abroad!;
    expect(paths(abroad({ abroad: { ...a, wdomsListed: "UNKNOWN" } }))).toEqual(["abroad.wdomsListed"]);
    expect(paths(abroad({ abroad: { ...a, wdomsListed: "NOT_LISTED" } }))).toEqual([]); // "not listed" is a valid, checked answer
    expect(paths(abroad({ abroad: { ...a, wdomsCheckedAt: null } }))).toEqual(["abroad.wdomsCheckedAt"]);
    expect(paths(abroad({ abroad: { ...a, teachingLanguage: "  " } }))).toEqual(["abroad.teachingLanguage"]);
    expect(paths(abroad({ abroad: { ...a, intakeMonths: [] } }))).toEqual(["abroad.intakeMonths"]);
    expect(paths(abroad({ abroad: { ...a, nmcEnglishOk: null } }))).toEqual(["abroad.nmcEnglishOk"]);
    expect(paths(abroad({ abroad: { ...a, nmcInternshipOk: false } }))).toEqual([]); // "does not meet" is still a checked answer
    expect(paths(abroad({ abroad: { ...a, nmcCheckedAt: null } }))).toEqual(["abroad.nmcCheckedAt"]);
  });

  test("each India requirement is enforced on its own", () => {
    const i = india().india!;
    expect(paths(india({ stateId: null }))).toEqual(["stateId"]);
    expect(paths(india({ india: { ...i, nmcRecognised: null } }))).toEqual(["india.nmcRecognised"]);
    expect(paths(india({ india: { ...i, nmcRecognised: false } }))).toEqual([]);
    expect(paths(india({ india: { ...i, nmcRecognitionCheckedAt: null } }))).toEqual(["india.nmcRecognitionCheckedAt"]);
    expect(paths(india({ india: { ...i, mbbsSeats: null } }))).toEqual(["india.mbbsSeats"]);
    expect(paths(india({ india: { ...i, hospitalName: "" } }))).toEqual(["india.hospitalName"]);
    expect(paths(india({ india: null }))).toEqual(["india.nmcRecognised", "india.nmcRecognitionCheckedAt", "india.mbbsSeats", "india.hospitalName"]);
  });

  test("fees: every course year is needed, and the message names the missing years", () => {
    const only = (...ys: number[]) => abroad({ fees: ys.map((y) => fee(y)) });
    expect(checkReadiness(only(1, 3, 5, 6))).toEqual([{ path: "fees", message: "Fees are missing for years 2 and 4 (the course has 6 years)." }]);
    expect(checkReadiness(only(1, 2, 3, 4, 5))[0]!.message).toBe("Fees are missing for year 6 (the course has 6 years).");
    expect(checkReadiness(only(2, 3, 4, 5, 6))[0]!.message).toBe("Fees are missing for year 1 (the course has 6 years).");
    expect(checkReadiness(only(1, 4, 6))[0]!.message).toBe("Fees are missing for years 2, 3 and 5 (the course has 6 years).");
    expect(checkReadiness(abroad({ fees: [] }))[0]!.message).toBe("Add the fees: one row for each of the 6 years of the course.");
  });

  test("fees beyond the course length are reported too", () => {
    const m = checkReadiness(abroad({ courseLengthMonths: 60, fees: [1, 2, 3, 4, 5, 6].map((y) => fee(y)) }));
    expect(m).toHaveLength(1);
    expect(m[0]!.message).toContain("fees for year 6, but the course is only 5 years long");
  });

  test("a course length that is not a whole number of years needs the extra started year", () => {
    expect(feeYearsRequired(66)).toBe(6);
    expect(feeYearsRequired(72)).toBe(6);
    expect(feeYearsRequired(60)).toBe(5);
    expect(feeYearsRequired(13)).toBe(2);
    expect(feeYearsRequired(null)).toBeNull();
    expect(feeYearsRequired(0)).toBeNull();
  });

  test("each fee row needs a source, and a non-INR row needs an exchange rate; INR never does", () => {
    const fees = [fee(1), fee(2, { hasSource: false }), fee(3), fee(4, { currency: "RUB" }), fee(5, { currency: "INR" }), fee(6)];
    expect(checkReadiness(abroad({ fees }))).toEqual([
      { path: "fees.2.sourceId", message: "Year 2 fees have no source. Choose where the figures come from." },
      { path: "fees.4.currency", message: "Year 4 fees are in RUB, but there is no RUB exchange rate yet. Add it on the Exchange rates page." },
    ]);
  });

  test("a college with no sources cannot go live even if everything else is filled", () => {
    expect(checkReadiness(abroad({ sourceLinkCount: 0 }))).toEqual([{ path: "sources", message: expect.stringContaining("at least one source") }]);
  });
});

describe("fee totals", () => {
  const line = (yearNumber: number, over = {}) => ({ yearNumber, tuition: 4000, hostel: 1000, other: 500.5, currency: "USD", ...over });
  const six = (over = {}) => [1, 2, 3, 4, 5, 6].map((y) => line(y, over));

  test("a row's total is tuition + hostel + other, kept to 2 decimals (no floating-point crumbs)", () => {
    expect(lineTotalLocal({ tuition: 0.1, hostel: 0.2, other: 0 })).toBe(0.3);
    expect(lineTotalLocal(line(1))).toBe(5500.5);
  });

  test("rupees = local total x rate, rounded to whole rupees; INR needs no rate", () => {
    expect(lineTotalInr(line(1), rates)).toBe(Math.round(5500.5 * 88.5));
    expect(lineTotalInr(line(1, { currency: "INR" }), new Map())).toBe(5501);
    expect(lineTotalInr(line(1, { currency: "EUR" }), rates)).toBeNull();
  });

  test("whole-course total sums every year", () => {
    expect(courseTotalInr(72, six(), rates)).toBe(6 * Math.round(5500.5 * 88.5));
    expect(courseTotalInr(72, six({ currency: "INR" }), new Map())).toBe(6 * 5501);
  });

  test("changing a rate changes the total (this is what the Exchange rates page relies on)", () => {
    const before = courseTotalInr(72, six(), new Map([["USD", 88.5]]));
    const after = courseTotalInr(72, six(), new Map([["USD", 90]]));
    expect(after! - before!).toBe(6 * (Math.round(5500.5 * 90) - Math.round(5500.5 * 88.5)));
  });

  test("the total is null whenever it could not be stated honestly", () => {
    expect(courseTotalInr(null, six(), rates)).toBeNull(); // unknown course length
    expect(courseTotalInr(72, six().slice(0, 5), rates)).toBeNull(); // a year is missing
    expect(courseTotalInr(72, [...six().slice(0, 5), line(7)], rates)).toBeNull(); // wrong year set
    expect(courseTotalInr(60, six(), rates)).toBeNull(); // a row beyond the course
    expect(courseTotalInr(72, [...six().slice(0, 5), line(6, { currency: "RUB" })], new Map([["USD", 88.5]]))).toBeNull(); // no rate for RUB
  });
});
