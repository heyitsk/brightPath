import { prisma } from "../../src/lib/prisma";

// Starting reference data (plan §8 Phase 2). Inserts only what is missing: rows that exist
// (matched by slug or code) are left exactly as staff last edited them, so re-running the
// seed is always safe.

type StateSeed = { name: string; code: string; aliases?: string[] };

// 28 states + 8 union territories; codes follow ISO 3166-2:IN.
const STATES: StateSeed[] = [
  { name: "Andhra Pradesh", code: "AP", aliases: ["ap"] },
  { name: "Arunachal Pradesh", code: "AR" },
  { name: "Assam", code: "AS" },
  { name: "Bihar", code: "BR" },
  { name: "Chhattisgarh", code: "CG", aliases: ["chattisgarh"] },
  { name: "Goa", code: "GA" },
  { name: "Gujarat", code: "GJ" },
  { name: "Haryana", code: "HR" },
  { name: "Himachal Pradesh", code: "HP", aliases: ["hp"] },
  { name: "Jharkhand", code: "JH" },
  { name: "Karnataka", code: "KA" },
  { name: "Kerala", code: "KL" },
  { name: "Madhya Pradesh", code: "MP", aliases: ["mp"] },
  { name: "Maharashtra", code: "MH", aliases: ["mh"] },
  { name: "Manipur", code: "MN" },
  { name: "Meghalaya", code: "ML" },
  { name: "Mizoram", code: "MZ" },
  { name: "Nagaland", code: "NL" },
  { name: "Odisha", code: "OD", aliases: ["orissa"] },
  { name: "Punjab", code: "PB" },
  { name: "Rajasthan", code: "RJ", aliases: ["raj"] },
  { name: "Sikkim", code: "SK" },
  { name: "Tamil Nadu", code: "TN", aliases: ["tn", "tamilnadu"] },
  { name: "Telangana", code: "TS" },
  { name: "Tripura", code: "TR" },
  { name: "Uttar Pradesh", code: "UP", aliases: ["up"] },
  { name: "Uttarakhand", code: "UK", aliases: ["uttaranchal"] },
  { name: "West Bengal", code: "WB", aliases: ["wb", "bengal"] },
  { name: "Andaman and Nicobar Islands", code: "AN" },
  { name: "Chandigarh", code: "CH" },
  { name: "Dadra and Nagar Haveli and Daman and Diu", code: "DH" },
  { name: "Delhi", code: "DL", aliases: ["new delhi", "ncr"] },
  { name: "Jammu and Kashmir", code: "JK", aliases: ["j&k"] },
  { name: "Ladakh", code: "LA" },
  { name: "Lakshadweep", code: "LD" },
  { name: "Puducherry", code: "PY", aliases: ["pondicherry"] },
];

/** The eight states the first release starts with, in menu order (PDF scope). */
const LIVE_STATE_CODES = ["UP", "MH", "RJ", "BR", "MP", "KA", "TN", "KL"];

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

type CountrySeed = { name: string; isoCode: string; live: boolean; nearIndia?: boolean; aliases?: string[] };

// First five are LIVE, the rest COMING_SOON (PDF scope). `nearIndia` is true only for land
// neighbours; staff can change it. Flight times are left empty on purpose: a fact needs a
// checked source before it is shown (PDF §5).
const COUNTRIES: CountrySeed[] = [
  { name: "Russia", isoCode: "RU", live: true, aliases: ["russian federation"] },
  { name: "Kazakhstan", isoCode: "KZ", live: true, aliases: ["kazakh"] },
  { name: "Kyrgyzstan", isoCode: "KG", live: true, aliases: ["kyrgyz", "kyrgyz republic", "kirghizia"] },
  { name: "Uzbekistan", isoCode: "UZ", live: true, aliases: ["uzbek"] },
  { name: "Georgia", isoCode: "GE", live: true },
  { name: "Philippines", isoCode: "PH", live: false, aliases: ["philippine", "the philippines"] },
  { name: "Nepal", isoCode: "NP", live: false, nearIndia: true },
  { name: "Bangladesh", isoCode: "BD", live: false, nearIndia: true },
];

export async function seedReferenceData() {
  const states = await prisma.state.createMany({
    skipDuplicates: true,
    data: STATES.map((s) => {
      const liveIdx = LIVE_STATE_CODES.indexOf(s.code);
      return {
        slug: slugify(s.name),
        name: s.name,
        code: s.code,
        isLive: liveIdx >= 0,
        sortOrder: liveIdx >= 0 ? (liveIdx + 1) * 10 : 1000,
        aliases: s.aliases ?? [],
      };
    }),
  });
  const countries = await prisma.country.createMany({
    skipDuplicates: true,
    data: COUNTRIES.map((c, i) => ({
      slug: slugify(c.name),
      name: c.name,
      isoCode: c.isoCode,
      status: c.live ? ("LIVE" as const) : ("COMING_SOON" as const),
      nearIndia: c.nearIndia ?? false,
      sortOrder: (i + 1) * 10,
      aliases: c.aliases ?? [],
    })),
  });
  return { statesInserted: states.count, countriesInserted: countries.count };
}
