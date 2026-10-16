import { useToast } from '@chakra-ui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  GetJobDto,
  GetStudentInputDetailsDto,
  PostStudentMatchDecisionDto,
  PostStudentMatchDecisionResponseDto,
  StudentRosterDetailsJson,
  StudentSearchDetailsDto,
} from '@edanalytics/models';
import { methods } from '../../../api/methods';
import { getJobStudentMatchResults } from '../../../api/queries/job.queries';
import { useMe } from '../../../api/queries/me.queries';
import { SearchHit, SearchTerms, searchIdrs, toSearchDetails } from './idrsSearch';
import { syntheticStudents } from './syntheticStudents';

/*
 * PROTOTYPE. One review session per job page, shared by every review design
 * so a decision made on one tab shows on the others. Decisions and searches
 * are real: decisions save to the server, and searches go to IDRS through
 * the app. Submitting and reprocessing batches are still simulated, kept in
 * this browser's storage, and a batch's progress is worked out from the
 * clock, so it survives a reload.
 *
 * A run reports only a summary: per resource, how many records it processed,
 * skipped and failed. It can't say which students those records belong to,
 * so a batch's outcome belongs to the batch, never to a student. A delivery
 * failure doesn't undo a match decision either; like a job that completes
 * with errors today, it's resolved out of band.
 */

/** A student a reviewer can match to, and how to name it when saving the match. */
export type Candidate = {
  studentUniqueId: string;
  rosterDetails: StudentRosterDetailsJson;
  /**
   * IDRS's score. Null for a saved match to a search hit: the server doesn't
   * store a hit's score, since it measures the hit against the search terms,
   * not the file.
   */
  score: number | null;
} & (
  | { source: 'suggestion'; resultId: string; ordinal: number }
  | { source: 'search'; searchDetails: StudentSearchDetailsDto }
);

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
  /** How many students there are when there are too many to fetch for review, else null. */
  overLimit: number | null;
  isLoading: boolean;
  isError: boolean;
  /**
   * Shown at once, then saved to the server in the background; the server's
   * view replaces this once every save has settled. `decidedBy` is "you" or
   * another reviewer's name.
   */
  decisions: Map<string, Decision>;
  batches: Batch[];
  decide: (correlationId: string, decision: DecisionChoice) => void;
  /** Clears the student's decision, returning them to review. */
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
  /** Searches IDRS for the student. Null when the search failed; the reviewer is told why. */
  search: (correlationId: string, terms: SearchTerms) => Promise<SearchHit[] | null>;
  /** Prototype control: make the next batch's run fail outright. */
  /** Prototype control: add a large job's worth of made-up students. */
  simulateLarge: boolean;
  setSimulateLarge: (large: boolean) => void;
  failNextRun: boolean;
  setFailNextRun: (fail: boolean) => void;
  /** Prototype control: make the next submission find a conflicting change. */
  conflictNextSubmit: boolean;
  setConflictNextSubmit: (conflict: boolean) => void;
  /** Set when a submission was refused over a conflicting change. */
  submitConflict: boolean;
  /** Clears every decision, on the server too, and the simulated batches and searches. */
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
  batches: StoredBatch[];
  searches: [string, SearchState][];
};

const storageKey = (jobId: number) => `runway.match-review-prototype.${jobId}`;

