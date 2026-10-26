import { useQuery, useQueryClient } from '@tanstack/react-query';
import { plainToInstance } from 'class-transformer';
import { useToast } from '@chakra-ui/react';
import { isEqual } from 'lodash';
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
  GetSendRunDto,
  PostStudentMatchSubmitResponseDto,
  GetStudentInputDetailsDto,
  GetStudentMatchCountsDto,
  GetStudentMatchDecisionDto,
  GetStudentMatchResultsDto,
  StudentRosterDetailsJson,
  StudentSearchDetailsDto,
  StudentMatchStatus,
  studentMatchStatus,
} from '@edanalytics/models';
import { apiClient } from '../../../api/methods';
import { getJobStudentMatchResults } from '../../../api/queries/job.queries';
import { SearchHit, SearchTerms, searchDetailsFrom } from './search';
import { studentsToResend, SubmitRefusal, submitRefusal, wroteNothing } from './sendRun';

/*
 * One review session per job page, backed by the match-review API: the
 * students and their decisions come from the job's match results, and every
 * decision, search and submission goes to the server. A decision carries its
 * version, which the next write for that student names as `replacesVersion`.
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

export type DecisionChoice = { kind: 'match'; candidate: Candidate } | { kind: 'exclude' };

/** How each status reads on the page. */
export const statusLabel: Record<StudentMatchStatus, string> = {
  'to-review': 'Needs review',
  ready: 'Ready to submit',
  excluded: 'Excluded',
  reprocessing: 'Reprocessing',
  reprocessed: 'Reprocessed',
  'run-failed': 'Run failed',
};

/** Where each status's count is in the review read's `counts`. */
export const countOf = (counts: GetStudentMatchCountsDto, status: StudentMatchStatus) =>
  ({
    'to-review': counts.toReview,
    ready: counts.ready,
    excluded: counts.excluded,
    reprocessing: counts.reprocessing,
    reprocessed: counts.reprocessed,
    'run-failed': counts.runFailed,
  }[status]);

/**
 * Whether the job page has match review: a `fuzzy` job the Executor has sent
 * students to review for. Other jobs make no review request.
 */
export const hasMatchReview = (job: GetJobDto) =>
  job.idMatchingMode === 'fuzzy' && job.studentMatchCounts.total > 0;

export type SearchState = { terms: SearchTerms; hits: SearchHit[] | null };

/**
 * A decision write's outcome: the version it wrote (null after a clear,
 * which leaves no decision), or why it was refused.
 */
export type DecisionResult = { ok: true; version: number | null } | { ok: false; message: string };

/** A student as submit takes them: their correlation id and their match's version. */
export type SubmitStudent = { correlationId: string; version: number };

/**
 * A submit's outcome. A refusal says which students it refused and why.
 * `nothingSubmitted` says whether the failure certainly wrote nothing, as a
 * refusal or any other client error does; a 5xx after the submit committed,
 * or a lost response, leaves it unknown. Either way, `refreshed` says
 * whether the page has caught up since. A submit whose run couldn't start
 * still stands.
 */
export type SubmitResult =
  | { ok: true }
  | {
      ok: false;
      refusal: SubmitRefusal<SubmitStudent> | null;
      nothingSubmitted: boolean;
      message: string;
      refreshed: boolean;
    };

