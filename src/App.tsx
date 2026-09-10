import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  BadgeCheck,
  BookOpen,
  Check,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Database,
  ExternalLink,
  FileSearch,
  Layers3,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import {
  SCOPE_MATCH_ADDRESS,
  assessProposal,
  connectWallet,
  createProgram,
  getAssessment,
  getFundedScope,
  getProgram,
  getProgramIds,
  getProposalRevision,
  getScopeIds,
  openProposal,
  reconnectWallet,
  registerFundedScope,
  reviseProposal,
  waitForFinalization,
} from "./lib/scopeMatch";
import type { DeliverableInput } from "./lib/validation";
import {
  explorerContractUrl,
  explorerTransactionUrl,
  parseSourceSnapshot,
  shortenAddress,
  sortedContractValues,
  validateDeliverables,
  validateHttpsUrl,
  validateId,
} from "./lib/validation";
import { parsePendingTransaction, serializePendingTransaction } from "./lib/transactions";

type Program = {
  programId: string;
  owner: string;
  name: string;
  description: string;
  registryRevision: number;
  scopeCount: number;
};

type Scope = {
  scopeId: string;
  title: string;
  deliverableText: string;
  evidenceUrls: string;
  registeredRevision: number;
};

type Proposal = {
  proposalId: string;
  revision: number;
  author: string;
  title: string;
  proposalUrl: string;
  deliverables: DeliverableInput[];
  disclosedScopeIds: string;
  registryRevision: number;
  registryScopeCount: number;
  status: string;
};

type Assessment = {
  outcome: string;
  confidenceBand: string;
  classifications: unknown;
  rationale: string;
  sourceSnapshot: unknown;
  sourcesHealthy: boolean;
  status: string;
};

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

type TransactionState = {
  label: string;
  stage: "signing" | "submitted" | "finalizing" | "finalized" | "failed";
  hash?: string;
  error?: string;
};

type Notice = { tone: "error" | "success" | "info"; text: string } | null;

const PENDING_TRANSACTION_STORAGE_KEY = "scopematch-console:pending-transaction";

const emptyDeliverable = (): DeliverableInput => ({ id: "", title: "", description: "" });

function asString(value: unknown): string {
  return value == null ? "" : String(value);
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asProgram(value: Record<string, unknown>): Program {
  return {
    programId: asString(value.program_id),
    owner: asString(value.owner),
    name: asString(value.name),
    description: asString(value.description),
    registryRevision: asNumber(value.registry_revision),
    scopeCount: asNumber(value.scope_count),
  };
}

function asScope(value: Record<string, unknown>): Scope {
  return {
    scopeId: asString(value.scope_id),
    title: asString(value.title),
    deliverableText: asString(value.deliverable_text),
    evidenceUrls: asString(value.evidence_urls),
    registeredRevision: asNumber(value.registered_revision),
  };
}

function safeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function asDeliverables(value: unknown): DeliverableInput[] {
  const parsed = safeJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: asString(item.id),
      title: asString(item.title),
      description: asString(item.description),
    }));
}

function asProposal(value: Record<string, unknown>): Proposal {
  return {
    proposalId: asString(value.proposal_id),
    revision: asNumber(value.revision),
    author: asString(value.author),
    title: asString(value.title),
    proposalUrl: asString(value.proposal_url),
    deliverables: asDeliverables(value.proposed_deliverables),
    disclosedScopeIds: asString(value.disclosed_scope_ids),
    registryRevision: asNumber(value.registry_revision),
    registryScopeCount: asNumber(value.registry_scope_count),
    status: asString(value.status),
  };
}

function asAssessment(value: Record<string, unknown>): Assessment {
  return {
    outcome: asString(value.outcome),
    confidenceBand: asString(value.confidence_band),
    classifications: safeJson(value.classifications),
    rationale: asString(value.rationale),
    sourceSnapshot: safeJson(value.source_snapshot),
    sourcesHealthy: value.sources_healthy === true || value.sources_healthy === "true",
    status: asString(value.status),
  };
}

function normalizeAddress(value: string) {
  return value.trim().toLowerCase();
}

function isBusy(transaction: TransactionState | null) {
  return Boolean(transaction && ["signing", "submitted", "finalizing"].includes(transaction.stage));
}

function persistPendingTransaction(label: string, hash: string) {
  try {
    window.sessionStorage.setItem(
      PENDING_TRANSACTION_STORAGE_KEY,
      serializePendingTransaction({ label, hash, submittedAt: Date.now() }),
    );
  } catch {
    // Losing the local convenience record never changes the on-chain transaction.
  }
}

