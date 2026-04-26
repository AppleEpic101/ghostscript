import type { PairingStatus } from "./types";
import type { SupportedTransportConfigId, TransportProtocolVersion } from "./types";

export const PAIRING_STATUS_LABELS: Record<PairingStatus, string> = {
  "invite-pending": "Invite pending",
  paired: "Paired",
  invalidated: "Connection ended",
};

export const TRANSPORT_PROTOCOL_VERSION: TransportProtocolVersion = 1;
export const DEFAULT_TRANSPORT_CONFIG_ID: SupportedTransportConfigId = "ghostscript-default-v1";
export const SUPPORTED_TRANSPORT_CONFIG_IDS = [DEFAULT_TRANSPORT_CONFIG_ID] as const satisfies readonly SupportedTransportConfigId[];

export const POPUP_STEP_LABELS = {
  home: "Home",
  "create-invite-details": "Create invite details",
} as const;
