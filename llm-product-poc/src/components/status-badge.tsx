import clsx from "clsx";

const styles: Record<string, string> = {
  na: "border-border text-muted",
  aiReview: "border-yellow-700 text-yellow-400",
  platformReview: "border-blue-700 text-blue-400",
  provisioning: "border-purple-700 text-purple-400",
  working: "border-green-700 text-green-400",
  rejected: "border-red-700 text-red-400",
  submitted: "border-border text-muted",
  aiReviewing: "border-yellow-700 text-yellow-400",
  needsChanges: "border-orange-700 text-orange-400",
  platformReviewing: "border-blue-700 text-blue-400",
  approved: "border-green-700 text-green-400",
  merged: "border-green-700 text-green-400",
  applied: "border-green-700 text-green-400",
};

export function StatusBadge({ value }: { value: string }) {
  return (
    <span
      className={clsx(
        "inline-block rounded border px-2 py-0.5 text-xs font-mono",
        styles[value] ?? "border-border text-muted",
      )}
    >
      {value}
    </span>
  );
}
