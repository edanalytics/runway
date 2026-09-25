import { useQuery } from '@tanstack/react-query';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  GetJobDto,
  GetStudentInputDetailsDto,
  StudentRosterDetailsJson,
} from '@edanalytics/models';
import { getJobStudentMatchResults } from '../../../api/queries/job.queries';
import { pretendRoster, RosterStudent, SearchHit, SearchTerms } from './mockIdrs';

/*
 * PROTOTYPE ONLY. One review session per job page, shared by every review
 * design so a decision made on one tab shows on the others. Decisions,
 * searches and reprocessing batches are simulated. They're kept in this
 * browser's storage so leaving and coming back can be tried out, and a
 * batch's progress is worked out from the clock, so it survives a reload.
 *
 * A run reports only a summary: per resource, how many records it processed,
 * skipped and failed. It can't say which students those records belong to,
 * so a batch's outcome belongs to the batch, never to a student. A delivery
 * failure doesn't undo a match decision either; like a job that completes
 * with errors today, it's resolved out of band.
 */

export type Candidate = {
  studentUniqueId: string;
  rosterDetails: StudentRosterDetailsJson;
  /** IDRS's score, when the candidate came from IDRS. */
  score: number | null;
  source: 'suggestion' | 'search';
};

export type DecisionChoice = { kind: 'match'; candidate: Candidate } | { kind: 'not-in-roster' };

export type Decision = DecisionChoice & { decidedAt: number; decidedBy: string };

export type MatchDecision = Extract<Decision, { kind: 'match' }>;

/** One resource's counts, as a run's summary reports them. */
export type ResourceSummary = { processed: number; skipped: number; failed: number };

export type BatchItem = { correlationId: string; decision: MatchDecision };

export type BatchStatus = 'queued' | 'processing' | 'complete' | 'complete with errors' | 'failed';

/** A batch as stored: what it was sent with and how its pretend run will go. */
type StoredBatch = {
  id: number;
  submittedAt: number;
  startsAt: number;
  finishesAt: number;
  items: BatchItem[];
  /** The batch this one retries, if any. */
  retryOf?: number;
  /** A run that fails outright produces no summary. */
  plan: {
    outcome: 'complete' | 'complete with errors' | 'failed';
    summary?: Record<string, ResourceSummary>;
  };
};

export type Batch = Omit<StoredBatch, 'plan'> & {
  status: BatchStatus;
  /** The run's summary, once it finishes. */
  summary?: Record<string, ResourceSummary>;
};

export const isFinished = (batch: Batch) =>
  batch.status !== 'queued' && batch.status !== 'processing';

/**
 * Where each student stands. Excluding a student takes effect at once: they
 * never go to the Executor. `reprocessed` means a run was attempted with the
 * student's match; whether their records loaded isn't knowable. `run-failed`
 * means the batch's run failed outright, so nothing was attempted.
 */
export type StudentStatus =
  | 'to-review'
  | 'ready'
  | 'reprocessing'
  | 'reprocessed'
  | 'run-failed'
  | 'excluded';

export type SearchState = { terms: SearchTerms; hits: SearchHit[] | null };

type Session = {
  job: GetJobDto;
  groups: GetStudentInputDetailsDto[];
  isLoading: boolean;
  isError: boolean;
  roster: RosterStudent[];
  decisions: Map<string, Decision>;
  batches: Batch[];
  /** Saves a decision; `decidedBy` is the reviewer, "you" unless simulating someone else. */
  decide: (correlationId: string, decision: DecisionChoice, decidedBy?: string) => void;
  undo: (correlationId: string) => void;
  statusOf: (correlationId: string) => StudentStatus;
  /** The latest batch this student was submitted in, if any. */
  batchOf: (correlationId: string) => Batch | undefined;
  /**
   * Submits the match decisions among these students as one batch. Refused
   * when a decision changed on the server since this page loaded it.
   */
  submit: (correlationIds: string[]) => SubmitResult;
  /** Sends a failed batch's choices again, as a new batch. */
  retry: (batchId: number) => void;
  /** The reviewer's last search for a student, kept for when they come back. */
  searchOf: (correlationId: string) => SearchState | undefined;
  setSearch: (correlationId: string, search: SearchState) => void;
  /** Prototype control: make the next batch's run fail outright. */
  failNextRun: boolean;
  setFailNextRun: (fail: boolean) => void;
  /** Prototype control: make the next submission find a conflicting change. */
  conflictNextSubmit: boolean;
  setConflictNextSubmit: (conflict: boolean) => void;
  reset: () => void;
};

