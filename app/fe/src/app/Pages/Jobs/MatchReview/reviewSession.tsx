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
  GetRunDto,
  GetStudentInputDetailsDto,
  GetStudentMatchBatchDto,
  PostStudentMatchBatchDto,
  PostStudentMatchBatchResponseDto,
  PostStudentMatchDecisionDto,
  PostStudentMatchDecisionResponseDto,
  StudentRosterDetailsJson,
  StudentSearchDetailsDto,
} from '@edanalytics/models';
import { methods } from '../../../api/methods';
import {
  getJobStudentMatchBatches,
  getJobStudentMatchResults,
} from '../../../api/queries/job.queries';
import { useMe } from '../../../api/queries/me.queries';
import { SearchHit, SearchTerms, searchIdrs, toSearchDetails } from './idrsSearch';

/*
 * PROTOTYPE. One review session per job page, shared by every review design
 * so a decision made on one tab shows on the others. Everything is on the
 * real API: decisions save to the server, searches go to IDRS through the
 * app, and submitting creates a batch and its send run. A batch's status
 * comes from its run, read from the job's runs. Retrying a failed batch is
 * PR 5 and isn't built. Searches are remembered for this visit only.
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

export type Batch = {
  id: number;
  /** The send run that delivers the batch. */
  runId: number | null;
  submittedAt: number;
  /** "you", another reviewer's name, or "a deleted user". */
  submittedBy: string;
  /** How many students the batch submitted, from the server. */
  memberCount: number;
  /**
   * The batch's students as this page knows them: only those it submitted in
   * this visit. The batch read returns a count, not its members.
   */
  items: BatchItem[];
  /** The batch this one retries, if any. Not built (PR 5). */
  retryOf?: number;
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
   * Submits the saved matches among these students as one batch, with the
   * versions this page saw. Refused when a decision changed on the server
   * since this page loaded it.
   */
  submit: (correlationIds: string[]) => Promise<SubmitResult>;
  /** Sends a failed batch's choices again, as a new batch. Not built (PR 5). */
  retry: (batchId: number) => void;
  /** The reviewer's last search for a student, kept for when they come back. */
  searchOf: (correlationId: string) => SearchState | undefined;
  setSearch: (correlationId: string, search: SearchState) => void;
  /** Searches IDRS for the student. Null when the search failed; the reviewer is told why. */
  search: (correlationId: string, terms: SearchTerms) => Promise<SearchHit[] | null>;
  /** Set when a submission was refused over a conflicting change. */
  submitConflict: boolean;
  /**
   * Clears every unsubmitted decision, on the server too, and this visit's
   * searches. Submitted matches and batches stay: they're final.
   */
  reset: () => void;
};

const SessionContext = createContext<Session | null>(null);

export const useReviewSession = () => {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useReviewSession must be used inside a ReviewSessionProvider');
  return session;
};

export type SubmitResult = { ok: true } | { ok: false; reason: 'conflict' | 'error' };

/** How often to re-read batches and the job's runs while a batch is unfinished. */
const BATCH_POLL_MS = 5000;

