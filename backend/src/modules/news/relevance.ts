import type { NewsCategory } from "../../generated/prisma/client";

// Which fetched notices are worth a counsellor's time (plan §15.5 step 4, D-137): MBBS, UG-NEET and
// general counselling notices are kept; PG, AYUSH, nursing, other courses, recruitment and university
// housekeeping are filtered. Plain keyword rules on the title, no LLM.
//
// How it works. Every positive rule that matches adds its weight once. Every negative group that
// matches subtracts its penalty once (a title with "PG" three times is still one PG penalty), and a
// matching group is also a veto: however many counselling words a title has, "Round 2 counselling
// for BAMS" is not an MBBS notice. The one exception is a "UG anchor": a title that names MBBS or
// NEET UG explicitly (but not "post MBBS", which is a PG course) is not vetoed by the course-type
// groups (PG, AYUSH, nursing, other courses), because notices such as "NEET UG counselling for MBBS,
// BDS and BAMS" must stay visible; they only lose a small amount. Recruitment, tenders, housing and
// university exams are never excused.
// A notice goes to the review queue when it is not vetoed and its score reaches the threshold
// (setting `news.relevanceThreshold`, default 3); otherwise to the Filtered tab, where staff can
// still see it and why.
// These are starting rules, tuned from real misses: see `bun run news:rescore`.

/** ASCII keywords must not sit inside a longer word ("ms" in "forms"); other scripts have no such boundary. */
const word = (src: string) => new RegExp(`(?<![a-z0-9])(?:${src})(?![a-z0-9])`, "i");
const raw = (src: string) => new RegExp(src, "i");

interface Positive {
  id: string;
  weight: number;
  pattern: RegExp;
}
interface NegativeGroup {
  id: string;
  penalty: number;
  /** Reduced to `SOFT_PENALTY` when the title names MBBS or NEET UG. */
  softenable: boolean;
  pattern: RegExp;
}

export const SOFT_PENALTY = 3;
export const DEFAULT_THRESHOLD = 3;

const POSITIVES: Positive[] = [
  { id: "mbbs", weight: 5, pattern: word("mbbs") },
  { id: "neet-ug", weight: 5, pattern: word("neet[\\s_.-]*\\(?\\s*ug\\)?|ug[\\s_.-]*neet|neet[\\s_.-]*\\(?\\s*undergraduate") },
  { id: "ug-codes", weight: 4, pattern: word("ugmac|ugdac") },
  { id: "neet", weight: 2, pattern: word("neet") },
  { id: "bds", weight: 2, pattern: word("bds|b\\.\\s?d\\.\\s?s") },
  { id: "ug", weight: 2, pattern: word("undergraduate|ug") },
  { id: "counselling", weight: 3, pattern: word("counsell?ing|couselling|councell?ing|counciling") },
  { id: "admission", weight: 3, pattern: word("admissions?") },
  { id: "allotment", weight: 3, pattern: word("allot(?:ment|ments|ted|tees?)?") },
  { id: "seat-matrix", weight: 3, pattern: word("seat[\\s_-]*(?:matrix|matrices|position|intake|distribution|availability|vacanc\\w+)|vacant[\\s_-]*seats?|intake") },
  { id: "merit-list", weight: 3, pattern: word("merit[\\s_-]*(?:list|rank)|rank[\\s_-]*list|provisional[\\s_-]*(?:list|merit)|final[\\s_-]*(?:list|merit)|selection[\\s_-]*list") },
  { id: "choice-filling", weight: 3, pattern: word("choice[\\s_-]*(?:filling|locking|lock)|option[\\s_-]*(?:entry|form|exercise)|web[\\s_-]*options?") },
  { id: "stray-round", weight: 3, pattern: word("stray|mop[\\s_-]*up|spot[\\s_-]*round|special[\\s_-]*round|vacancy[\\s_-]*round") },
  { id: "registration", weight: 2, pattern: word("registration") },
  { id: "round", weight: 2, pattern: word("round|[0-9]+(?:st|nd|rd|th)[\\s_-]*round") },
  { id: "schedule", weight: 2, pattern: word("schedule|calendar|timeline|last[\\s_-]*date") },
  { id: "fee-structure", weight: 3, pattern: word("fee[\\s_-]*(?:structure|regulation|fixation|details)|tuition") },
  { id: "fee", weight: 1, pattern: word("fees?|stipend") },
  { id: "quota", weight: 2, pattern: word("state[\\s_-]*quota|all[\\s_-]*india[\\s_-]*quota|aiq|management[\\s_-]*quota|nri[\\s_-]*quota|domicile|reservation|eligibility|cut[\\s_-]*off|cutoff") },
  { id: "prospectus", weight: 2, pattern: word("prospectus|information[\\s_-]*bulletin|brochure|guidelines?|instructions?") },
  { id: "result", weight: 2, pattern: word("results?|score[\\s_-]*card|answer[\\s_-]*key") },
  { id: "foreign-graduates", weight: 3, pattern: word("fmge|fmgs?|foreign[\\s_-]*medical|overseas|wdoms|next") },
  { id: "advisory", weight: 3, pattern: word("advisory[\\s_-]*(?:to|for)[\\s_-]*(?:students|candidates|parents|aspirants)|public[\\s_-]*advisory|fake|fraud|caution|beware|misleading|unauthori[sz]ed") },
  { id: "authority", weight: 1, pattern: word("nmc|national[\\s_-]*medical[\\s_-]*commission|mcc|medical[\\s_-]*counselling[\\s_-]*committee|dghs|nta") },
  // Hindi, Marathi and Tamil starting lists. Enough to keep the obvious ones; extended from real misses.
  { id: "hindi-marathi", weight: 3, pattern: raw("काउंसलिंग|काउन्सलिंग|समुपदेशन|एमबीबीएस|नीट|आवंटन|मेरिट सूची|गुणवत्ता यादी|पंजीकरण|नोंदणी") },
  { id: "hindi-marathi-admission", weight: 2, pattern: raw("प्रवेश") },
  { id: "tamil", weight: 3, pattern: raw("கலந்தாய்வு|மருத்துவ|எம்பிபிஎஸ்|இடஒதுக்கீடு|தரவரிசை|நீட்") },
];

