export type DeliverableInput = {
  id: string;
  title: string;
  description: string;
};

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;
const HTTPS_PATTERN = /^https:\/\/[^\s]+$/i;

export function validateId(value: string, fieldName: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!ID_PATTERN.test(normalized)) {
    return `${fieldName} must use 2–63 lowercase letters, numbers, or hyphens.`;
  }
  return null;
}

export function validateHttpsUrl(value: string, fieldName: string): string | null {
  if (!HTTPS_PATTERN.test(value.trim())) {
    return `${fieldName} must be a public HTTPS URL.`;
  }
  return null;
}

export function validateDeliverables(items: DeliverableInput[]): string | null {
  if (!items.length || items.length > 8) {
    return "Add between one and eight proposed deliverables.";
  }

  const seen = new Set<string>();
  for (const item of items) {
    const idError = validateId(item.id, "Deliverable ID");
    if (idError) return idError;
    if (seen.has(item.id.trim().toLowerCase())) {
      return "Each proposed deliverable needs a unique ID.";
    }
    seen.add(item.id.trim().toLowerCase());
    if (!item.title.trim() || !item.description.trim()) {
      return "Every deliverable needs a title and a concrete description.";
    }
  }
  return null;
}

export function sortedContractValues(value: Record<string, unknown>): string[] {
  return Object.entries(value)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, item]) => String(item));
}

export type SourceSnapshotEntry = {
  role: string;
  status: string;
  fingerprint: string;
};

export function parseSourceSnapshot(value: unknown): SourceSnapshotEntry[] {
  if (typeof value !== "string") return [];
  return value
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => {
      const [role = "source", status = "unknown", fingerprint = "unavailable"] = line.split("|");
      return { role, status, fingerprint };
    });
}

export function shortenAddress(address: string): string {
  return address.length < 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function explorerTransactionUrl(hash: string): string {
  return `https://explorer-studio.genlayer.com/tx/${hash}`;
}

export function explorerContractUrl(address: string): string {
  return `https://explorer-studio.genlayer.com/address/${address}`;
}