function clearPendingTransaction() {
  try {
    window.sessionStorage.removeItem(PENDING_TRANSACTION_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in restrictive browser modes.
  }
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ") || "pending";
}

function parseEntries(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  if (value && typeof value === "object") return [value as Record<string, unknown>];
  return [];
}

function App() {
  const [wallet, setWallet] = useState("");
  const [programs, setPrograms] = useState<Program[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState("");
  const [selectedProgram, setSelectedProgram] = useState<Program | null>(null);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [loadingRegistry, setLoadingRegistry] = useState(true);
  const [transaction, setTransaction] = useState<TransactionState | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [activeView, setActiveView] = useState<"overview" | "registry" | "proposals">("overview");

  const [newProgram, setNewProgram] = useState({ id: "", name: "", description: "" });
  const [showProgramForm, setShowProgramForm] = useState(false);
  const [newScope, setNewScope] = useState({ id: "", title: "", deliverableText: "", evidenceUrl: "" });
  const [proposalMode, setProposalMode] = useState<"open" | "revise">("open");
  const [proposalForm, setProposalForm] = useState({
    id: "",
    title: "",
    proposalUrl: "",
    disclosedScopeIds: "",
    deliverables: [emptyDeliverable()],
  });
  const [lookup, setLookup] = useState({ id: "", revision: "1" });
  const [loadedProposal, setLoadedProposal] = useState<Proposal | null>(null);
  const [loadedAssessment, setLoadedAssessment] = useState<Assessment | null>(null);
  const [loadingProposal, setLoadingProposal] = useState(false);

  const contractUrl = useMemo(() => explorerContractUrl(SCOPE_MATCH_ADDRESS), []);
  const ownerConnected = Boolean(
    wallet && selectedProgram && normalizeAddress(wallet) === normalizeAddress(selectedProgram.owner),
  );
  const transactionBusy = isBusy(transaction);

  const loadRegistry = useCallback(async (programId: string) => {
    if (!programId) {
      setSelectedProgram(null);
      setScopes([]);
      setLoadingRegistry(false);
      return;
    }
    setLoadingRegistry(true);
    try {
      const program = asProgram(await getProgram(programId));
      const ids = sortedContractValues(await getScopeIds(programId, program.registryRevision));
      const scopeRecords = await Promise.all(ids.map((scopeId) => getFundedScope(programId, scopeId)));
      setSelectedProgram(program);
      setScopes(scopeRecords.map(asScope));
    } catch (error) {
      setSelectedProgram(null);
      setScopes([]);
      setNotice({
        tone: "error",
        text: errorMessage(error, "The live registry could not be read."),
      });
    } finally {
      setLoadingRegistry(false);
    }
  }, []);

  const loadPrograms = useCallback(async () => {
    setLoadingRegistry(true);
    try {
      const ids = sortedContractValues(await getProgramIds());
      const loadedPrograms = await Promise.all(ids.map(getProgram));
      const nextPrograms = loadedPrograms.map(asProgram);
      setPrograms(nextPrograms);
      setSelectedProgramId((current) => {
        if (current && nextPrograms.some((program) => program.programId === current)) return current;
        return nextPrograms[0]?.programId ?? "";
      });
      if (!nextPrograms.length) {
        setSelectedProgram(null);
        setScopes([]);
        setLoadingRegistry(false);
      }
    } catch (error) {
      setPrograms([]);
      setSelectedProgram(null);
      setScopes([]);
      setLoadingRegistry(false);
      setNotice({
        tone: "error",
        text: errorMessage(error, "StudioNet did not return the ScopeMatch program index."),
      });
    }
  }, []);

  const connect = useCallback(async (): Promise<string | null> => {
    try {
      const address = await connectWallet();
      setWallet(address);
      setNotice({ tone: "success", text: "Wallet connected on StudioNet." });
      return address;
    } catch (error) {
      setNotice({
        tone: "error",
        text: errorMessage(error, "Your wallet could not be connected."),
      });
      return null;
    }
  }, []);

  useEffect(() => {
    void loadPrograms();
  }, [loadPrograms]);

  useEffect(() => {
    void loadRegistry(selectedProgramId);
  }, [loadRegistry, selectedProgramId]);

  useEffect(() => {
    void reconnectWallet().then((address) => setWallet(address ?? ""));
    const provider = window.ethereum;
    if (!provider?.on) return undefined;
    const accountListener = (accounts: unknown) => {
      const next = Array.isArray(accounts) ? asString(accounts[0]) : "";
      setWallet(next);
      if (!next) setNotice({ tone: "info", text: "Wallet disconnected from this console." });
    };
    provider.on("accountsChanged", accountListener);
    return () => provider.removeListener?.("accountsChanged", accountListener);
  }, []);

  useEffect(() => {
    try {
      const pending = parsePendingTransaction(
        window.sessionStorage.getItem(PENDING_TRANSACTION_STORAGE_KEY),
      );
      if (pending) {
        setTransaction({ label: pending.label, stage: "submitted", hash: pending.hash });
        setNotice({
          tone: "info",
          text: "A transaction submitted in this browser session is still available in the transaction strip.",
        });
      }
    } catch {
      // Session storage is a convenience only; contract reads remain authoritative.
    }
  }, []);

  const runTransaction = async (
    label: string,
    submit: (account: string, provider: NonNullable<Window["ethereum"]>) => Promise<string>,
    onFinalized: () => Promise<void>,
  ) => {
    let account = wallet;
    if (!account) {
      account = (await connect()) ?? "";
    }
    const provider = window.ethereum;
    if (!account || !provider) return;

    setNotice(null);
    setTransaction({ label, stage: "signing" });
    try {
      const hash = await submit(account, provider);
      setTransaction({ label, stage: "submitted", hash });
      persistPendingTransaction(label, hash);
      setTransaction({ label, stage: "finalizing", hash });
      await waitForFinalization(account, provider, hash);
      setTransaction({ label, stage: "finalized", hash });
      clearPendingTransaction();
      setNotice({ tone: "success", text: `${label} finalized on StudioNet.` });
      await onFinalized();
    } catch (error) {
      const message = errorMessage(error, `${label} could not be completed.`);
      setTransaction({ label, stage: "failed", error: message });
      setNotice({ tone: "error", text: message });
    }
  };

  const refresh = async () => {
    setNotice(null);
    await loadPrograms();
    if (selectedProgramId) await loadRegistry(selectedProgramId);
  };

  const createNewProgram = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const idError = validateId(newProgram.id, "Program ID");
    if (idError || !newProgram.name.trim() || !newProgram.description.trim()) {
      setNotice({ tone: "error", text: idError ?? "Give the program a name and a concise operating description." });
      return;
    }
    await runTransaction(
      "Program creation",
      (account, provider) =>
        createProgram(account, provider, newProgram.id.trim().toLowerCase(), newProgram.name.trim(), newProgram.description.trim()),
      async () => {
        setNewProgram({ id: "", name: "", description: "" });
        setShowProgramForm(false);
        await loadPrograms();
        setSelectedProgramId(newProgram.id.trim().toLowerCase());
      },
    );
  };

  const createScope = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProgram) return;
    if (!ownerConnected) {
      setNotice({ tone: "error", text: "Only the recorded program owner can add a funded scope." });
      return;
    }
    const idError = validateId(newScope.id, "Scope ID");
    const urlError = validateHttpsUrl(newScope.evidenceUrl, "Evidence source");
    if (idError || urlError || !newScope.title.trim() || !newScope.deliverableText.trim()) {
      setNotice({ tone: "error", text: idError ?? urlError ?? "Describe the funded deliverable before registering it." });
      return;
    }
    await runTransaction(
      "Scope registration",
      (account, provider) =>
        registerFundedScope(
          account,
          provider,
          selectedProgram.programId,
          newScope.id.trim().toLowerCase(),
          newScope.title.trim(),
          newScope.deliverableText.trim(),
          newScope.evidenceUrl.trim(),
        ),
      async () => {
        setNewScope({ id: "", title: "", deliverableText: "", evidenceUrl: "" });
        await loadPrograms();
        await loadRegistry(selectedProgram.programId);
      },
    );
  };

  const updateDeliverable = (index: number, key: keyof DeliverableInput, value: string) => {
    setProposalForm((current) => ({
      ...current,
      deliverables: current.deliverables.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item,
      ),
    }));
  };

  const openOrReviseProposal = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProgram) return;
    const idError = validateId(proposalForm.id, "Proposal ID");
    const urlError = validateHttpsUrl(proposalForm.proposalUrl, "Proposal artifact");
    const deliverableError = validateDeliverables(proposalForm.deliverables);
    if (idError || urlError || deliverableError || !proposalForm.title.trim()) {
      setNotice({ tone: "error", text: idError ?? urlError ?? deliverableError ?? "Name the proposal before continuing." });
      return;
    }
    if (
      proposalMode === "revise" &&
      (!loadedProposal || normalizeAddress(loadedProposal.author) !== normalizeAddress(wallet))
    ) {
      setNotice({ tone: "error", text: "Connect the wallet that opened this proposal to create a revision." });
      return;
    }
    const proposalId = proposalForm.id.trim().toLowerCase();
    if (proposalMode === "open" && loadedProposal?.proposalId === proposalId) {
      setNotice({ tone: "error", text: "This proposal already exists. Create a revision or choose a new proposal ID." });
      return;
    }
    await runTransaction(
      proposalMode === "open" ? "Proposal opening" : "Proposal revision",
      (account, provider) => {
        const args = [
          account,
          provider,
          selectedProgram.programId,
          proposalId,
          proposalForm.title.trim(),
          proposalForm.proposalUrl.trim(),
          proposalForm.deliverables,
          proposalForm.disclosedScopeIds.trim(),
        ] as const;
        return proposalMode === "open" ? openProposal(...args) : reviseProposal(...args);
      },
      async () => {
        setLookup({ id: proposalId, revision: proposalMode === "open" ? "1" : String((loadedProposal?.revision ?? 0) + 1) });
        setProposalMode("open");
        await loadProposal(proposalId, proposalMode === "open" ? 1 : (loadedProposal?.revision ?? 0) + 1);
      },
    );
  };

  const loadProposal = async (id = lookup.id, revision = Number(lookup.revision)) => {
    if (!selectedProgram) {
      setNotice({ tone: "error", text: "Choose a program before looking up a proposal." });
      return;
    }
    const idError = validateId(id, "Proposal ID");
    if (idError || !Number.isInteger(revision) || revision < 1) {
      setNotice({ tone: "error", text: idError ?? "Revision must be a positive whole number." });
      return;
    }
    setLoadingProposal(true);
    setNotice(null);
    try {
      const proposal = asProposal(await getProposalRevision(selectedProgram.programId, id.trim().toLowerCase(), revision));
      setLoadedProposal(proposal);
      setProposalMode("revise");
      setLookup({ id: proposal.proposalId, revision: String(proposal.revision) });
      setProposalForm({
        id: proposal.proposalId,
        title: proposal.title,
        proposalUrl: proposal.proposalUrl,
        disclosedScopeIds: proposal.disclosedScopeIds,
        deliverables: proposal.deliverables.length ? proposal.deliverables : [emptyDeliverable()],
      });
      try {
        setLoadedAssessment(asAssessment(await getAssessment(selectedProgram.programId, proposal.proposalId, proposal.revision)));
      } catch {
        setLoadedAssessment(null);
      }
    } catch (error) {
      setLoadedProposal(null);
      setLoadedAssessment(null);
      setNotice({
        tone: "error",
        text: errorMessage(error, "This proposal revision could not be found on-chain."),
      });
    } finally {
      setLoadingProposal(false);
    }
  };

  const assessLoadedProposal = async () => {
    if (!selectedProgram || !loadedProposal) return;
    await runTransaction(
      "Consensus assessment",
      (account, provider) =>
        assessProposal(account, provider, selectedProgram.programId, loadedProposal.proposalId, loadedProposal.revision),
      async () => loadProposal(loadedProposal.proposalId, loadedProposal.revision),
    );
  };

  const setView = (view: "overview" | "registry" | "proposals") => {
    setActiveView(view);
    document.getElementById(view)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#overview" onClick={() => setView("overview")} aria-label="ScopeMatch Console home">
          <span className="brand-mark"><img src="/scope-match-mark.svg" alt="" /></span>
          <span>
            <strong>ScopeMatch</strong>
            <small>Consensus console</small>
          </span>
        </a>

        <nav className="primary-nav" aria-label="Console sections">
          {(["overview", "registry", "proposals"] as const).map((view) => (
            <button className={activeView === view ? "nav-active" : ""} key={view} type="button" onClick={() => setView(view)}>
              {view === "overview" ? "Overview" : view === "registry" ? "Registry" : "Proposals"}
            </button>
          ))}
        </nav>

        <div className="topbar-actions">
          <a className="network-badge" href={contractUrl} target="_blank" rel="noreferrer">
            <span /> StudioNet <ArrowUpRight size={13} />
          </a>
          {wallet ? (
            <button className="wallet-button connected" type="button" onClick={() => setWallet("")} title="Disconnect this console session">
              <span className="wallet-live" /> {shortenAddress(wallet)}
            </button>
          ) : (
            <button className="wallet-button" type="button" onClick={() => void connect()} disabled={transactionBusy}>
              <Wallet size={15} /> Connect wallet
            </button>
          )}
        </div>
      </header>

      <main>
        <section className="hero" id="overview">
          <div className="hero-copy">
            <p className="eyebrow"><ShieldCheck size={15} /> Evidence-backed scope review</p>
            <h1>Stop funding the same work twice.</h1>
            <p className="hero-description">
              ScopeMatch gives programs a recorded registry, proposal authors a clear path, and every reviewer an independent consensus result grounded in public evidence.
            </p>
            <div className="hero-actions">
              <button className="button button-primary" type="button" onClick={() => setView("proposals")}>
                Review a proposal <ChevronRight size={16} />
              </button>
              <a className="button button-quiet" href={contractUrl} target="_blank" rel="noreferrer">
                View live contract <ExternalLink size={15} />
              </a>
            </div>
          </div>

          <div className="signal-panel" aria-label="Live ScopeMatch contract status">
            <div className="signal-head">
              <span className="signal-dot" />
              <span>Live contract / StudioNet</span>
              <a href={contractUrl} target="_blank" rel="noreferrer" aria-label="Open ScopeMatch contract in explorer"><ArrowUpRight size={16} /></a>
            </div>
            <div className="signal-number">{loadingRegistry ? "—" : selectedProgram?.scopeCount ?? 0}</div>
            <p>Immutable scopes in the selected program registry</p>
            <div className="signal-rule" />
            <div className="signal-meta">
              <span>Registry revision</span>
              <strong>#{loadingRegistry ? "—" : selectedProgram?.registryRevision ?? 0}</strong>
            </div>
            <div className="signal-meta">
              <span>Decision authority</span>
              <strong>GenLayer consensus</strong>
            </div>
          </div>
        </section>

        {notice && (
          <div className={`notice notice-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
            {notice.tone === "error" ? <CircleAlert size={18} /> : notice.tone === "success" ? <BadgeCheck size={18} /> : <FileSearch size={18} />}
            <span>{notice.text}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss"><X size={15} /></button>
          </div>
        )}

        {transaction && (
          <section className={`transaction-strip transaction-${transaction.stage}`} aria-live="polite">
            <div className="transaction-summary">
              {transactionBusy ? <LoaderCircle className="spin" size={20} /> : transaction.stage === "finalized" ? <Check size={20} /> : <CircleAlert size={20} />}
              <span>
                <strong>{transaction.label}</strong>
                <small>{transaction.stage === "signing" ? "Waiting for wallet signature" : transaction.stage === "submitted" ? "Transaction broadcast" : transaction.stage === "finalizing" ? "Waiting for consensus finalization" : transaction.stage === "finalized" ? "Finalized on StudioNet" : transaction.error}</small>
              </span>
            </div>
            <div className="transaction-actions">
              {transaction.hash && <a href={explorerTransactionUrl(transaction.hash)} target="_blank" rel="noreferrer">Explorer <ArrowUpRight size={14} /></a>}
              {!transactionBusy && <button type="button" onClick={() => { if (transaction.stage === "finalized") clearPendingTransaction(); setTransaction(null); }}><X size={15} /> Close</button>}
            </div>
          </section>
        )}

        <section className="program-bar" aria-label="Active program selector">
          <div>
            <p className="eyebrow">Active program</p>
            <h2>{selectedProgram?.name || "No program loaded"}</h2>
          </div>
          <div className="program-actions">
            {programs.length > 0 && (
              <label className="select-wrap">
                <span className="sr-only">Choose a live program</span>
                <select value={selectedProgramId} onChange={(event) => setSelectedProgramId(event.target.value)} disabled={transactionBusy}>
                  {programs.map((program) => <option key={program.programId} value={program.programId}>{program.name} · {program.programId}</option>)}
                </select>
              </label>
            )}
            <button className="icon-button" type="button" onClick={() => void refresh()} disabled={transactionBusy || loadingRegistry} title="Refresh live contract data">
              <RefreshCw size={16} className={loadingRegistry ? "spin" : ""} />
            </button>
            <button className="button button-quiet" type="button" onClick={() => setShowProgramForm((current) => !current)} disabled={transactionBusy}>
              <Plus size={16} /> New program
            </button>
          </div>
        </section>

        {showProgramForm && (
          <section className="new-program-panel" aria-labelledby="new-program-heading">
            <div>
              <p className="eyebrow">Owner-controlled registry</p>
              <h2 id="new-program-heading">Create a program</h2>
              <p>Creating a program records your connected wallet as its owner. That wallet alone can register funded scopes.</p>
            </div>
            <form className="compact-form" onSubmit={(event) => void createNewProgram(event)}>
              <label><span>Program ID</span><input value={newProgram.id} onChange={(event) => setNewProgram({ ...newProgram, id: event.target.value })} placeholder="ecosystem-grants-2026" required /></label>
              <label><span>Name</span><input value={newProgram.name} onChange={(event) => setNewProgram({ ...newProgram, name: event.target.value })} placeholder="Ecosystem grants" required /></label>
              <label className="form-wide"><span>Operating description</span><textarea value={newProgram.description} onChange={(event) => setNewProgram({ ...newProgram, description: event.target.value })} placeholder="What this funding program supports and how its registry should be interpreted." required /></label>
              <div className="form-wide inline-actions"><button className="button button-primary" disabled={transactionBusy} type="submit">Create on StudioNet <ChevronRight size={16} /></button><button className="text-button" type="button" onClick={() => setShowProgramForm(false)}>Cancel</button></div>
            </form>
          </section>
        )}

        <section className="section registry-section" id="registry">
          <div className="section-heading">
            <div>
              <p className="eyebrow"><Database size={15} /> Immutable registry</p>
              <h2>What this program has already funded.</h2>
            </div>
            <p>Every proposal is compared against the registry snapshot bound when it was opened. Later scopes cannot be slipped into an older review.</p>
          </div>

          <div className="registry-grid">
            <article className="program-profile">
              {loadingRegistry ? <LoadingBlock label="Reading the live registry" /> : selectedProgram ? <>
                <div className="program-kicker"><span>Program record</span><span>Revision #{selectedProgram.registryRevision}</span></div>
                <h3>{selectedProgram.name}</h3>
                <p>{selectedProgram.description}</p>
                <dl>
                  <div><dt>Owner</dt><dd title={selectedProgram.owner}>{shortenAddress(selectedProgram.owner)}</dd></div>
                  <div><dt>Scopes</dt><dd>{selectedProgram.scopeCount} / 8</dd></div>
                  <div><dt>Authority</dt><dd>{ownerConnected ? "Owner wallet connected" : "Owner-gated writes"}</dd></div>
                </dl>
                <div className="profile-footer"><BookOpen size={15} /> Public records only. Sensitive data does not belong on-chain.</div>
              </> : <EmptyState icon={<Database size={22} />} title="No readable program" text="Create a program, or reconnect to StudioNet and refresh the live program index." />}
            </article>

            <article className="scope-list">
              <div className="scope-list-head"><span>Registered scope</span><span>Evidence</span></div>
              {loadingRegistry ? <LoadingBlock label="Reading registered scopes" /> : scopes.length ? scopes.map((scope) => <ScopeRow scope={scope} key={scope.scopeId} />) : <EmptyState icon={<Layers3 size={22} />} title="Registry is empty" text="The program owner can register its first public, evidence-backed scope below." />}
            </article>
          </div>

          <div className="scope-entry">
            <div className="scope-entry-intro">
              <p className="eyebrow">Owner action</p>
              <h3>Register a funded scope</h3>
              <p>{ownerConnected ? "This record is immutable after finalization. Describe the deliverable precisely and link one stable public source." : selectedProgram ? `Connect ${shortenAddress(selectedProgram.owner)} to register a scope for this program.` : "Choose or create a program first."}</p>
            </div>
            <form className="scope-form" onSubmit={(event) => void createScope(event)}>
              <label><span>Scope ID</span><input value={newScope.id} onChange={(event) => setNewScope({ ...newScope, id: event.target.value })} disabled={!ownerConnected || transactionBusy} placeholder="grantee-sdk-v1" required /></label>
              <label><span>Title</span><input value={newScope.title} onChange={(event) => setNewScope({ ...newScope, title: event.target.value })} disabled={!ownerConnected || transactionBusy} placeholder="Developer SDK onboarding" required /></label>
              <label className="form-wide"><span>Funded deliverable</span><textarea value={newScope.deliverableText} onChange={(event) => setNewScope({ ...newScope, deliverableText: event.target.value })} disabled={!ownerConnected || transactionBusy} placeholder="The specific work that was funded, including boundaries that a reviewer can compare." required /></label>
              <label className="form-wide"><span>Public evidence URL</span><input value={newScope.evidenceUrl} onChange={(event) => setNewScope({ ...newScope, evidenceUrl: event.target.value })} disabled={!ownerConnected || transactionBusy} placeholder="https://github.com/organization/repository" required /></label>
              <div className="form-wide"><button className="button button-primary" type="submit" disabled={!ownerConnected || transactionBusy}><Plus size={16} /> Record scope</button></div>
            </form>
          </div>
        </section>

        <section className="section proposals-section" id="proposals">
          <div className="section-heading section-heading-dark">
            <div>
              <p className="eyebrow"><ClipboardCheck size={15} /> Proposal review</p>
              <h2>Open the work. Then ask the network.</h2>
            </div>
            <p>ScopeMatch fetches the proposal artifact and its frozen evidence set inside the consensus flow. A client can display the result; it cannot invent it.</p>
          </div>

          <div className="proposals-grid">
            <article className="proposal-editor">
              <div className="editor-head">
                <div><span className="editor-label">Write to the active program</span><h3>{proposalMode === "open" ? "Open a proposal" : "Create the next revision"}</h3></div>
                <div className="mode-switch" role="group" aria-label="Proposal action">
                  <button className={proposalMode === "open" ? "mode-active" : ""} type="button" onClick={() => setProposalMode("open")}>Open</button>
                  <button className={proposalMode === "revise" ? "mode-active" : ""} type="button" onClick={() => setProposalMode("revise")} disabled={!loadedProposal}>Revise</button>
                </div>
              </div>
              <form className="proposal-form" onSubmit={(event) => void openOrReviseProposal(event)}>
                <label><span>Proposal ID</span><input value={proposalForm.id} onChange={(event) => setProposalForm((current) => ({ ...current, id: event.target.value }))} disabled={transactionBusy || proposalMode === "revise"} placeholder="community-sdk-extension" required /></label>
                <label><span>Proposal title</span><input value={proposalForm.title} onChange={(event) => setProposalForm((current) => ({ ...current, title: event.target.value }))} disabled={transactionBusy} placeholder="Mobile SDK capability extension" required /></label>
                <label className="form-wide"><span>Public proposal artifact</span><input value={proposalForm.proposalUrl} onChange={(event) => setProposalForm((current) => ({ ...current, proposalUrl: event.target.value }))} disabled={transactionBusy} placeholder="https://github.com/organization/proposal" required /></label>
                <div className="deliverable-set form-wide">
                  <div className="deliverable-title"><span>Declared deliverables</span><button className="text-button" type="button" onClick={() => setProposalForm((current) => ({ ...current, deliverables: [...current.deliverables, emptyDeliverable()] }))} disabled={transactionBusy || proposalForm.deliverables.length >= 8}><Plus size={14} /> Add deliverable</button></div>
                  {proposalForm.deliverables.map((deliverable, index) => <div className="deliverable-row" key={index}>
                    <label><span>ID</span><input value={deliverable.id} onChange={(event) => updateDeliverable(index, "id", event.target.value)} disabled={transactionBusy} placeholder="mobile-sdk" required /></label>
                    <label><span>Title</span><input value={deliverable.title} onChange={(event) => updateDeliverable(index, "title", event.target.value)} disabled={transactionBusy} placeholder="Mobile SDK" required /></label>
                    <label><span>Description</span><textarea value={deliverable.description} onChange={(event) => updateDeliverable(index, "description", event.target.value)} disabled={transactionBusy} placeholder="Specific, independently reviewable work." required /></label>
                    <button className="remove-deliverable" type="button" onClick={() => setProposalForm((current) => ({ ...current, deliverables: current.deliverables.filter((_, itemIndex) => itemIndex !== index) }))} disabled={transactionBusy || proposalForm.deliverables.length === 1} aria-label={`Remove deliverable ${index + 1}`}><X size={15} /></button>
                  </div>)}
                </div>
                <label className="form-wide"><span>Relevant scope IDs <em>optional context only</em></span><textarea value={proposalForm.disclosedScopeIds} onChange={(event) => setProposalForm((current) => ({ ...current, disclosedScopeIds: event.target.value }))} disabled={transactionBusy} placeholder="One existing scope ID per line. Disclosure does not decide the result." /></label>
                <div className="form-wide proposal-submit"><p><ShieldCheck size={15} /> Proposal and evidence URLs are public on-chain inputs. Use only material you are allowed to disclose.</p><button className="button button-accent" type="submit" disabled={transactionBusy || !selectedProgram}>{proposalMode === "open" ? "Open proposal" : "Create revision"} <ChevronRight size={16} /></button></div>
              </form>
            </article>

            <aside className="review-desk">
              <div className="desk-head"><div><span className="editor-label">Read from the live contract</span><h3>Assessment desk</h3></div><Search size={19} /></div>
              <div className="lookup-form">
                <label><span>Proposal ID</span><input value={lookup.id} onChange={(event) => setLookup({ ...lookup, id: event.target.value })} placeholder="proposal-id" /></label>
                <label><span>Revision</span><input min="1" inputMode="numeric" value={lookup.revision} onChange={(event) => setLookup({ ...lookup, revision: event.target.value })} /></label>
                <button className="button button-quiet" type="button" onClick={() => void loadProposal()} disabled={loadingProposal || transactionBusy || !selectedProgram}>{loadingProposal ? <LoaderCircle className="spin" size={15} /> : <Search size={15} />} Load record</button>
              </div>

              {loadedProposal ? <>
                <div className="proposal-record">
                  <div className="record-top"><span className={`status-pill status-${statusLabel(loadedProposal.status)}`}>{statusLabel(loadedProposal.status)}</span><span>Revision {loadedProposal.revision}</span></div>
                  <h4>{loadedProposal.title}</h4>
                  <p>Opened by <strong title={loadedProposal.author}>{shortenAddress(loadedProposal.author)}</strong> against registry revision #{loadedProposal.registryRevision}.</p>
                  <a href={loadedProposal.proposalUrl} target="_blank" rel="noreferrer">Open proposal artifact <ArrowUpRight size={14} /></a>
                  <div className="record-details"><span>{loadedProposal.deliverables.length} declared deliverable{loadedProposal.deliverables.length === 1 ? "" : "s"}</span><span>{loadedProposal.registryScopeCount} bound scope{loadedProposal.registryScopeCount === 1 ? "" : "s"}</span></div>
                </div>
                {loadedAssessment ? <AssessmentResult assessment={loadedAssessment} /> : <div className="assessment-prompt"><FileSearch size={21} /><div><strong>No consensus result recorded</strong><p>Anyone with a connected wallet may pay to request one assessment for this immutable revision.</p></div><button className="button button-accent" type="button" onClick={() => void assessLoadedProposal()} disabled={transactionBusy}>Run assessment <ChevronRight size={15} /></button></div>}
              </> : <EmptyState icon={<FileSearch size={24} />} title="Load an on-chain proposal" text="Enter a proposal ID and revision to inspect its frozen scope snapshot or request consensus." />}
            </aside>
          </div>
        </section>
      </main>

      <footer>
        <span>ScopeMatch Console</span>
        <span>Live reads and writes are made directly against the StudioNet contract.</span>
        <a href={contractUrl} target="_blank" rel="noreferrer">Contract {shortenAddress(SCOPE_MATCH_ADDRESS)} <ArrowUpRight size={13} /></a>
      </footer>
    </div>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return <div className="loading-block"><LoaderCircle className="spin" size={18} /><span>{label}</span></div>;
}

function EmptyState({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="empty-state">{icon}<strong>{title}</strong><p>{text}</p></div>;
}

function ScopeRow({ scope }: { scope: Scope }) {
  const firstEvidence = scope.evidenceUrls.split("\n")[0];
  return <div className="scope-row">
    <div><span className="scope-id">{scope.scopeId}</span><h4>{scope.title}</h4><p>{scope.deliverableText}</p><span className="scope-revision">Added in registry revision #{scope.registeredRevision}</span></div>
    <a href={firstEvidence} target="_blank" rel="noreferrer">Source <ArrowUpRight size={14} /></a>
  </div>;
}

function AssessmentResult({ assessment }: { assessment: Assessment }) {
  const classificationEntries = parseEntries(assessment.classifications);
  const sourceEntries = parseSourceSnapshot(assessment.sourceSnapshot);
  return <div className="assessment-result">
    <div className="assessment-heading"><div><span className="editor-label">Persisted consensus result</span><h4>{statusLabel(assessment.outcome)}</h4></div><span className={`confidence confidence-${assessment.confidenceBand}`}>{assessment.confidenceBand} confidence</span></div>
    <p className="assessment-rationale">{assessment.rationale || "No freeform rationale was persisted."}</p>
    {classificationEntries.length > 0 && <div className="result-list"><span>Deliverable classifications</span>{classificationEntries.map((entry, index) => <div className="result-row" key={index}><strong>{asString(entry.deliverable_id || entry.id || `Deliverable ${index + 1}`)}</strong><span>{statusLabel(asString(entry.classification || entry.result))}</span></div>)}</div>}
    {sourceEntries.length > 0 && <div className="source-list"><span>Fetched source snapshot</span>{sourceEntries.map((entry, index) => <div className="source-row" key={`${entry.role}-${index}`}><strong>{entry.role.replaceAll("_", " ")}</strong><span>HTTP {entry.status} · {entry.fingerprint.slice(0, 12)}</span></div>)}</div>}
    <div className="result-foot"><span>{assessment.sourcesHealthy ? <><Check size={14} /> Bound sources healthy</> : <><CircleAlert size={14} /> Source uncertainty recorded</>}</span><span>{sourceEntries.length} source snapshot{sourceEntries.length === 1 ? "" : "s"}</span></div>
  </div>;
}

export default App;
