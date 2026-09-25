import { useQuery } from '@tanstack/react-query';
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
  StudentRosterDetailsJson,
} from '@edanalytics/models';
import { getJobStudentMatchResults } from '../../../api/queries/job.queries';
import { pretendRoster, RosterStudent } from './mockIdrs';

/*
 * PROTOTYPE ONLY. One review session per job page, shared by every review
 * design so a decision made on one tab shows on the others. Decisions and
 * reprocessing batches live in memory; batches run on timers to stand in for
 * a reprocessing run.
 *
 * A run reports only a summary: per resource, how many assessment records it
 * processed, skipped and failed. It can't say which students those records
 * belong to, so a batch's outcome belongs to the batch, never to a student.
 * A delivery failure doesn't undo a match decision either; like a job that
 * completes with errors today, it's resolved out of band.
 */

export type Candidate = {
  studentUniqueId: string;
  rosterDetails: StudentRosterDetailsJson;
  /** IDRS's score, when the candidate came from IDRS. */
  score: number | null;
  source: 'suggestion' | 'search';
};

export type DecisionChoice = { kind: 'match'; candidate: Candidate } | { kind: 'not-in-roster' };

export type Decision = DecisionChoice & { decidedAt: number };

export type MatchDecision = Extract<Decision, { kind: 'match' }>;

/** One resource's counts, as a run's summary reports them. */
export type ResourceSummary = { processed: number; skipped: number; failed: number };

export type BatchItem = { correlationId: string; decision: MatchDecision };

export type Batch = {
  id: number;
  submittedAt: number;
  status: 'queued' | 'processing' | 'complete' | 'complete with errors';
  items: BatchItem[];
  /** The run's summary, once it finishes. */
  summary?: Record<string, ResourceSummary>;
};

/**
 * Where each student stands. Excluding a student takes effect at once: they
 * never go to the Executor. `reprocessed` means a run was attempted with the
 * student's match; whether their assessments loaded isn't knowable.
 */
export type StudentStatus = 'to-review' | 'ready' | 'reprocessing' | 'reprocessed' | 'excluded';

type Session = {
  job: GetJobDto;
  groups: GetStudentInputDetailsDto[];
  isLoading: boolean;
  isError: boolean;
  roster: RosterStudent[];
  decisions: Map<string, Decision>;
  batches: Batch[];
  decide: (correlationId: string, decision: DecisionChoice) => void;
  undo: (correlationId: string) => void;
  statusOf: (correlationId: string) => StudentStatus;
  /** The latest batch this student was submitted in, if any. */
  batchOf: (correlationId: string) => Batch | undefined;
  /** Submits the match decisions among these students as one batch. */
  submit: (correlationIds: string[]) => void;
  reset: () => void;
};

const SessionContext = createContext<Session | null>(null);

export const useReviewSession = () => {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useReviewSession must be used inside a ReviewSessionProvider');
  return session;
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
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());
  const [batches, setBatches] = useState<Batch[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // The latest school year any roster student is enrolled in stands in for the
  // job's year: a match to someone not enrolled then fails to load.
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
        const assessments = assessmentsFor(correlationId);
        processed += assessments;
        const years = decision.candidate.rosterDetails.school_years;
        if (Array.isArray(years) && currentYear && !years.includes(currentYear)) {
          failed += assessments;
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
      if (decision?.kind === 'not-in-roster') return 'excluded';
      const batch = batchOf(correlationId);
      // A match chosen since the last submission is a fresh one to submit.
      if (decision && (!batch || decision.decidedAt > batch.submittedAt)) return 'ready';
      if (batch) {
        return batch.status === 'queued' || batch.status === 'processing'
          ? 'reprocessing'
          : 'reprocessed';
      }
      return 'to-review';
    },
    [batchOf, decisions]
  );

  const decide = useCallback((correlationId: string, decision: DecisionChoice) => {
    setDecisions((current) =>
      new Map(current).set(correlationId, { ...decision, decidedAt: Date.now() })
    );
  }, []);

  const undo = useCallback((correlationId: string) => {
    setDecisions((current) => {
      const next = new Map(current);
      next.delete(correlationId);
      return next;
    });
  }, []);

  const submit = useCallback(
    (correlationIds: string[]) => {
      const items = correlationIds.flatMap((correlationId) => {
        const decision = decisions.get(correlationId);
        return decision?.kind === 'match' ? [{ correlationId, decision }] : [];
      });
      if (!items.length) return;
      const id = Date.now();
      setBatches((current) => [...current, { id, submittedAt: id, status: 'queued', items }]);
      const update = (change: (batch: Batch) => Batch) =>
        setBatches((current) => current.map((batch) => (batch.id === id ? change(batch) : batch)));
      const schedule = (delay: number, step: () => void) => {
        timers.current.push(setTimeout(step, delay));
      };
      schedule(1500, () => update((batch) => ({ ...batch, status: 'processing' })));
      schedule(3500 + items.length * 500, () => {
        const summary = summarize(items);
        const failed = Object.values(summary).some((resource) => resource.failed > 0);
        update((batch) => ({
          ...batch,
          summary,
          status: failed ? 'complete with errors' : 'complete',
        }));
      });
    },
    [decisions, summarize]
  );

  const reset = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setDecisions(new Map());
    setBatches([]);
  }, []);

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

/** How many assessment records a student has in the file: one or two, in this prototype. */
const assessmentsFor = (correlationId: string) => 1 + (parseInt(correlationId.slice(-1), 16) % 2);

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
