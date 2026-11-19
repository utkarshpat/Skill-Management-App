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
        Only files included in the latest submission are shown. New draft files stay private until
        resubmission.
      </p>
    );
  if (['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'].includes(status))
    return (
      <p className="claim-evidence-text">
        New files stay private until you submit this claim for approval. Previously submitted files
        remain visible to your current assigned approver.
      </p>
    );
  return null;
}
