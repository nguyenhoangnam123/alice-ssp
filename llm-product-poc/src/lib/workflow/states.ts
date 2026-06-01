/**
 * Mirrors the Step Functions states from the design diagram.
 *
 * aiReview        → AI agent validates the request + opens PR
 * platformReview  → PR is open, waiting for platform engineer merge
 * provisioning    → PR merged, ArgoCD syncing
 * working         → ArgoCD reports healthy
 * rejected        → AI agent or platform engineer rejected
 */
export const WorkflowState = {
  AiReview: "aiReview",
  PlatformReview: "platformReview",
  Provisioning: "provisioning",
  Working: "working",
  Rejected: "rejected",
} as const;

export type WorkflowStateValue = (typeof WorkflowState)[keyof typeof WorkflowState];

export const ChangeRequestStatus = {
  Submitted: "submitted",
  AiReviewing: "aiReviewing",
  NeedsChanges: "needsChanges",
  PlatformReviewing: "platformReviewing",
  Approved: "approved",
  Rejected: "rejected",
  Merged: "merged",
  Applied: "applied",
} as const;

export type ChangeRequestStatusValue =
  (typeof ChangeRequestStatus)[keyof typeof ChangeRequestStatus];