const SessionContext = createContext<Session | null>(null);

export const useReviewSession = () => {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useReviewSession must be used inside a ReviewSessionProvider');
  return session;
};

export type SubmitResult = { ok: true } | { ok: false; reason: 'conflict' };

type Stored = {
  decisions: [string, Decision][];
  batches: StoredBatch[];
  searches: [string, SearchState][];
};

const storageKey = (jobId: number) => `runway.match-review-prototype.${jobId}`;

const load = (jobId: number): Stored | null => {
  try {
    const raw = window.localStorage.getItem(storageKey(jobId));
    if (!raw) return null;
    const stored = JSON.parse(raw) as Stored;
    // Drop decision kinds this prototype no longer has.
    stored.decisions = stored.decisions.filter(
      ([, d]) => d.kind === 'match' || d.kind === 'not-in-roster'
    );
    return stored;
  } catch {
    return null;
  }
};

const save = (jobId: number, stored: Stored | null) => {
  try {
    if (stored) window.localStorage.setItem(storageKey(jobId), JSON.stringify(stored));
    else window.localStorage.removeItem(storageKey(jobId));
  } catch {
    // Storage is a convenience here; the session still works without it.
  }
};

export const ReviewSessionProvider = ({
  job,
  children,
}: {
  job: GetJobDto;
  children: ReactNode;
}) => {
  const { data, isLoading, isError } = useQuery(getJobStudentMatchResults(String(job.id)));
  const groups = useMemo(() => data ?? [], [data]);
  const roster = useMemo(() => pretendRoster(groups), [groups]);
  const [initial] = useState(() => load(job.id));
  const [decisions, setDecisions] = useState<Map<string, Decision>>(
    () => new Map(initial?.decisions ?? [])
  );
  const [stored, setStored] = useState<StoredBatch[]>(() => initial?.batches ?? []);
  const [searches, setSearches] = useState<Map<string, SearchState>>(
    () => new Map(initial?.searches ?? [])
  );
  const [failNextRun, setFailNextRun] = useState(false);
  const [conflictNextSubmit, setConflictNextSubmit] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    save(job.id, {
      decisions: [...decisions],
      batches: stored,
      searches: [...searches],
    });
  }, [job.id, decisions, stored, searches]);

  // Tick while any run is unfinished, so batches move along.
  const running = stored.some((batch) => batch.finishesAt > now);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [running]);

  const batches = useMemo<Batch[]>(
    () =>
      stored.map(({ plan, ...batch }) => {
        if (now < batch.startsAt) return { ...batch, status: 'queued' };
        if (now < batch.finishesAt) return { ...batch, status: 'processing' };
        return { ...batch, status: plan.outcome, summary: plan.summary };
      }),
    [stored, now]
  );

  // MOCK ONLY, not product policy: the latest school year any roster student
  // is enrolled in stands in for the job's year, and a match to someone not
  // enrolled then fails to load, so a batch can complete with errors.
  const currentYear = useMemo(
    () =>
      Math.max(
        0,
        ...roster.flatMap((student) =>
          Array.isArray(student.rosterDetails.school_years)
            ? student.rosterDetails.school_years.filter((y): y is number => typeof y === 'number')
            : []
        )
      ),
    [roster]
  );

  /** What the pretend run's summary reports for a batch. */
  const summarize = useCallback(
    (items: BatchItem[]): Record<string, ResourceSummary> => {
      let processed = 0;
      let failed = 0;
      for (const { correlationId, decision } of items) {
        const records = recordsFor(correlationId);
        processed += records;
        const years = decision.candidate.rosterDetails.school_years;
        if (Array.isArray(years) && currentYear && !years.includes(currentYear)) {
          failed += records;
        }
      }
      return { studentAssessments: { processed, skipped: 0, failed } };
    },
    [currentYear]
  );

  const batchOf = useCallback(
    (correlationId: string) =>
      [...batches].reverse().find((b) => b.items.some((it) => it.correlationId === correlationId)),
    [batches]
  );

  const statusOf = useCallback(
    (correlationId: string): StudentStatus => {
      const decision = decisions.get(correlationId);
      const batch = batchOf(correlationId);
      // A decision made since the last submission is the one that counts.
      if (decision && (!batch || decision.decidedAt > batch.submittedAt)) {
        return decision.kind === 'match' ? 'ready' : 'excluded';
      }
      if (batch) {
        if (!isFinished(batch)) return 'reprocessing';
        return batch.status === 'failed' ? 'run-failed' : 'reprocessed';
      }
      return 'to-review';
    },
    [batchOf, decisions]
  );

  const decide = useCallback(
    (correlationId: string, decision: DecisionChoice, decidedBy = 'you') => {
      setDecisions((current) =>
        new Map(current).set(correlationId, { ...decision, decidedAt: Date.now(), decidedBy })
      );
    },
    []
  );

  const undo = useCallback((correlationId: string) => {
    setDecisions((current) => {
      const next = new Map(current);
      next.delete(correlationId);
      return next;
    });
  }, []);

  const send = useCallback(
    (items: BatchItem[], retryOf?: number) => {
      if (!items.length) return;
      const at = Date.now();
      const summary = summarize(items);
      const plan: StoredBatch['plan'] = failNextRun
        ? { outcome: 'failed' }
        : {
            outcome: Object.values(summary).some((r) => r.failed > 0)
              ? 'complete with errors'
              : 'complete',
            summary,
          };
      setFailNextRun(false);
      setStored((current) => [
        ...current,
        {
          id: at,
          submittedAt: at,
          startsAt: at + 1500,
          finishesAt: at + 3500 + items.length * 500,
          items,
          retryOf,
          plan,
        },
      ]);
      setNow(at);
    },
    [failNextRun, summarize]
  );

  const submit = useCallback(
    (correlationIds: string[]): SubmitResult => {
      // Stands in for the server checking each decision is still the one
      // this page loaded, before it accepts the batch.
      if (conflictNextSubmit) {
        setConflictNextSubmit(false);
        return { ok: false, reason: 'conflict' };
      }
      send(
        correlationIds.flatMap((correlationId) => {
          const decision = decisions.get(correlationId);
          return decision?.kind === 'match' ? [{ correlationId, decision }] : [];
        })
      );
      return { ok: true };
    },
    [conflictNextSubmit, decisions, send]
  );

  const retry = useCallback(
    (batchId: number) => {
      const batch = batches.find((b) => b.id === batchId);
      // Only students this batch still speaks for: not ones decided again since.
      if (batch)
        send(
          batch.items.filter((it) => batchOf(it.correlationId)?.id === batchId),
          batchId
        );
    },
    [batches, batchOf, send]
  );

  const searchOf = useCallback((correlationId: string) => searches.get(correlationId), [searches]);
  const setSearch = useCallback((correlationId: string, search: SearchState) => {
    setSearches((current) => new Map(current).set(correlationId, search));
  }, []);

  const reset = useCallback(() => {
    setDecisions(new Map());
    setStored([]);
    setSearches(new Map());
    setFailNextRun(false);
    setConflictNextSubmit(false);
    save(job.id, null);
  }, [job.id]);

  const session: Session = {
    job,
    groups,
    isLoading,
    isError,
    roster,
    decisions,
    batches,
    decide,
    undo,
    statusOf,
    batchOf,
    submit,
    retry,
    searchOf,
    setSearch,
    failNextRun,
    setFailNextRun,
    conflictNextSubmit,
    setConflictNextSubmit,
    reset,
  };
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
};

/** Every candidate IDRS suggested for a student, best first. */
export const suggestedCandidates = (group: GetStudentInputDetailsDto): Candidate[] =>
  group.results
    .flatMap((result) => result.suggestions)
    .sort((a, b) => b.score - a.score)
    .map((suggestion) => ({
      studentUniqueId: suggestion.studentUniqueId,
      rosterDetails: suggestion.rosterDetails,
      score: suggestion.score,
      source: 'suggestion' as const,
    }));

/** How many records a student has in the file: one or two, in this prototype. */
const recordsFor = (correlationId: string) => 1 + (parseInt(correlationId.slice(-1), 16) % 2);

/** Every resource's counts added up, e.g. across all of a job's batches. */
export const totalOf = (summary: Record<string, ResourceSummary> | undefined) =>
  Object.values(summary ?? {}).reduce(
    (total, resource) => ({
      processed: total.processed + resource.processed,
      skipped: total.skipped + resource.skipped,
      failed: total.failed + resource.failed,
    }),
    { processed: 0, skipped: 0, failed: 0 }
  );

/** Loaded is processed less skipped and failed, as the job page counts it. */
export const loadedOf = (counts: ResourceSummary) =>
  Math.max(0, counts.processed - counts.skipped - counts.failed);
