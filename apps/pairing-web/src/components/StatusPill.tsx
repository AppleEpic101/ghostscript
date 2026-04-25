import { TRUST_STATUS_LABELS, type TrustStatus } from "@ghostscript/shared";

export function StatusPill({ status }: { status: TrustStatus }) {
  const className = `status-pill status-${status.replace(/[^\w-]/g, "-")}`;

  return <span className={className}>{TRUST_STATUS_LABELS[status]}</span>;
}
