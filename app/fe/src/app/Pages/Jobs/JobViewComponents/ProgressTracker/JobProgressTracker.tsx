import { HStack } from '@chakra-ui/react';
import { GetRunUpdateDto } from '@edanalytics/models';
import { ProgressLine } from './ProgressLine';
import { ProgressStep } from './ProgressStep';

export type ProgressStepStatus = 'not started' | 'in progress' | 'done' | 'error';
const stepsByStage = {
  preprocessing: [
    'refresh_bundle_code',
    'get_student_roster',
    'get_input_files',
    'earthmover_deps',
  ],
  transforming: ['earthmover_run'],
  sending: ['lightbeam_send'],
  done: ['done'],
};

const getStageStatus = (
  stepsToCheck: string[],
  allSteps: GetRunUpdateDto[] | undefined
): ProgressStepStatus => {
  if (!allSteps) {
    return 'not started';
  }

  // returns done, in progress, error, not started
  const relevantSteps = allSteps.filter((step) => stepsToCheck.includes(step.action));
  if (relevantSteps.length === 0) {
    return 'not started';
  }

  if (relevantSteps.some((step) => step.status === 'failure')) {
    return 'error';
  }

  const startedSteps = relevantSteps.filter((step) => step.status === 'begin').length;
  const doneSteps = relevantSteps.filter((step) => step.status === 'success').length;
  return startedSteps === doneSteps && startedSteps === stepsToCheck.length
    ? 'done'
    : 'in progress';
};

export const JobProgressTracker = ({
  statusUpdates,
}: {
  statusUpdates: GetRunUpdateDto[] | undefined;
}) => {
  const doneUpdate = statusUpdates?.find((update) => update.action === 'done');
  const statuses: Record<string, ProgressStepStatus> = {
    preprocessing: getStageStatus(stepsByStage.preprocessing, statusUpdates),
    transforming: getStageStatus(stepsByStage.transforming, statusUpdates),
    sending: getStageStatus(stepsByStage.sending, statusUpdates),
    done: doneUpdate && doneUpdate?.status !== 'failure' ? 'done' : 'not started', // if we have an error, that would have occured at an earlier step
  };

  return (
    <HStack width="100%" justifyContent="space-between" alignItems="baseline">
      <ProgressStep title="Pre-processing" stepNumber="1" status={statuses.preprocessing} />
      <ProgressLine
        prevStepStatus={statuses.preprocessing}
        nextStepStatus={statuses.transforming}
      />
      <ProgressStep title="Transforming" stepNumber="2" status={statuses.transforming} />
      <ProgressLine prevStepStatus={statuses.transforming} nextStepStatus={statuses.sending} />
      <ProgressStep title="Sending" stepNumber="3" status={statuses.sending} />
      <ProgressLine prevStepStatus={statuses.sending} nextStepStatus={statuses.done} />
      <ProgressStep title="Complete" stepNumber="4" status={statuses.done} />
    </HStack>
  );
};