const load = (jobId: number): Stored | null => {
  try {
    const raw = window.localStorage.getItem(storageKey(jobId));
    if (!raw) return null;
    const stored = JSON.parse(raw) as Stored;
    // Drop searches from the pretend roster: their hits can't be saved.
    stored.searches = stored.searches.filter(
      ([, s]) => !s.hits || s.hits.every((hit) => 'searchDetails' in hit)
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
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [simulateLarge, setSimulateLargeState] = useState(() => {
    try {
      return window.localStorage.getItem(`${storageKey(job.id)}.large`) === 'on';
    } catch {
      return false;
    }
  });
  const setSimulateLarge = (large: boolean) => {
    setSimulateLargeState(large);
    try {
      window.localStorage.setItem(`${storageKey(job.id)}.large`, large ? 'on' : 'off');
    } catch {
      // A convenience; the control still works for this visit.
    }
  };
  const groups = useMemo(
    () => [
      ...(data?.students ?? []),
      ...(simulateLarge ? syntheticStudents(240, job.lastRun?.id ?? 0) : []),
    ],
    [data, simulateLarge, job.lastRun?.id]
  );
  const [initial] = useState(() => load(job.id));
  const [decisions, setDecisions] = useState<Map<string, Decision>>(() => new Map());
  const [stored, setStored] = useState<StoredBatch[]>(() => initial?.batches ?? []);
  const [searches, setSearches] = useState<Map<string, SearchState>>(
    () => new Map(initial?.searches ?? [])
  );
  const [failNextRun, setFailNextRun] = useState(false);
  const [conflictNextSubmit, setConflictNextSubmit] = useState(false);
  const [submitConflict, setSubmitConflict] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    save(job.id, { batches: stored, searches: [...searches] });
  }, [job.id, stored, searches]);

  // Students the server knows; the simulated large file's students are
  // decided in this page only.
  const serverStudents = useMemo(
    () => new Map((data?.students ?? []).map((s) => [s.correlationId, s])),
    [data]
  );
  // Each student's current version, as the last save or read left it: what
  // the next save replaces.
  const versions = useRef(new Map<string, number | null>());
  // Saves run one at a time per student, so each names the version the one
  // before it made.
  const saves = useRef(new Map<string, Promise<void>>());
  const unsettled = useRef(0);

  // The server's decisions replace the page's, unless saves are still out.
  useEffect(() => {
    if (!data?.students || unsettled.current > 0) return;
    versions.current = new Map(
      data.students.map((s) => [s.correlationId, s.decision?.version ?? null])
    );
    setDecisions((current) => {
      const next = new Map([...current].filter(([id]) => !serverStudents.has(id)));
      for (const student of data.students ?? []) {
        const decision = fromServer(student, me?.user.id);
        if (decision) next.set(student.correlationId, decision);
      }
      return next;
    });
  }, [data, me?.user.id, serverStudents]);

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['jobs', String(job.id), 'student-match-results'],
      }),
      queryClient.invalidateQueries({ queryKey: ['jobs', `detail-${job.id}`] }),
      queryClient.invalidateQueries({ queryKey: ['jobs', 'list'] }),
    ]);
  }, [queryClient, job.id]);

  const saveDecision = useCallback(
    (correlationId: string, choice: DecisionChoice | null) => {
      if (!serverStudents.has(correlationId)) return;
      unsettled.current++;
      const previous = saves.current.get(correlationId) ?? Promise.resolve();
      const next = previous.then(async () => {
        try {
          const replacesVersion = versions.current.get(correlationId) ?? null;
          // Nothing to clear: the student is already undecided.
          if (!choice && replacesVersion === null) return;
          const { decision } = await methods.post(
            `/jobs/${job.id}/student-match-results/${encodeURIComponent(correlationId)}/decisions`,
            PostStudentMatchDecisionDto,
            PostStudentMatchDecisionResponseDto,
            { replacesVersion, ...decisionBody(choice) }
          );
          versions.current.set(correlationId, decision?.version ?? null);
        } catch (error) {
          toast({
            status: 'error',
            title: "Couldn't save that decision",
            description: describeError(error),
            isClosable: true,
          });
        } finally {
          unsettled.current--;
          if (unsettled.current === 0) await refresh();
        }
      });
      saves.current.set(correlationId, next);
    },
    [serverStudents, job.id, toast, refresh]
  );

  const search = useCallback(
    async (correlationId: string, terms: SearchTerms) => {
      try {
        return await searchIdrs(job.id, correlationId, toSearchDetails(terms));
      } catch (error) {
        toast({
          status: 'error',
          title: "Couldn't search",
          description: describeError(error),
          isClosable: true,
        });
        return null;
      }
    },
    [job.id, toast]
  );

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

  /**
   * What the pretend run's summary reports for a batch: every record loads.
   * Suggestions IDRS returns are already limited to students the job's year
   * can load, so a run fails only when the prototype control says so.
   */
  const summarize = useCallback(
    (items: BatchItem[]): Record<string, ResourceSummary> => ({
      studentAssessments: {
        processed: items.reduce((sum, { correlationId }) => sum + recordsFor(correlationId), 0),
        skipped: 0,
        failed: 0,
      },
    }),
    []
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
    (correlationId: string, decision: DecisionChoice) => {
      setDecisions((current) =>
        new Map(current).set(correlationId, {
          ...decision,
          decidedAt: Date.now(),
          decidedBy: 'you',
        })
      );
      saveDecision(correlationId, decision);
    },
    [saveDecision]
  );

  const undo = useCallback(
    (correlationId: string) => {
      setDecisions((current) => {
        const next = new Map(current);
        next.delete(correlationId);
        return next;
      });
      saveDecision(correlationId, null);
    },
    [saveDecision]
  );

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
        setSubmitConflict(true);
        return { ok: false, reason: 'conflict' };
      }
      setSubmitConflict(false);
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
    for (const correlationId of decisions.keys()) undo(correlationId);
    setStored([]);
    setSearches(new Map());
    setFailNextRun(false);
    setConflictNextSubmit(false);
    setSubmitConflict(false);
    save(job.id, null);
  }, [decisions, undo, job.id]);

  const session: Session = {
    job,
    groups,
    overLimit: data && !data.students ? data.counts.total : null,
    isLoading,
    isError,
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
    search,
    simulateLarge,
    setSimulateLarge,
    failNextRun,
    setFailNextRun,
    conflictNextSubmit,
    setConflictNextSubmit,
    submitConflict,
    reset,
  };
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
};

