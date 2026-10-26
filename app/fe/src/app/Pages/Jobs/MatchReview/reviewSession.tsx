import { useQuery, useQueryClient } from '@tanstack/react-query';
import { plainToInstance } from 'class-transformer';
import { useToast } from '@chakra-ui/react';
import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import {
  GetJobDto,
  GetStudentInputDetailsDto,
  GetStudentMatchDecisionDto,
  GetStudentMatchResultsDto,
  StudentRosterDetailsJson,
  StudentSearchDetailsDto,
} from '@edanalytics/models';
import { apiClient } from '../../../api/methods';
import {
  getJobStudentMatchResults,
  useInvalidateJobQueries,
} from '../../../api/queries/job.queries';
import { useMe } from '../../../api/queries/me.queries';
import { SearchHit, SearchTerms, searchDetailsFrom } from './search';

/*
 * One review session per job page, backed by the match-review API: the
 * students and their decisions come from the job's match results, and every
 * decision, search and submission goes to the server. A decision carries its
 * version, which the next write for that student names as `replacesVersion`.
 *
 * Send runs ("batches") have no read endpoint yet (brief PR 5), so a submitted
 * student shows as submitted, without its send run's status.
 */

export type Candidate = {
  studentUniqueId: string;
  rosterDetails: StudentRosterDetailsJson;
  /** IDRS's score, when the candidate came from IDRS. */
  score: number | null;
  source: 'suggestion' | 'search';
  /** A suggestion's place, which a match to it names. */
  resultId?: string;
  ordinal?: number;
  /** A search hit's search, which a match to it stores. */
  searchDetails?: StudentSearchDetailsDto;
};

export type DecisionChoice = { kind: 'match'; candidate: Candidate } | { kind: 'not-in-roster' };

export type Decision = DecisionChoice & { version: number; decidedAt: number; decidedBy: string };

export type MatchDecision = Extract<Decision, { kind: 'match' }>;

/** One resource's counts, as a run's summary reports them. */
export type ResourceSummary = { processed: number; skipped: number; failed: number };

export type BatchItem = { correlationId: string; decision: MatchDecision };

export type BatchStatus = 'queued' | 'processing' | 'complete' | 'complete with errors' | 'failed';

export type Batch = {
  id: number;
  submittedAt: number;
  items: BatchItem[];
  retryOf?: number;
  status: BatchStatus;
  summary?: Record<string, ResourceSummary>;
};

export const isFinished = (batch: Batch) =>
  batch.status !== 'queued' && batch.status !== 'processing';

/** Where each student stands. */
export type StudentStatus =
  | 'to-review'
  | 'ready'
  | 'reprocessing'
  | 'reprocessed'
  | 'run-failed'
  | 'excluded';

export type SearchState = { terms: SearchTerms; hits: SearchHit[] | null };

export type SubmitResult =
  | { ok: true }
  | { ok: false; reason: 'conflict' | 'error'; message: string };

type Session = {
  job: GetJobDto;
  groups: GetStudentInputDetailsDto[];
  /** How many students there are when there are too many to fetch for review, else null. */
  overLimit: number | null;
  isLoading: boolean;
  isError: boolean;
  decisions: Map<string, Decision>;
  batches: Batch[];
  decide: (correlationId: string, decision: DecisionChoice) => Promise<void>;
  undo: (correlationId: string) => Promise<void>;
  statusOf: (correlationId: string) => StudentStatus;
  /** The latest batch this student was submitted in, if any. */
  batchOf: (correlationId: string) => Batch | undefined;
  /** Submits the match decisions among these students as one send run. */
  submit: (correlationIds: string[]) => Promise<SubmitResult>;
  retry: (batchId: number) => void;
  /** Searches IDRS for a student with the reviewer's terms. */
  search: (correlationId: string, terms: SearchTerms) => Promise<SearchHit[]>;
  /** The reviewer's last search for a student, kept for when they come back. */
  searchOf: (correlationId: string) => SearchState | undefined;
  setSearch: (correlationId: string, search: SearchState) => void;
};

const SessionContext = createContext<Session | null>(null);

export const useReviewSession = () => {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useReviewSession must be used inside a ReviewSessionProvider');
  return session;
};

/** An API error body: Nest's, or a coded one from the match-review routes. */
type ApiError = { statusCode?: number; code?: string; message?: string | string[] };
const messageOf = (err: unknown) => {
  const { message } = (err ?? {}) as ApiError;
  return Array.isArray(message) ? message.join('; ') : message ?? 'Something went wrong.';
};

/** The candidate a stored decision rests on: its suggestion, or its search. */
const candidateOf = (
  group: GetStudentInputDetailsDto,
  decision: GetStudentMatchDecisionDto
): Candidate => {
  if (decision.search) {
    return {
      studentUniqueId: decision.studentUniqueId ?? '',
      rosterDetails: decision.search.rosterDetails,
      score: null,
      source: 'search',
      searchDetails: decision.search.searchDetails as StudentSearchDetailsDto,
    };
  }
  const suggestion = group.results
    .find((r) => r.id === decision.resultId)
    ?.suggestions.find((s) => s.ordinal === decision.ordinal);
  return {
    studentUniqueId: decision.studentUniqueId ?? '',
    rosterDetails: suggestion?.rosterDetails ?? {},
    score: suggestion?.score ?? null,
    source: 'suggestion',
    resultId: decision.resultId ?? undefined,
    ordinal: decision.ordinal ?? undefined,
  };
};

