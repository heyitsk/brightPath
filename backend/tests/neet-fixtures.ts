// Small hand-checkable NEET data used by the NEET tests. NOT real NTA data.

/** Exact per-score counts, 100 students in total. Ranks worked out by hand in the tests. */
export const EXACT_CSV = `group,score_from,score_to,candidates
OVERALL,720,720,2
OVERALL,700,700,3
OVERALL,650,650,10
OVERALL,600,600,30
OVERALL,500,500,25
OVERALL,300,300,20
OVERALL,140,140,10
GENERAL,720,720,2
GENERAL,650,650,5
GENERAL,600,600,13
GENERAL,500,500,10
GENERAL,300,300,10
EWS,700,700,3
EWS,600,600,7
OBC,650,650,5
OBC,600,600,10
OBC,500,500,15
OBC,300,300,10
SC,140,140,10
PWD,600,600,2
PWD,250,250,1
`;

/** Mark-range counts, 1000 students. 600-699 holds 100 students (1 per score on average). */
export const BAND_CSV = `group,score_from,score_to,candidates
OVERALL,700,720,10
OVERALL,600,699,100
OVERALL,100,599,890
`;

export const EXACT_CUTOFFS = [
  { group: "GENERAL", percentile: 50, minScore: 300 },
  { group: "EWS", percentile: 50, minScore: 300 },
  { group: "OBC", percentile: 40, minScore: 140 },
  { group: "SC", percentile: 40, minScore: 140 },
  { group: "ST", percentile: 40, minScore: 140 },
  { group: "PWD", percentile: 45, minScore: 200 },
] as const;

export const BAND_CUTOFFS = [
  { group: "GENERAL", percentile: 50, minScore: 120 },
  { group: "EWS", percentile: 50, minScore: 120 },
  { group: "OBC", percentile: 40, minScore: 100 },
  { group: "SC", percentile: 40, minScore: 100 },
  { group: "ST", percentile: 40, minScore: 100 },
] as const;