/**
 * Every candidate IDRS suggested for a student in its latest search, best
 * first. Results come ordered by run, and a match can only pick from the last.
 */
export const suggestedCandidates = (group: GetStudentInputDetailsDto): Candidate[] => {
  const latest = group.results[group.results.length - 1];
  return (latest?.suggestions ?? [])
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((suggestion) => ({
      studentUniqueId: suggestion.studentUniqueId,
      rosterDetails: suggestion.rosterDetails,
      score: suggestion.score,
      source: 'suggestion' as const,
      resultId: latest.id,
      ordinal: suggestion.ordinal,
    }));
};

/** The student's saved decision, as the review designs show one. */
const fromServer = (
  student: GetStudentInputDetailsDto,
  meId: number | undefined
): Decision | undefined => {
  const saved = student.decision;
  if (!saved) return undefined;
  const decidedBy =
    saved.decidedBy?.id === meId
      ? 'you'
      : saved.decidedBy
      ? `${saved.decidedBy.givenName} ${saved.decidedBy.familyName}`
      : 'a deleted user';
  const stamp = { decidedAt: new Date(saved.decidedOn).getTime(), decidedBy };
  if (saved.kind === 'exclude') return { kind: 'not-in-roster', ...stamp };
  if (saved.search) {
    const { rosterDetails, searchDetails } = saved.search;
    return {
      kind: 'match',
      candidate: {
        studentUniqueId: saved.studentUniqueId as string,
        rosterDetails,
        score: null,
        source: 'search',
        // Stored as search sent it, so it's search details.
        searchDetails: searchDetails as StudentSearchDetailsDto,
      },
      ...stamp,
    };
  }
  const suggestion = student.results
    .find((result) => result.id === saved.resultId)
    ?.suggestions.find((s) => s.ordinal === saved.ordinal);
  if (!suggestion) return undefined;
  return {
    kind: 'match',
    candidate: {
      studentUniqueId: suggestion.studentUniqueId,
      rosterDetails: suggestion.rosterDetails,
      score: suggestion.score,
      source: 'suggestion',
      resultId: saved.resultId as string,
      ordinal: suggestion.ordinal,
    },
    ...stamp,
  };
};

/** The decisions endpoint's body for a choice, or for a clear. */
const decisionBody = (
  choice: DecisionChoice | null
): Omit<PostStudentMatchDecisionDto, 'replacesVersion'> => {
  if (!choice) return { kind: 'clear' };
  if (choice.kind === 'not-in-roster') return { kind: 'exclude' };
  const { candidate } = choice;
  return candidate.source === 'suggestion'
    ? { kind: 'match', resultId: candidate.resultId, ordinal: candidate.ordinal }
    : {
        kind: 'match',
        studentUniqueId: candidate.studentUniqueId,
        search: { searchDetails: candidate.searchDetails, rosterDetails: candidate.rosterDetails },
      };
};

/** A failed request, in a sentence for the reviewer. */
const describeError = (error: unknown): string => {
  const body = (error ?? {}) as { statusCode?: number; code?: string; message?: unknown };
  switch (body.code) {
    case 'decision_changed':
      return 'Someone else changed this decision. Showing the latest.';
    case 'results_changed':
      return 'IDRS searched for this student again. Showing the latest suggestions.';
    case 'identity_service_unavailable':
      return "IDRS couldn't answer. Try again in a moment.";
    case 'not_found':
      return "This student isn't in the job.";
  }
  if (body.statusCode === 403)
    return 'Decisions and searches work only on fuzzy jobs, for users who can review them.';
  return typeof body.message === 'string' ? body.message : 'Something went wrong.';
};

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
