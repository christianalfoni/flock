// How long a walkthrough's voice took to make before it could start, in
// the buckets the anonymous daily counts keep (voice_prepared in
// CLIENT_EVENTS): what a reader waits, model load included.
export const PREP_BUCKETS = ["under_5s", "5_15s", "15_30s", "30_60s", "1_2m", "over_2m"] as const;
export type PrepBucket = (typeof PREP_BUCKETS)[number];

export function prepBucket(seconds: number): PrepBucket {
  if (seconds < 5) return "under_5s";
  if (seconds < 15) return "5_15s";
  if (seconds < 30) return "15_30s";
  if (seconds < 60) return "30_60s";
  if (seconds < 120) return "1_2m";
  return "over_2m";
}
