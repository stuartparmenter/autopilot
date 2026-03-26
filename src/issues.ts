export type IssueTracker = "beads" | "linear";

export const TRACKER_PLUGINS: Record<IssueTracker, string> = {
  beads: "issues-beads",
  linear: "issues-linear",
};

export const TRACKER_DENY_PATHS: Record<IssueTracker, string[]> = {
  beads: [".beads"],
  linear: [],
};
