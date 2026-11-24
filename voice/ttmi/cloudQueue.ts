// The hosted-voice queue (docs/plan-cloud-voice.md). ElevenLabs allows a
// few concurrent requests on one key. Two at a time: the step on screen,
// and the next one. The rest wait, in order, so the first clip can play
// as soon as it is ready.

export type CloudPriority = "now" | "next" | "later";

export const CLOUD_AT_ONCE = 2;

export function cloudRank(priority: CloudPriority | undefined, urgent: boolean): number {
  if (urgent || priority === "now") return 0;
  if (priority === "next") return 1;
  return 2;
}

// Puts key at its rank, ahead of anything less urgent, and not twice.
export function placeCloudJob(order: { key: string; rank: number }[], key: string, rank: number): { key: string; rank: number }[] {
  const rest = order.filter((item) => item.key !== key);
  const at = rest.findIndex((item) => item.rank > rank);
  const next = [...rest];
  next.splice(at < 0 ? next.length : at, 0, { key, rank });
  return next;
}
