/**
 * Joint scoring, exactly per HANDOFF.md section 5: for the two touching face
 * layers, matched = void on both sides, dead = void on only one side
 * (an opening that dead-ends into foam). score = 100 * matched / (matched+dead),
 * null ("sealed") if nothing opens onto the joint at all.
 */
export function jointScore(faceA: Uint8Array, faceB: Uint8Array): number | null {
  let matched = 0;
  let dead = 0;
  const n = Math.min(faceA.length, faceB.length);
  for (let i = 0; i < n; i++) {
    const a = faceA[i] !== 0;
    const b = faceB[i] !== 0;
    if (a && b) matched++;
    else if (a !== b) dead++;
  }
  if (matched + dead === 0) return null;
  return (100 * matched) / (matched + dead);
}

export function aggregateScore(scores: (number | null)[]): number | null {
  const real = scores.filter((s): s is number => s !== null);
  if (!real.length) return null;
  // re-derive from matched/dead isn't available post-hoc from percentages alone once mixed,
  // so for a quick overall readout we average the per-joint scores -- fine for display purposes.
  return real.reduce((a, b) => a + b, 0) / real.length;
}

export function ratingFor(score: number | null): "sealed" | "poor" | "partial" | "interlocks" {
  if (score === null) return "sealed";
  if (score >= 90) return "interlocks";
  if (score >= 60) return "partial";
  return "poor";
}