const toDecision = (
  group: GetStudentInputDetailsDto,
  decision: GetStudentMatchDecisionDto,
  meId: number | undefined
): Decision => {
  const decidedBy =
    decision.decidedBy?.id === meId ? 'you' : decision.decidedBy?.displayName ?? 'someone';
  const common = { version: decision.version, decidedAt: +decision.decidedOn, decidedBy };
  return decision.kind === 'match'
    ? { kind: 'match', candidate: candidateOf(group, decision), ...common }
    : { kind: 'not-in-roster', ...common };
};

export const ReviewSessionProvider = ({
  job,
  children,
}: {
  job: GetJobDto;
  children: ReactNode;
}) => {
  const jobId = String(job.id);
  const resultsQuery = getJobStudentMatchResults(jobId);
  const { data, isLoading, isError, refetch } = useQuery(resultsQuery);
  const queryClient = useQueryClient();
  const invalidateJob = useInvalidateJobQueries(jobId);
  const toast = useToast();
  const { data: me } = useMe();
  const meId = me?.user?.id;
  const [searches, setSearches] = useState<Map<string, SearchState>>(() => new Map());

  const groups = useMemo(() => data?.students ?? [], [data]);
  const decisions = useMemo(
    () =>
      new Map(
        groups.flatMap((g) =>
          g.decision ? [[g.correlationId, toDecision(g, g.decision, meId)] as const] : []
        )
      ),
    [groups, meId]
  );

  const statusOf = useCallback(
    (correlationId: string): StudentStatus => {
      const group = groups.find((g) => g.correlationId === correlationId);
      return group ? group.status : 'to-review';
    },
    [groups]
  );

  const failed = useCallback(
    (err: unknown) => {
      toast({ status: 'error', title: "Couldn't save that", description: messageOf(err) });
      // A 409 means the page is behind: catch up.
      refetch();
    },
    [refetch, toast]
  );

  /** Writes a decision, then puts the server's answer straight into the cache. */
  const write = useCallback(
    async (correlationId: string, body: object) => {
      const replacesVersion = decisions.get(correlationId)?.version ?? null;
      try {
        const res = (await apiClient.post(
          `/jobs/${jobId}/student-match-results/${encodeURIComponent(correlationId)}/decisions`,
          { replacesVersion, ...body }
        )) as unknown as { decision: GetStudentMatchDecisionDto | null };
        const decision = res.decision && plainToInstance(GetStudentMatchDecisionDto, res.decision);
        const status = !decision ? 'to-review' : decision.kind === 'match' ? 'ready' : 'excluded';
        queryClient.setQueryData<GetStudentMatchResultsDto>(resultsQuery.queryKey, (current) =>
          current?.students
            ? {
                ...current,
                students: current.students.map((g) =>
                  g.correlationId === correlationId ? { ...g, decision, status } : g
                ),
              }
            : current
        );
        invalidateJob();
      } catch (err) {
        failed(err);
      }
    },
    [decisions, failed, invalidateJob, jobId, queryClient, resultsQuery.queryKey]
  );

  const decide = useCallback(
    (correlationId: string, choice: DecisionChoice) => {
      if (choice.kind === 'not-in-roster') return write(correlationId, { kind: 'exclude' });
      const { candidate } = choice;
      return write(
        correlationId,
        candidate.source === 'search'
          ? {
              kind: 'match',
              studentUniqueId: candidate.studentUniqueId,
              search: {
                searchDetails: candidate.searchDetails ?? {},
                rosterDetails: candidate.rosterDetails,
              },
            }
          : { kind: 'match', resultId: candidate.resultId, ordinal: candidate.ordinal }
      );
    },
    [write]
  );

  const undo = useCallback(
    (correlationId: string) => write(correlationId, { kind: 'clear' }),
    [write]
  );

  const submit = useCallback(
    async (correlationIds: string[]): Promise<SubmitResult> => {
      const students = correlationIds.flatMap((correlationId) => {
        const decision = decisions.get(correlationId);
        return decision?.kind === 'match' ? [{ correlationId, version: decision.version }] : [];
      });
      if (!students.length) return { ok: true };
      try {
        await apiClient.post(`/jobs/${jobId}/student-match-results/submit`, { students });
        invalidateJob();
        return { ok: true };
      } catch (err) {
        refetch();
        const code = (err as ApiError)?.code;
        return {
          ok: false,
          reason: code === 'decision_changed' ? 'conflict' : 'error',
          message: messageOf(err),
        };
      }
    },
    [decisions, invalidateJob, jobId, refetch]
  );

  const search = useCallback(
    async (correlationId: string, terms: SearchTerms): Promise<SearchHit[]> => {
      const searchDetails = searchDetailsFrom(terms);
      const found = (await apiClient.post(
        `/jobs/${jobId}/student-match-results/${encodeURIComponent(correlationId)}/search`,
        searchDetails
      )) as unknown as Omit<SearchHit, 'searchDetails'>[];
      return found.map((hit) => ({ ...hit, searchDetails }));
    },
    [jobId]
  );

  const searchOf = useCallback((correlationId: string) => searches.get(correlationId), [searches]);
  const setSearch = useCallback((correlationId: string, state: SearchState) => {
    setSearches((current) => new Map(current).set(correlationId, state));
  }, []);

  const session: Session = {
    job,
    groups,
    overLimit: data && !data.students ? data.counts.total : null,
    isLoading,
    isError,
    decisions,
    batches: [],
    decide,
    undo,
    statusOf,
    batchOf: () => undefined,
    submit,
    retry: () => undefined,
    search,
    searchOf,
    setSearch,
  };
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
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
