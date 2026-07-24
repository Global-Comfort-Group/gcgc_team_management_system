// Board Reviewers enforcement (pure decision, no DB). The caller supplies the
// facts (does the board have a reviewer pool, who is the assigned reviewer, is
// the viewer an admin, and what the legacy permissions would have been) and this
// decides whether the viewer may finalize/rate the task.
//
// Rules:
//  - No reviewer pool on the board  -> legacy behavior is unchanged (opt-in).
//  - Pool present:
//      * admin always may finalize + rate (override).
//      * otherwise ONLY the task's assigned reviewer may finalize + rate.
//        Everyone else — including the worker/assignee and other board leaders —
//        is blocked, so nobody approves their own work.
//      * if no reviewer is assigned yet, non-admins cannot finalize (a reviewer
//        must be assigned first).
export interface ReviewerGateInput {
  hasReviewerPool: boolean
  reviewerId: string | null
  viewerId: string
  isAdmin: boolean
  legacyCanFinalize: boolean
  legacyCanRate: boolean
}

export interface ReviewerGateResult {
  canFinalize: boolean
  canRate: boolean
}

export function resolveReviewerGate(input: ReviewerGateInput): ReviewerGateResult {
  if (!input.hasReviewerPool) {
    return { canFinalize: input.legacyCanFinalize, canRate: input.legacyCanRate }
  }
  if (input.isAdmin) {
    return { canFinalize: true, canRate: true }
  }
  const isAssignedReviewer = !!input.reviewerId && input.reviewerId === input.viewerId
  return { canFinalize: isAssignedReviewer, canRate: isAssignedReviewer }
}
