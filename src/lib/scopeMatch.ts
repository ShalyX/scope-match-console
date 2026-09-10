import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus, type CalldataEncodable, type Hash } from "genlayer-js/types";
import type { DeliverableInput } from "./validation";

export const SCOPE_MATCH_ADDRESS =
  import.meta.env.VITE_SCOPEMATCH_CONTRACT_ADDRESS ??
  "0x887f64fd7B7Fb31851Eb7D78f5629710BaB63561" as `0x${string}`;
const PUBLIC_STUDIONET_RPC_URL = "https://studio.genlayer.com/api";
export const SCOPE_MATCH_RPC_URL =
  import.meta.env.VITE_SCOPEMATCH_RPC_URL?.trim() || "/api/studionet";

type Provider = NonNullable<Window["ethereum"]>;

const STUDIONET_CHAIN_ID = `0x${studionet.id.toString(16)}`;

function providerErrorCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : undefined;
}

function isUnknownChainError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? "").toLowerCase();
  return providerErrorCode(error) === 4902 || message.includes("unknown chain") || message.includes("unrecognized chain");
}

async function ensureStudionetNetwork(provider: Provider): Promise<void> {
  const currentChainId = String(await provider.request({ method: "eth_chainId" }) || "").toLowerCase();
  if (currentChainId === STUDIONET_CHAIN_ID) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: STUDIONET_CHAIN_ID }],
    });
    return;
  } catch (error) {
    if (!isUnknownChainError(error)) {
      throw new Error(`Switch your wallet to GenLayer Studio Network (chain ${studionet.id}) before continuing.`);
    }
  }

  await provider.request({
    method: "wallet_addEthereumChain",
    params: [{
      chainId: STUDIONET_CHAIN_ID,
      chainName: studionet.name,
      rpcUrls: [PUBLIC_STUDIONET_RPC_URL],
      nativeCurrency: studionet.nativeCurrency,
      blockExplorerUrls: [studionet.blockExplorers?.default.url],
    }],
  });
  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: STUDIONET_CHAIN_ID }],
  });
}

function readClient() {
  return createClient({ chain: studionet, endpoint: SCOPE_MATCH_RPC_URL });
}

function signingClient(account: string, provider: Provider) {
  return createClient({
    chain: studionet,
    endpoint: SCOPE_MATCH_RPC_URL,
    account: account as `0x${string}`,
    provider,
  });
}

export async function connectWallet(): Promise<string> {
  if (!window.ethereum) {
    throw new Error("No browser wallet was found. Install MetaMask, then return here to connect.");
  }
  const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
  const account = accounts?.[0];
  if (!account) throw new Error("Your wallet did not return an account.");
  await ensureStudionetNetwork(window.ethereum);
  return account;
}

export async function reconnectWallet(): Promise<string | null> {
  if (!window.ethereum) return null;
  const accounts = (await window.ethereum.request({ method: "eth_accounts" })) as string[];
  return accounts?.[0] ?? null;
}

export async function getProgramIds(): Promise<Record<string, unknown>> {
  return readClient().readContract({
    address: SCOPE_MATCH_ADDRESS,
    functionName: "get_program_ids",
    args: [],
  }) as Promise<Record<string, unknown>>;
}

export async function getProgram(programId: string): Promise<Record<string, unknown>> {
  return readClient().readContract({
    address: SCOPE_MATCH_ADDRESS,
    functionName: "get_program",
    args: [programId],
  }) as Promise<Record<string, unknown>>;
}

export async function getScopeIds(
  programId: string,
  revision: number | string,
): Promise<Record<string, unknown>> {
  return readClient().readContract({
    address: SCOPE_MATCH_ADDRESS,
    functionName: "get_scope_ids_for_revision",
    args: [programId, revision],
  }) as Promise<Record<string, unknown>>;
}

export async function getFundedScope(
  programId: string,
  scopeId: string,
): Promise<Record<string, unknown>> {
  return readClient().readContract({
    address: SCOPE_MATCH_ADDRESS,
    functionName: "get_funded_scope",
    args: [programId, scopeId],
  }) as Promise<Record<string, unknown>>;
}

export async function getProposalRevision(
  programId: string,
  proposalId: string,
  revision: number | string,
): Promise<Record<string, unknown>> {
  return readClient().readContract({
    address: SCOPE_MATCH_ADDRESS,
    functionName: "get_proposal_revision",
    args: [programId, proposalId, revision],
  }) as Promise<Record<string, unknown>>;
}

export async function getAssessment(
  programId: string,
  proposalId: string,
  revision: number | string,
): Promise<Record<string, unknown>> {
  return readClient().readContract({
    address: SCOPE_MATCH_ADDRESS,
    functionName: "get_assessment",
    args: [programId, proposalId, revision],
  }) as Promise<Record<string, unknown>>;
}

async function write(
  account: string,
  provider: Provider,
  functionName: string,
  args: unknown[],
): Promise<Hash> {
  return signingClient(account, provider).writeContract({
    address: SCOPE_MATCH_ADDRESS,
    functionName,
    args: args as CalldataEncodable[],
    value: 0n,
  }) as Promise<Hash>;
}

export async function waitForFinalization(account: string, provider: Provider, hash: string) {
  return signingClient(account, provider).waitForTransactionReceipt({
    hash: hash as Hash,
    status: TransactionStatus.FINALIZED,
    interval: 5000,
    retries: 48,
  });
}

export function createProgram(account: string, provider: Provider, id: string, name: string, description: string) {
  return write(account, provider, "create_program", [id, name, description]);
}

export function registerFundedScope(
  account: string,
  provider: Provider,
  programId: string,
  scopeId: string,
  title: string,
  deliverableText: string,
  evidenceUrl: string,
) {
  return write(account, provider, "register_funded_scope", [
    programId,
    scopeId,
    title,
    deliverableText,
    evidenceUrl,
  ]);
}

export function openProposal(
  account: string,
  provider: Provider,
  programId: string,
  proposalId: string,
  title: string,
  proposalUrl: string,
  deliverables: DeliverableInput[],
  disclosedScopeIds: string,
) {
  return write(account, provider, "open_proposal", [
    programId,
    proposalId,
    title,
    proposalUrl,
    deliverables.map((item) => ({
      id: item.id.trim().toLowerCase(),
      title: item.title.trim(),
      description: item.description.trim(),
    })),
    disclosedScopeIds,
  ]);
}

export function reviseProposal(
  account: string,
  provider: Provider,
  programId: string,
  proposalId: string,
  title: string,
  proposalUrl: string,
  deliverables: DeliverableInput[],
  disclosedScopeIds: string,
) {
  return write(account, provider, "revise_proposal", [
    programId,
    proposalId,
    title,
    proposalUrl,
    deliverables.map((item) => ({
      id: item.id.trim().toLowerCase(),
      title: item.title.trim(),
      description: item.description.trim(),
    })),
    disclosedScopeIds,
  ]);
}

export function assessProposal(
  account: string,
  provider: Provider,
  programId: string,
  proposalId: string,
  revision: number,
) {
  return write(account, provider, "assess_proposal", [programId, proposalId, revision]);
}
