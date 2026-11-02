import {
  Box,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack,
} from '@chakra-ui/react';
import {
  GetStudentInputDetailsDto,
  StudentInputDetailsJson,
  StudentRosterDetailsJson,
} from '@edanalytics/models';
import { ReactNode, useEffect, useState } from 'react';
import { Agreement, compare, ComparedField } from './compare';
import {
  AgreementMark,
  CrossYearCue,
  deciderName,
  isOwnDecision,
  matchedCandidate,
  PrimaryButton,
  QuietButton,
  studentName,
} from './components';
import { valueText } from './values';
import { useMe } from '../../../api/queries/me.queries';
import { SubmitResult, useReviewSession } from './reviewSession';
import { submitFailureText } from './submitResult';

/**
 * A record as three lines, name, birth date and IDs, laid out the same for
 * the file and the roster so the two read across. Given the file to compare
 * `against`, the name and birth date carry the usual = / ≠ marks.
 */
const RecordLines = ({
  details,
  against,
}: {
  details: StudentInputDetailsJson | StudentRosterDetailsJson;
  against?: StudentInputDetailsJson;
}) => {
  const agreements = against ? compare(against, details as StudentRosterDetailsJson) : null;
  const agreement = (field: ComparedField): Agreement => agreements?.[field] ?? 'unknown';
  // The name is the same only if both parts are; any part that differs, differs.
  const nameMark: Agreement = [agreement('first_name'), agreement('last_name')].includes(
    'different'
  )
    ? 'different'
    : agreement('first_name') === 'same' && agreement('last_name') === 'same'
    ? 'same'
    : 'unknown';
  const line = (content: ReactNode, mark?: Agreement | null, bold = false) => (
    <HStack gap="200" minHeight="1.75rem" alignItems="center">
      {mark !== undefined &&
        (mark ? <AgreementMark agreement={mark} /> : <Box width="1.5rem" flexShrink={0} />)}
      <Box fontWeight={bold ? '600' : 'normal'} fontSize={bold ? '0.95rem' : '0.85rem'}>
        {content}
      </Box>
    </HStack>
  );
  const marks = !!against;
  return (
    <VStack alignItems="stretch" gap="0">
      {line(studentName(details), marks ? nameMark : undefined, true)}
      {line(
        `born ${valueText(details.birth_date) ?? '—'}`,
        marks ? agreement('birth_date') : undefined
      )}
      {/* IDs come from different systems, so they're shown, not marked. */}
      {line(`IDs ${valueText(details.student_ids) ?? '—'}`, marks ? null : undefined)}
    </VStack>
  );
};

