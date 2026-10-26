import { useQuery, useQueryClient } from '@tanstack/react-query';
import { plainToInstance } from 'class-transformer';
import { useToast } from '@chakra-ui/react';
import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import {
  GetJobDto,
  GetSendRunDto,
  GetStudentInputDetailsDto,
  GetStudentMatchCountsDto,
  GetStudentMatchDecisionDto,
  GetStudentMatchResultsDto,
  StudentRosterDetailsJson,
  StudentSearchDetailsDto,
  StudentMatchStatus,
} from '@edanalytics/models';
import { apiClient } from '../../../api/methods';
import {
  getJobStudentMatchResults,
  useInvalidateJobQueries,
} from '../../../api/queries/job.queries';
import { useMe } from '../../../api/queries/me.queries';
import { SearchHit, SearchTerms, searchDetailsFrom } from './search';
import { studentsToResend } from './sendRun';

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

export type Decision = DecisionChoice & { version: number; decidedAt: number; decidedBy: string };

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

export type SubmitResult =
  | { ok: true }
  | { ok: false; reason: 'conflict' | 'error'; message: string };

type Session = {
  job: GetJobDto;
  students: GetStudentInputDetailsDto[];
  /** How many students have each status. */
  counts: GetStudentMatchCountsDto;
  /** Whether there are too many students to fetch for review; the counts still come. */
  overLimit: boolean;
  isLoading: boolean;
  isError: boolean;
  decisions: Map<string, Decision>;
  /** The job's send runs, newest first. */
  sendRuns: GetSendRunDto[];
  decide: (correlationId: string, decision: DecisionChoice) => Promise<void>;
  undo: (correlationId: string) => Promise<void>;
  statusOf: (correlationId: string) => StudentMatchStatus;
  /** The send run that decides this student's status, if they've been submitted. */
  sendRunOf: (correlationId: string) => GetSendRunDto | undefined;
  /** Submits the match decisions among these students as one send run. */
  submit: (correlationIds: string[]) => Promise<SubmitResult>;
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

/** The candidate a stored decision rests on: its suggestion, or its search. */
const candidateOf = (
  student: GetStudentInputDetailsDto,
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
  const suggestion = student.results
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
  student: GetStudentInputDetailsDto,
  decision: GetStudentMatchDecisionDto,
  meId: number | undefined
): Decision => {
  const decidedBy =
    decision.decidedBy?.id === meId ? 'you' : decision.decidedBy?.displayName ?? 'someone';
  const common = { version: decision.version, decidedAt: +decision.decidedOn, decidedBy };
  return decision.kind === 'match'
    ? { kind: 'match', candidate: candidateOf(student, decision), ...common }
    : { kind: 'exclude', ...common };
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
  });
  const queryClient = useQueryClient();
  const invalidateJob = useInvalidateJobQueries(jobId);
  const toast = useToast();
  const { data: me } = useMe();
  const meId = me?.user?.id;
  const [searches, setSearches] = useState<Map<string, SearchState>>(() => new Map());

  const students = useMemo(() => data?.students ?? [], [data]);
  const sendRuns = useMemo(() => data?.sendRuns ?? [], [data]);
  const decisions = useMemo(
    () =>
      new Map(
        students.flatMap((student) =>
          student.decision
            ? [[student.correlationId, toDecision(student, student.decision, meId)] as const]
            : []
        )
      ),
    [students, meId]
  );

  const statusOf = useCallback(
    (correlationId: string): StudentMatchStatus => {
      const student = students.find((student) => student.correlationId === correlationId);
      return student ? student.status : 'to-review';
    },
    [students]
  );

  const sendRunOf = useCallback(
    (correlationId: string) => {
      const sendRunId = students.find(
        (student) => student.correlationId === correlationId
      )?.sendRunId;
      return sendRuns.find(({ id }) => id === sendRunId);
    },
    [students, sendRuns]
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
                students: current.students.map((student) =>
                  student.correlationId === correlationId
                    ? { ...student, decision, status }
                    : student
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
      if (choice.kind === 'exclude') return write(correlationId, { kind: 'exclude' });
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

  /** Creates a send run for these students' decisions, at the versions given. */
  const send = useCallback(
    async (students: { correlationId: string; version: number }[]): Promise<SubmitResult> => {
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
    [invalidateJob, jobId, refetch]
  );

  const submit = useCallback(
    (correlationIds: string[]) =>
      send(
        correlationIds.flatMap((correlationId) => {
          const decision = decisions.get(correlationId);
          return decision?.kind === 'match' ? [{ correlationId, version: decision.version }] : [];
        })
      ),
    [decisions, send]
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
    decisions,
    sendRuns,
    decide,
    undo,
    statusOf,
    sendRunOf,
    submit,
    resend,
    search,
    searchOf,
    setSearch,
  };
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
};
