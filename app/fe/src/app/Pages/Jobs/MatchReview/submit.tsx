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
import { Agreement, compare } from './compare';
import { AgreementMark, PrimaryButton, QuietButton, studentName, valueText } from './components';
import { useReviewSession } from './reviewSession';

// Submitting -------------------------------------------------------------------

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
  const fields = against ? compare(against, details as StudentRosterDetailsJson).fields : null;
  const agreement = (label: string): Agreement =>
    fields?.find((f) => f.label === label)?.agreement ?? 'unknown';
  // The name is the same only if both parts are; any part that differs, differs.
  const nameMark: Agreement = [agreement('First name'), agreement('Last name')].includes(
    'different'
  )
    ? 'different'
    : agreement('First name') === 'same' && agreement('Last name') === 'same'
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
        marks ? agreement('Date of birth') : undefined
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
  const { decisions, submit, groups, statusOf } = useReviewSession();
  const [sent, setSent] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  useEffect(() => {
    if (isOpen) {
      setSent(false);
      setConflict(null);
    }
  }, [isOpen]);
  const excluded = groups.filter((g) => statusOf(g.correlationId) === 'excluded');
  const byOthers = ready.filter((g) => {
    const by = decisions.get(g.correlationId)?.decidedBy;
    return by && by !== 'you';
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent bg="blue.700" color="blue.50">
        <ModalHeader>
          Reprocess {ready.length} {ready.length === 1 ? 'record group' : 'record groups'} with
          these identities
        </ModalHeader>
        <ModalBody>
          {conflict && (
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
                Nothing was submitted: {conflict} The list has been refreshed; check it, then submit
                again.
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
              {ready.map((group) => {
                const decision = decisions.get(group.correlationId);
                const candidate = decision?.kind === 'match' ? decision.candidate : null;
                return (
                  <Tr key={group.correlationId}>
                    <Td>
                      <RecordLines details={group.inputDetails} />
                    </Td>
                    <Td>
                      {candidate && (
                        <RecordLines
                          details={candidate.rosterDetails}
                          against={group.inputDetails}
                        />
                      )}
                      {candidate?.source === 'search' && (
                        <Box fontSize="0.75rem" opacity="0.8">
                          Found by search
                        </Box>
                      )}
                      {decision && decision.decidedBy !== 'you' && (
                        <Box fontSize="0.75rem" color="purple.200">
                          Saved by {decision.decidedBy}
                        </Box>
                      )}
                    </Td>
                    <Td textAlign="right">
                      <QuietButton onClick={() => onView(group.correlationId)}>
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
              {excluded.map((g) => studentName(g.inputDetails)).join(', ')}). Exclusions already
              apply.
            </Box>
          )}
          <Box marginTop="300" fontSize="0.85rem" opacity="0.85">
            The run will report how many records loaded, skipped or failed for the batch as a whole,
            not per student. You can keep reviewing while it runs.
          </Box>
        </ModalBody>
        <ModalFooter gap="200">
          <QuietButton onClick={onClose}>Keep reviewing</QuietButton>
          <PrimaryButton
            isDisabled={sent || !ready.length}
            isLoading={sent}
            onClick={async () => {
              setSent(true);
              const result = await submit(ready.map((g) => g.correlationId));
              setSent(false);
              if (result.ok) onClose();
              else setConflict(result.message);
            }}
          >
            Submit batch
          </PrimaryButton>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
