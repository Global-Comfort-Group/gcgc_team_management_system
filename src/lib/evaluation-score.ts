/**
 * Evaluation scores are STORED as a 0–100 gradient (0, 25, 50, 75, 100) and
 * SHOWN as a 1–5 rating (field reports 2026-09).
 *
 * The gradient is the wire format: the API's zod refine, `TaskEvaluation.
 * gradientScore` and `QUALITY_SCORE` in `task-evaluation-sync.ts` all depend on
 * it, and a task's work-quality rating is already a 1–5 scale mirrored onto it.
 * Only the display changes, so the two scales can never disagree.
 */

/** 0/25/50/75/100 → 1/2/3/4/5. Averages land in between and are not rounded. */
export function gradientToRating(gradientScore: number): number {
  return gradientScore / 25 + 1
}

/** 1..5 → 0/25/50/75/100. */
export function ratingToGradient(rating: number): number {
  return (rating - 1) * 25
}

/**
 * A rating for display. Whole grades print as "4"; an average prints with one
 * decimal ("3.8") so a team of 4s and 5s doesn't read as a flat 4.
 */
export function formatRating(gradientScore: number, decimals = 0): string {
  return gradientToRating(gradientScore).toFixed(decimals)
}
