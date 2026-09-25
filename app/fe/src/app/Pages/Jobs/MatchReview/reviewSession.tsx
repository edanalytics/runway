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
 * a reprocessing run and report a result per student.
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

export type Outcome = 'loaded' | 'left-out' | 'failed';

export type BatchItem = {
  correlationId: string;
  decision: Decision;
  outcome?: Outcome;
  reason?: string;
};

export type Batch = {
  id: number;
  submittedAt: number;
  status: 'queued' | 'processing' | 'done';
  items: BatchItem[];
};

/**
 * Where each student stands. `ready` means decided but not yet submitted;
 * `failed` sends a student back for another look.
 */
export type StudentStatus =
  | 'to-review'
  | 'ready'
  | 'reprocessing'
  | 'loaded'
  | 'left-out'
  | 'failed';

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
  /** The item from the latest batch this student was in, if any. */
  lastSubmission: (correlationId: string) => BatchItem | undefined;
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
  // job's year: matching someone not enrolled then fails to load.
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

  const outcomeOf = useCallback(
    (decision: Decision): Pick<BatchItem, 'outcome' | 'reason'> => {
      if (decision.kind === 'not-in-roster') {
        return { outcome: 'left-out', reason: 'Marked not in roster, so left out of the load.' };
      }
      const years = decision.candidate.rosterDetails.school_years;
      if (Array.isArray(years) && currentYear && !years.includes(currentYear)) {
        return {
          outcome: 'failed',
          reason: `${decision.candidate.studentUniqueId} has no enrollment in ${currentYear}, so the record couldn't load.`,
        };
      }
      return { outcome: 'loaded' };
    },
    [currentYear]
  );

  const lastSubmission = useCallback(
    (correlationId: string) => {
      for (let i = batches.length - 1; i >= 0; i--) {
        const item = batches[i].items.find((it) => it.correlationId === correlationId);
        if (item) return item;
      }
      return undefined;
    },
    [batches]
  );

  const statusOf = useCallback(
    (correlationId: string): StudentStatus => {
      const decision = decisions.get(correlationId);
      const batch = [...batches]
        .reverse()
        .find((b) => b.items.some((it) => it.correlationId === correlationId));
      const item = batch?.items.find((it) => it.correlationId === correlationId);
      if (batch && item) {
        // A decision made since the submission is a fresh one to submit.
        if (decision && decision.decidedAt > batch.submittedAt && item.outcome !== 'loaded') {
          return 'ready';
        }
        if (!item.outcome) return 'reprocessing';
        return item.outcome;
      }
      return decision ? 'ready' : 'to-review';
    },
    [batches, decisions]
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
      const items = correlationIds
        .map((correlationId) => ({ correlationId, decision: decisions.get(correlationId) }))
        .filter((item): item is BatchItem => !!item.decision);
      if (!items.length) return;
      const id = Date.now();
      setBatches((current) => [...current, { id, submittedAt: id, status: 'queued', items }]);
      const update = (change: (batch: Batch) => Batch) =>
        setBatches((current) => current.map((batch) => (batch.id === id ? change(batch) : batch)));
      // Queued briefly, then each record finishes in turn, like a run working
      // through the batch.
      const schedule = (delay: number, step: () => void) => {
        timers.current.push(setTimeout(step, delay));
      };
      schedule(1500, () => update((batch) => ({ ...batch, status: 'processing' })));
      items.forEach((item, index) =>
        schedule(2500 + index * 900, () =>
          update((batch) => ({
            ...batch,
            status: index === items.length - 1 ? 'done' : 'processing',
            items: batch.items.map((it, i) =>
              i === index ? { ...it, ...outcomeOf(it.decision) } : it
            ),
          }))
        )
      );
    },
    [decisions, outcomeOf]
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
    lastSubmission,
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