/** A compact checkpoint: what will be reprocessed, with a way back to the evidence. */
export const SubmitReview = ({
  isOpen,
  ready,
  onClose,
  onView,
}: {
  isOpen: boolean;
  ready: GetStudentInputDetailsDto[];
  onClose: () => void;
  onView: (correlationId: string) => void;
}) => {
  const { submit, submitBlocked, students } = useReviewSession();
  const { data: me } = useMe();
  const meId = me?.user?.id;
  const [sending, setSending] = useState(false);
  // The last submit's failure, with the students it submitted.
  const [failure, setFailure] = useState<{
    result: Extract<SubmitResult, { ok: false }>;
    submitted: string[];
  } | null>(null);
  useEffect(() => {
    if (isOpen) {
      setSending(false);
      setFailure(null);
    }
  }, [isOpen]);
  const result = failure?.result;
  const refusal = result?.kind === 'refused' ? result.refusal : null;
  const text = result && submitFailureText(result, 'submitted');
  // After a refusal that names students, the same submit without them.
  const refusedIds = new Set(refusal?.refused.map(({ correlationId }) => correlationId));
  const rest =
    failure && refusal && refusal.action !== 'try later'
      ? failure.submitted.filter((correlationId) => !refusedIds.has(correlationId))
      : null;
  const nameOf = (correlationId: string) => {
    const student = students.find((student) => student.correlationId === correlationId);
    return student ? studentName(student.inputDetails) : 'A student no longer listed';
  };
  const send = async (correlationIds: string[]) => {
    setSending(true);
    const result = await submit(correlationIds);
    setSending(false);
    if (result.ok) onClose();
    else setFailure({ result, submitted: correlationIds });
  };
  const excluded = students.filter((student) => student.status === 'excluded');
  const byOthers = ready.filter(({ decision }) => decision && !isOwnDecision(decision, meId));

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent bg="blue.700" color="blue.50">
        <ModalHeader>
          Reprocess {ready.length} {ready.length === 1 ? 'record group' : 'record groups'} with
          these identities
        </ModalHeader>
        <ModalBody>
          {text && (
            <VStack
              alignItems="flex-start"
              gap="200"
              marginBottom="300"
              padding="300"
              borderRadius="6px"
              borderWidth="1px"
              borderColor="pink.100"
            >
              <Box>
                {text.title}. {text.detail}
              </Box>
              {refusal?.refused.map(({ correlationId }) => (
                <HStack key={correlationId} gap="200">
                  <Box fontWeight="600">{nameOf(correlationId)}</Box>
                  <QuietButton size="xs" onClick={() => onView(correlationId)}>
                    View
                  </QuietButton>
                </HStack>
              ))}
              <Box fontSize="0.9rem">
                {text.caughtUp}{' '}
                {refusal?.action === 'leave out' &&
                  'Submit the rest without them, or check them first.'}
                {refusal?.action === 'leave out or exclude' &&
                  'Submit the rest without them, or open each to exclude it from the job.'}
                {result?.kind === 'not submitted' && 'Check it, then submit again.'}
                {result?.kind === 'unknown' && 'Check it before submitting again.'}
              </Box>
            </VStack>
          )}
          {byOthers.length > 0 && (
            <Box
              marginBottom="300"
              padding="300"
              borderRadius="6px"
              borderWidth="1px"
              borderColor="purple.200"
              fontSize="0.9rem"
            >
              {byOthers.length} of these {byOthers.length === 1 ? 'match was' : 'matches were'}{' '}
              saved by another reviewer. Submitting sends them as they are; check them if you're not
              expecting that.
            </Box>
          )}
          <Table size="sm">
            <Thead>
              <Tr>
                <Th color="blue.50" textTransform="none">
                  From your file
                </Th>
                <Th color="blue.50" textTransform="none">
                  Matched to
                </Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {ready.map((student) => {
                const { decision } = student;
                const candidate = matchedCandidate(student);
                return (
                  <Tr key={student.correlationId}>
                    <Td>
                      <RecordLines details={student.inputDetails} />
                    </Td>
                    <Td>
                      {candidate && <CrossYearCue rosterDetails={candidate.rosterDetails} />}
                      {candidate && (
                        <RecordLines
                          details={candidate.rosterDetails}
                          against={student.inputDetails}
                        />
                      )}
                      {candidate?.source === 'search' && (
                        <Box fontSize="0.75rem" opacity="0.8">
                          Found by search
                        </Box>
                      )}
                      {decision && !isOwnDecision(decision, meId) && (
                        <Box fontSize="0.75rem" color="purple.200">
                          Saved by {deciderName(decision, meId)}
                        </Box>
                      )}
                    </Td>
                    <Td textAlign="right">
                      <QuietButton onClick={() => onView(student.correlationId)}>
                        View evidence
                      </QuietButton>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
          {excluded.length > 0 && (
            <Box marginTop="300" fontSize="0.85rem" opacity="0.85">
              Not part of this submission: {excluded.length} excluded from this job (
              {excluded.map((student) => studentName(student.inputDetails)).join(', ')}). Exclusions
              already apply.
            </Box>
          )}
          <Box marginTop="300" fontSize="0.85rem" opacity="0.85">
            The run will report how many records loaded, skipped or failed for the submission as a
            whole, not per student. You can keep reviewing while it runs.
          </Box>
        </ModalBody>
        <ModalFooter gap="200">
          <QuietButton onClick={onClose}>Keep reviewing</QuietButton>
          {rest ? (
            <PrimaryButton
              isDisabled={sending || !rest.length}
              isLoading={sending}
              onClick={() => send(rest)}
            >
              Submit the rest ({rest.length})
            </PrimaryButton>
          ) : (
            <PrimaryButton
              isDisabled={sending || !ready.length || !!submitBlocked}
              isLoading={sending}
              onClick={() => send(ready.map((student) => student.correlationId))}
            >
              Submit
            </PrimaryButton>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
