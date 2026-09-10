export type PendingTransaction = {
  label: string;
  hash: string;
  submittedAt: number;
};

const HASH_PATTERN = /^0x[0-9a-f]{64}$/i;

export function parsePendingTransaction(value: string | null): PendingTransaction | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PendingTransaction>;
    if (
      typeof parsed.label !== "string" ||
      !parsed.label.trim() ||
      parsed.label.length > 120 ||
      typeof parsed.hash !== "string" ||
      !HASH_PATTERN.test(parsed.hash) ||
      typeof parsed.submittedAt !== "number" ||
      !Number.isFinite(parsed.submittedAt)
    ) {
      return null;
    }
    return { label: parsed.label, hash: parsed.hash, submittedAt: parsed.submittedAt };
  } catch {
    return null;
  }
}

export function serializePendingTransaction(transaction: PendingTransaction): string {
  return JSON.stringify(transaction);
}
