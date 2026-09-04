export type CaseState = "REPORT_ACKNOWLEDGED" | "EVIDENCE_REVIEW" | "HUMAN_DECISION" | "RESOLVED";
export type CaseAction = { type: "SUBMIT_EVIDENCE" } | { type: "SUBMIT_REPRESENTATION" } | { type: "OFFICER_RESOLVE" };

/** The only legal synthetic case transitions. AI actions are deliberately absent. */
export function transitionCase(state: CaseState, action: CaseAction): CaseState {
  if (action.type === "SUBMIT_EVIDENCE" && state === "REPORT_ACKNOWLEDGED") return "EVIDENCE_REVIEW";
  if (action.type === "SUBMIT_REPRESENTATION" && state === "EVIDENCE_REVIEW") return "HUMAN_DECISION";
  if (action.type === "OFFICER_RESOLVE" && state === "HUMAN_DECISION") return "RESOLVED";
  throw new Error(`Invalid case transition: ${state} → ${action.type}`);
}