export const ReviewSessionProvider = ({
  job,
  children,
}: {
  job: GetJobDto;
  children: ReactNode;
}) => {
  const { data, isLoading, isError } = useQuery(getJobStudentMatchResults(String(job.id)));
  const [polling, setPolling] = useState(false);
  const { data: batchData } = useQuery({
    ...getJobStudentMatchBatches(String(job.id)),
    refetchInterval: polling ? BATCH_POLL_MS : false,
  });
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const toast = useToast();
  const groups = useMemo(() => data?.students ?? [], [data]);
  const [decisions, setDecisions] = useState<Map<string, Decision>>(() => new Map());
  const [searches, setSearches] = useState<Map<string, SearchState>>(() => new Map());
  const [submitConflict, setSubmitConflict] = useState(false);
  // Which batch each student went in, for students this page submitted. The
  // batch read doesn't list members.
  const [submittedIn, setSubmittedIn] = useState<Map<string, BatchItem & { batchId: number }>>(
    () => new Map()
  );

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
    const next = new Map<string, Decision>();
    for (const student of data.students) {
      const decision = fromServer(student, me?.user.id);
      if (decision) next.set(student.correlationId, decision);
    }
    setDecisions(next);
  }, [data, me?.user.id]);

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['jobs', String(job.id), 'student-match-results'],
      }),
      queryClient.invalidateQueries({
        queryKey: ['jobs', String(job.id), 'student-match-batches'],
      }),
      queryClient.invalidateQueries({ queryKey: ['jobs', `detail-${job.id}`] }),
      queryClient.invalidateQueries({ queryKey: ['jobs', 'list'] }),
    ]);
  }, [queryClient, job.id]);

  const saveDecision = useCallback(
    (correlationId: string, choice: DecisionChoice | null) => {
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
    [job.id, toast, refresh]
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

  const batches = useMemo<Batch[]>(
    () =>
      (batchData?.batches ?? []).map((batch) =>
        toBatch(
          batch,
          job.runs.find((run) => run.id === batch.runId),
          me?.user.id,
          [...submittedIn.values()].filter((it) => it.batchId === batch.id)
        )
      ),
    [batchData, job.runs, me?.user.id, submittedIn]
  );

  // Re-read batches and the job's runs while a batch is unfinished, so its
  // status moves along.
  const unfinished = batches.some((batch) => !isFinished(batch));
  useEffect(() => setPolling(unfinished), [unfinished]);
  useEffect(() => {
    if (!unfinished) return;
    const timer = setInterval(
      () => queryClient.invalidateQueries({ queryKey: ['jobs', `detail-${job.id}`] }),
      BATCH_POLL_MS
    );
    return () => clearInterval(timer);
  }, [unfinished, queryClient, job.id]);

  const batchOf = useCallback(
    (correlationId: string) => {
      const known = submittedIn.get(correlationId);
      return known ? batches.find((b) => b.id === known.batchId) : undefined;
    },
    [batches, submittedIn]
  );

  const statusOf = useCallback(
    (correlationId: string): StudentStatus => {
      // Submitted is the server's to say, and final: a submitted match can't
      // be decided again.
      if (serverStudents.get(correlationId)?.status === 'reprocessing') return 'reprocessing';
      const decision = decisions.get(correlationId);
      if (decision) return decision.kind === 'match' ? 'ready' : 'excluded';
      return 'to-review';
    },
    [decisions, serverStudents]
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

  const submit = useCallback(
    async (correlationIds: string[]): Promise<SubmitResult> => {
      // Let saves still in flight settle, so each version is the latest.
      await Promise.all(saves.current.values());
      const items = correlationIds.flatMap((correlationId) => {
        const decision = decisions.get(correlationId);
        const version = versions.current.get(correlationId);
        return decision?.kind === 'match' && version != null
          ? [{ correlationId, version, decision }]
          : [];
      });
      if (!items.length) return { ok: true };
      try {
        const { batch } = await methods.post(
          `/jobs/${job.id}/student-match-batches`,
          PostStudentMatchBatchDto,
          PostStudentMatchBatchResponseDto,
          { students: items.map(({ correlationId, version }) => ({ correlationId, version })) }
        );
        setSubmittedIn((current) => {
          const next = new Map(current);
          for (const { correlationId, decision } of items)
            next.set(correlationId, { correlationId, decision, batchId: batch.id });
          return next;
        });
        setSubmitConflict(false);
        return { ok: true };
      } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        if (code === 'decision_changed' || code === 'not_ready') {
          setSubmitConflict(true);
          return { ok: false, reason: 'conflict' };
        }
        toast({
          status: 'error',
          title: "Couldn't submit",
          description: describeError(error),
          isClosable: true,
        });
        return { ok: false, reason: 'error' };
      } finally {
        await refresh();
      }
    },
    [decisions, job.id, toast, refresh]
  );

  const retry = useCallback(
    (_batchId: number) => {
      toast({
        status: 'info',
        title: 'Retrying a batch isn’t built yet',
        description: 'Retrying a failed batch comes with PR 5 (outcomes).',
        isClosable: true,
      });
    },
    [toast]
  );

  const searchOf = useCallback((correlationId: string) => searches.get(correlationId), [searches]);
  const setSearch = useCallback((correlationId: string, search: SearchState) => {
    setSearches((current) => new Map(current).set(correlationId, search));
  }, []);

  const reset = useCallback(() => {
    for (const correlationId of decisions.keys())
      if (statusOf(correlationId) !== 'reprocessing') undo(correlationId);
    setSearches(new Map());
    setSubmitConflict(false);
  }, [decisions, undo, statusOf]);

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

/** A batch as the review designs show one, its status from its send run. */
const toBatch = (
  batch: GetStudentMatchBatchDto,
  run: GetRunDto | undefined,
  meId: number | undefined,
  items: BatchItem[]
): Batch => {
  const summary = run?.summary ? toResourceSummaries(run.summary) : undefined;
  const status: BatchStatus =
    !run || run.status === 'new'
      ? 'queued'
      : run.status === 'running'
      ? 'processing'
      : run.status === 'error'
      ? 'failed'
      : Object.values(summary ?? {}).some((r) => r.failed > 0)
      ? 'complete with errors'
      : 'complete';
  return {
    id: batch.id,
    runId: batch.runId,
    submittedAt: new Date(batch.submittedOn).getTime(),
    submittedBy:
      batch.submittedBy?.id === meId
        ? 'you'
        : batch.submittedBy
        ? `${batch.submittedBy.givenName} ${batch.submittedBy.familyName}`
        : 'a deleted user',
    memberCount: batch.memberCount,
    items,
    status,
    summary,
  };
};

/** A run's summary as per-resource counts. */
const toResourceSummaries = (
  summary: NonNullable<GetRunDto['summary']>
): Record<string, ResourceSummary> =>
  Object.fromEntries(
    Object.entries(summary as Record<string, Record<string, number>>).map(([resource, counts]) => [
      resource,
      {
        processed: counts['records_processed'] ?? 0,
        skipped: counts['records_skipped'] ?? 0,
        failed: counts['records_failed'] ?? 0,
      },
    ])
  );

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
    case 'first_run_not_done':
      return "The job's first run hasn't finished successfully, so nothing can be submitted yet.";
  }
  if (body.statusCode === 403)
    return 'Decisions and searches work only on fuzzy jobs, for users who can review them.';
  return typeof body.message === 'string' ? body.message : 'Something went wrong.';
};

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