type Session = {
  job: GetJobDto;
  students: GetStudentInputDetailsDto[];
  /** How many students have each status. */
  counts: GetStudentMatchCountsDto;
  /** Whether there are too many students to fetch for review; the counts still come. */
  overLimit: boolean;
  isLoading: boolean;
  isError: boolean;
  /** The job's send runs, newest first. */
  sendRuns: GetSendRunDto[];
  /**
   * Saves a decision over the one at `replacesVersion` (null for none), which
   * the API refuses if it's no longer current.
   */
  decide: (
    correlationId: string,
    decision: DecisionChoice,
    replacesVersion: number | null
  ) => Promise<DecisionResult>;
  /** Clears the decision at `replacesVersion`, leaving the student undecided. */
  clear: (correlationId: string, replacesVersion: number | null) => Promise<DecisionResult>;
  /** Submits the match decisions among these students as one send run. */
  submit: (correlationIds: string[]) => Promise<SubmitResult>;
  /**
   * Why nothing can be submitted yet, or null when it can. Submit needs the
   * job's full run to have succeeded: its results are what's reviewed, and its
   * files are what a send run delivers from.
   */
  submitBlocked: string | null;
  /** Submits a failed send run's students again, as a new send run. */
  resend: (sendRunId: number) => Promise<SubmitResult>;
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

export const ReviewSessionProvider = ({
  job,
  children,
}: {
  job: GetJobDto;
  children: ReactNode;
}) => {
  const jobId = String(job.id);
  const resultsQuery = getJobStudentMatchResults(jobId);
  const { data, isLoading, isError, refetch } = useQuery({
    ...resultsQuery,
    enabled: hasMatchReview(job),
    // A send run's outcome changes its students' statuses with nothing on
    // the page to prompt a refetch, so poll while one is in flight. React
    // Query stops on unmount, and pauses while the browser tab is hidden.
    refetchInterval: (query) => (query.state.data?.counts.reprocessing ? 5000 : false),
  });
  const queryClient = useQueryClient();
  // Where the job's status, counts and combined summary show: its page and
  // the jobs table. Not this read, which is what changed.
  const refreshJob = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['jobs', `detail-${jobId}`] });
    queryClient.invalidateQueries({ queryKey: ['jobs', 'list'] });
  }, [jobId, queryClient]);
  const toast = useToast();
  const [searches, setSearches] = useState<Map<string, SearchState>>(() => new Map());

  // When the counts change, so may the job: its status, its counts and, after
  // a send run, its combined summary. This is the one path that refreshes the
  // job: decisions and submits refetch this read, and its counts say whether
  // anything about the job changed. The first load changes nothing.
  const previousCounts = useRef<GetStudentMatchCountsDto>();
  useEffect(() => {
    if (!data) return;
    const previous = previousCounts.current;
    previousCounts.current = data.counts;
    if (previous && !isEqual(previous, data.counts)) refreshJob();
  }, [data, refreshJob]);

  const students = useMemo(() => data?.students ?? [], [data]);
  const sendRuns = useMemo(() => data?.sendRuns ?? [], [data]);

  /** Writes a decision, then puts the server's answer straight into the cache. */
  const write = useCallback(
    async (
      correlationId: string,
      body: object,
      replacesVersion: number | null
    ): Promise<DecisionResult> => {
      try {
        const res = (await apiClient.post(
          `/jobs/${jobId}/student-match-results/${encodeURIComponent(correlationId)}/decisions`,
          { replacesVersion, ...body }
        )) as unknown as { decision: GetStudentMatchDecisionDto | null };
        const decision = res.decision && plainToInstance(GetStudentMatchDecisionDto, res.decision);
        // Not yet in a send run: the API refuses a decision for a student who is.
        const status = studentMatchStatus(decision?.kind, undefined);
        queryClient.setQueryData<GetStudentMatchResultsDto>(resultsQuery.queryKey, (current) =>
          current?.students
            ? {
                ...current,
                students: current.students.map((student) =>
                  student.correlationId === correlationId
                    ? { ...student, decision, status }
                    : student
                ),
              }
            : current
        );
        // For the counts, which the cache update leaves as they were.
        refetch();
        return { ok: true, version: decision?.version ?? null };
      } catch (err) {
        // A refusal means the page is behind: catch up before saying so.
        await refetch();
        return { ok: false, message: messageOf(err) };
      }
    },
    [jobId, queryClient, refetch, resultsQuery.queryKey]
  );

  const decide = useCallback(
    (correlationId: string, choice: DecisionChoice, replacesVersion: number | null) => {
      if (choice.kind === 'exclude') {
        return write(correlationId, { kind: 'exclude' }, replacesVersion);
      }
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
          : { kind: 'match', resultId: candidate.resultId, ordinal: candidate.ordinal },
        replacesVersion
      );
    },
    [write]
  );

  const clear = useCallback(
    (correlationId: string, replacesVersion: number | null) =>
      write(correlationId, { kind: 'clear' }, replacesVersion),
    [write]
  );

  /** Creates a send run for these students' decisions, at the versions given. */
  const send = useCallback(
    async (students: SubmitStudent[]): Promise<SubmitResult> => {
      try {
        const { launched } = (await apiClient.post(`/jobs/${jobId}/student-match-results/submit`, {
          students,
        })) as unknown as PostStudentMatchSubmitResponseDto;
        // Done once the page shows the submission, so nothing offers to
        // submit its students again meanwhile.
        await refetch();
        if (!launched) {
          // The submit stands, and its students are run-failed: sending again
          // at once would most likely fail the same way.
          toast({
            status: 'warning',
            title: 'Submitted, but its run couldn’t start',
            description:
              'Contact support from the submission, above. You can send it again from there once the cause is fixed.',
            duration: 15000,
            isClosable: true,
          });
        }
        return { ok: true };
      } catch (err) {
        // A refusal means the page is behind, and any other failure may have
        // submitted: catch up before saying what's known.
        const { isError } = await refetch();
        return {
          ok: false,
          refusal: submitRefusal(err, students),
          nothingSubmitted: wroteNothing(err),
          message: messageOf(err),
          refreshed: !isError,
        };
      }
    },
    [jobId, refetch, toast]
  );

  const submit = useCallback(
    (correlationIds: string[]) =>
      send(
        correlationIds.flatMap((correlationId) => {
          const { decision } =
            students.find((student) => student.correlationId === correlationId) ?? {};
          return decision?.kind === 'match' ? [{ correlationId, version: decision.version }] : [];
        })
      ),
    [send, students]
  );

  const resend = useCallback(
    (sendRunId: number) => send(studentsToResend(students, sendRunId)),
    [send, students]
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
    students,
    // The job's own counts stand in until the review read arrives.
    counts: data?.counts ?? job.studentMatchCounts,
    overLimit: !!data && !data.students,
    isLoading,
    isError,
    sendRuns,
    decide,
    clear,
    submit,
    submitBlocked:
      job.fullRun?.status === 'success'
        ? null
        : job.fullRun?.status === 'error'
        ? 'The job’s processing failed, so its matches can’t be submitted.'
        : 'You can submit once the job finishes processing.',
    resend,
    search,
    searchOf,
    setSearch,
  };
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
};
