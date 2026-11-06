// Legal / disclaimer texts, versioned in the database (staff can edit; every edit is a new
// version). These are the version-1 fallbacks so the site always has the required wording even
// on an empty database. "Not guaranteed" text is quoted from the project brief (PDF §4).

export interface DisclaimerDef {
  key: string;
  description: string;
  text: string;
}

export const DISCLAIMER_DEFS: DisclaimerDef[] = [
  {
    key: "NOT_GUARANTEED",
    description: "Shown with every rank, college match, fee and closing rank.",
    text:
      "This is an estimate based on past official NEET data and published college information. Actual rank, cut-offs, fees and admission can differ. " +
      "We do not guarantee rank or admission. Please confirm with the official counselling authority and the college.",
  },
  {
    key: "FOREIGN_COLLEGES_NMC",
    description: "Footer note explaining how NMC and WDOMS are used for colleges abroad.",
    text:
      "Foreign medical colleges are not approved by NMC. For colleges abroad we show their World Directory of Medical Schools listing, " +
      "whether the course meets NMC's 2021 rules for foreign medical graduates, and any NMC alert.",
  },
  {
    key: "ENQUIRY_CONSENT",
    description: "Consent checkbox text on the enquiry form. `{brandName}` is replaced by the frontend with the brand name.",
    text: "I agree that {brandName} can call or WhatsApp me about admission.",
  },
];

export const DISCLAIMER_DEFS_BY_KEY = new Map(DISCLAIMER_DEFS.map((d) => [d.key, d]));