const NEGATIVES: NegativeGroup[] = [
  {
    id: "pg",
    penalty: 10,
    softenable: true,
    pattern: raw(
      `(?<![a-z0-9])(?:post[\\s_-]*mbbs|pg|p\\.g\\.?|post[\\s_-]*gradua?d?ate|md|ms|mds|dnb|dm|m\\.?ch|neet[\\s_-]*(?:pg|mds)|pgmac|pgdac|pgmc|inicet|ini[\\s_-]*cet|super[\\s_-]*speciality|diploma|fellowship|ph\\.?d|doctoral|(?:senior|junior)[\\s_-]*resident)(?![a-z0-9])|स्नातकोत्तर|पीजी`,
    ),
  },
  { id: "ayush", penalty: 10, softenable: true, pattern: word("bams|bhms|bums|bnys|ayush|ayurved\\w*|homoe?o\\w*|unani|siddha|naturopath\\w*|yoga|b\\.\\s?a\\.\\s?m\\.\\s?s|b\\.\\s?h\\.\\s?m\\.\\s?s|aiapget|aiapg") },
  {
    id: "nursing-allied",
    penalty: 10,
    softenable: true,
    pattern: raw(`(?<![a-z0-9])(?:nursing|nurses?|gnm|anm|midwif\\w*|paramedical|para[\\s_-]*medical|physiotherap\\w*|bpt|mpt|b\\.?\\s?pharm\\w*|d\\.?\\s?pharm\\w*|pharmac\\w*|allied|cho|mlhp|community[\\s_-]*health[\\s_-]*officers?|asha|mlt|medical[\\s_-]*laboratory|optometr\\w*|radiograph\\w*|dialysis|dietetic\\w*|nutrition)(?![a-z0-9])|नर्सिंग|नर्स|पैरामेडिकल|फिजियोथेरेपी|एलाइड|एलाईड|ए०एन०एम|जी०एन०एम|एएनएम|जीएनएम`),
  },
  { id: "other-courses", penalty: 8, softenable: true, pattern: raw(`(?<![a-z0-9])(?:pgeac|ugeac|m\\.?\\s?tech|b\\.?\\s?tech|engg|engineering|polytechnic|ll\\.?\\s?b|b\\.?\\s?ed|mba|mca|b\\.?\\s?arch|agricultur\\w*|veterinar\\w*|jee|keam|mht[\\s_-]*cet|b\\.?\\s?sc|m\\.?\\s?sc|b\\.?\\s?com)(?![a-z0-9])|अभियंत्रण|इंजीनियरिंग`) },
  {
    id: "recruitment-admin",
    penalty: 10,
    softenable: false,
    pattern: raw(`(?<![a-z0-9])(?:recruit\\w*|vacant[\\s_-]*posts?|posts?[\\s_-]*of|walk[\\s_-]*in|interview|tenders?|e[\\s_-]*auction|auction|quotation|empanel\\w*|outsourc\\w*|contractual|deputation|seniority|gradation|appointment[\\s_-]*of|data[\\s_-]*entry|attendant|driver|rti|holiday|covid\\S*|vaccin\\w*|scholarships?|reimbursement|pension|salary|transfer[\\s_-]*(?:order|list)|posting|promotion|rajya[\\s_-]*sabha|lok[\\s_-]*sabha|parliament\\w*|animal\\w*|cruelty|tobacco|gazette|quarters|houses?|housing|canteen|parking|system[\\s_-]*administrator|computer[\\s_-]*operator|stenographer|typist|(?:junior|senior)[\\s_-]*assistant|lab(?:oratory)?[\\s_-]*technician|erp|expression[\\s_-]*of[\\s_-]*interest|eoi)(?![a-z0-9])|भर्ती|संविदा|निविदा|नामांकन|सदस्यों`),
  },
  {
    id: "university-exams",
    penalty: 6,
    softenable: false,
    pattern: word("semester|supplementary|datesheet|date[\\s_-]*sheet|re[\\s_-]*totaling|retotaling|revaluation|annual[\\s_-]*exam\\w*|admit[\\s_-]*card|hall[\\s_-]*ticket|convocation|degree[\\s_-]*distribution|syllabus|time[\\s_-]*table|(?:first|second|third|final)[\\s_-]*(?:professional|prof)|professional[\\s_-]*(?:part|exam\\w*)|mcq|objection[\\s_-]*link|internal[\\s_-]*assessment"),
  },
];

