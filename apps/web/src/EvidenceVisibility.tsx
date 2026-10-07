import type { Claim } from './MySkills';

export function EvidenceVisibility({
  status,
  reviewer = false,
}: {
  status: Claim['status'];
  reviewer?: boolean;
}) {
  if (reviewer)
    return (
      <p className="claim-evidence-text">
        Only images included in the latest submission are shown. New draft images stay private until
        resubmission.
      </p>
    );
  if (['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'].includes(status))
    return (
      <p className="claim-evidence-text">
        New images stay private until you submit this claim for review. Previously submitted images
        remain visible to your current assigned reviewer.
      </p>
    );
  return null;
}
