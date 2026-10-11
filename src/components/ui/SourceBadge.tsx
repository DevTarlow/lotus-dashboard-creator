import { Badge } from './Badge';
import { cn } from '@/lib/utils';
import { resourceStatus, type ResourceStatus } from '@/lib/resourceStatus';
import type { ResourceStatusInput } from '@/lib/resourceStatus';

export interface SourceBadgeProps {
  /** Either a ready-made status or the inputs to derive one. */
  status?: ResourceStatus;
  input?: ResourceStatusInput;
  className?: string;
}

/**
 * The provenance pill every live widget shows in its footer.
 *
 * "Live" must mean live, "Cached" must not pretend otherwise, and a missing key
 * must be visible rather than looking like an outage — see
 * `src/lib/resourceStatus.ts` for the vocabulary and its wording.
 */
export function SourceBadge({ status, input, className }: SourceBadgeProps) {
  const resolved = status ?? resourceStatus(input ?? {});
  return (
    <Badge tone={resolved.tone} className={cn('shrink-0', className)} title={resolved.detail}>
      {resolved.label}
    </Badge>
  );
}