const UG_ANCHOR = POSITIVES.filter((p) => ["mbbs", "neet-ug"].includes(p.id));

// ---- category (what the notice is about; first match wins) ---------------------------------------------

const CATEGORY_RULES: Array<[NewsCategory, RegExp]> = [
  ["SEAT_MATRIX", word("seat[\\s_-]*(?:matrix|matrices|position|intake|distribution|availability)|vacant[\\s_-]*seats?|intake")],
  ["MERIT_LIST", word("merit[\\s_-]*(?:list|rank)|rank[\\s_-]*list|provisional[\\s_-]*(?:list|merit)|final[\\s_-]*(?:list|merit)|selection[\\s_-]*list")],
  ["FEE", word("fees?|fee[\\s_-]*structure|tuition|stipend|refund")],
  ["SCHEDULE", word("schedule|calendar|timeline|last[\\s_-]*date|extension|extended|revised[\\s_-]*dates?")],
  ["REGISTRATION", word("registration|choice[\\s_-]*(?:filling|locking|lock)|option[\\s_-]*(?:entry|form|exercise)|web[\\s_-]*options?|apply|application")],
  ["RESULT", word("results?|allot(?:ment|ments|ted)?|cut[\\s_-]*off|cutoff|score[\\s_-]*card|answer[\\s_-]*key")],
  ["COUNSELLING", word("counsell?ing|couselling|councell?ing|round|mop[\\s_-]*up|stray|spot[\\s_-]*round|admission")],
];

// ---- the verdict -------------------------------------------------------------------------------------------------

export interface Relevance {
  score: number;
  category: NewsCategory;
  /** Rule ids that fired, `+mbbs` for a positive, `-pg` for a negative, `-pg(soft)` when softened by a UG anchor. */
  reasons: string[];
  /** Whether the notice goes to the review queue (true) or the Filtered tab (false). */
  relevant: boolean;
}

/** Titles written mostly in another script (Hindi, Marathi, Tamil) have few keywords we can recognise, so a missing keyword is not evidence of irrelevance. */
export function isMostlyNonLatin(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return false;
  const latin = letters.filter((c) => /[a-z]/i.test(c)).length;
  return latin / letters.length < 0.4;
}

export function classify(title: string, opts: { threshold?: number } = {}): Relevance {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const text = title.replace(/\s+/g, " ");
  const reasons: string[] = [];
  let score = 0;

  // "POST MBBS" (DNB and other PG courses) says MBBS but is not an MBBS admission.
  const anchored = UG_ANCHOR.some((p) => p.pattern.test(text)) && !/post[\s_-]*mbbs/i.test(text);
  for (const p of POSITIVES) {
    if (!p.pattern.test(text)) continue;
    score += p.weight;
    reasons.push(`+${p.id}`);
  }
  let negatives = 0;
  let vetoed = false;
  for (const g of NEGATIVES) {
    if (!g.pattern.test(text)) continue;
    const soft = anchored && g.softenable;
    score -= soft ? Math.min(SOFT_PENALTY, g.penalty) : g.penalty;
    reasons.push(soft ? `-${g.id}(soft)` : `-${g.id}`);
    negatives++;
    if (!soft) vetoed = true;
  }

  const nonLatin = isMostlyNonLatin(text);
  if (nonLatin) reasons.push("script:non-latin");
  const relevant = !vetoed && (score >= threshold || (nonLatin && negatives === 0));
  const category = CATEGORY_RULES.find(([, re]) => re.test(text))?.[0] ?? "OTHER";
  return { score, category, reasons: reasons.slice(0, 16), relevant };
}

/** Letters, digits and the marks that belong to letters (Hindi vowel signs, say) of a title, lower-cased and trimmed to 200 characters: the key two notices share when they say the same thing. */
export function titleKey(title: string): string {
  return title.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}\p{M}]+/gu, "").slice(0, 200);
}
