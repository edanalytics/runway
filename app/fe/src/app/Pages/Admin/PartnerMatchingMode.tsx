import { useEffect, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Collapse,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  ListItem,
  Select,
  Text,
  UnorderedList,
  VStack,
  useDisclosure,
} from '@chakra-ui/react';
import { PutPartnerIdMatchingModeDto } from '@edanalytics/models';
import { useQuery } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import {
  partnerIdMatchingModeQuery,
  useUpdatePartnerIdMatchingMode,
} from '../../api/queries/partner-id-matching-mode.queries';
import { ConfirmChangesModal } from './ConfirmChangesModal';
import { ConfirmModal } from './ConfirmModal';
import { RunwayErrorBox } from '../../components/Form/RunwayFormErrorBox';

type Mode = PutPartnerIdMatchingModeDto['idMatchingMode'];
const labels: Record<Mode, string> = {
  id_based: 'ID-based (legacy)',
  id_based_fuzzy_background: 'ID-based with background fuzzy matching (transitional)',
  fuzzy: 'Fuzzy matching (recommended)',
};

export const PartnerMatchingMode = () => {
  const { data: config, isLoading, isError } = useQuery(partnerIdMatchingModeQuery);
  const update = useUpdatePartnerIdMatchingMode();
  const [draft, setDraft] = useState<Mode | null>(null);
  const { isOpen: isHelpOpen, onToggle: onToggleHelp } = useDisclosure();
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'save' | 'discard' | 'leave' | null>(null);
  const hasChanges = !!config && draft !== null && draft !== config.idMatchingMode;
  const shouldWarn = hasChanges && !update.isPending;
  const blocker = useBlocker({ condition: shouldWarn });

  useEffect(() => {
    if (!shouldWarn) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [shouldWarn]);

  useEffect(() => {
    if (blocker.status === 'blocked') setDialog('leave');
  }, [blocker.status]);

  if (isError)
    return (
      <RunwayErrorBox
        message="Could not load the student matching configuration. Please reload the page."
        showButton={false}
      />
    );
  if (isLoading || !config) return <Box textStyle="body">loading...</Box>;

  const discard = () => {
    setDraft(null);
    setError(null);
    setDialog(null);
  };
  const save = () => {
    if (!hasChanges || draft === null || update.isPending) return;
    setError(null);
    setDialog(null);
    update.mutate(
      { idMatchingMode: draft },
      {
        onSuccess: () => setDraft(null),
        onError: (failure: unknown) => {
          const code =
            failure && typeof failure === 'object' && 'code' in failure ? failure.code : undefined;
          setError(
            code === 'idrs_not_ready'
              ? 'Runway could not enable this mode. Check the IDRS credentials and required permissions for this partner, then try again.'
              : code === 'identity_service_unavailable'
              ? 'Runway could not verify IDRS access right now. Please try again later.'
              : 'Something went wrong saving your changes. Please try again.'
          );
        },
      }
    );
  };

  return (
    <VStack as="section" aria-label="Student identity matching mode" align="stretch" gap="200">
      {error && <RunwayErrorBox message={error} showButton={false} />}
      <HStack align="center" gap="300">
        <FormControl id="partner-matching-mode" variant="plain">
          <HStack align="center" gap="500">
            <FormLabel
              mb="0"
              textStyle="body"
              fontWeight="semibold"
              color="blue.50"
              whiteSpace="nowrap"
            >
              Student identity matching mode
            </FormLabel>
            {draft === null ? (
              <Badge
                borderRadius="999px"
                bg={config.idMatchingMode === 'id_based' ? 'blue.800' : 'green.100'}
                color={config.idMatchingMode === 'id_based' ? 'green.50' : 'green.600'}
                px="200"
                py="100"
                textTransform="none"
                flexShrink={0}
              >
                {labels[config.idMatchingMode]}
              </Badge>
            ) : (
              <Select
                value={draft}
                onChange={(event) => setDraft(event.target.value as Mode)}
                isDisabled={update.isPending}
                aria-describedby="partner-matching-help"
                width="auto"
                maxWidth="24rem"
                flexShrink={0}
              >
                {Object.entries(labels).map(([mode, label]) => (
                  <option key={mode} value={mode}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
            <VStack align="stretch" gap="100">
              <FormHelperText
                id="partner-matching-help"
                mt="0"
                textStyle="caption"
                fontSize="xs"
                fontWeight="normal"
                color="blue.50"
              >
                <VStack align="stretch" gap="100">
                  <Text>
                    Configure how Runway matches students in input files to student records in the
                    roster. This setting applies to new jobs across all tenants in this partner.
                  </Text>
                  <Collapse in={isHelpOpen} animateOpacity>
                    <VStack id="partner-matching-help-details" align="stretch" gap="100">
                      <UnorderedList spacing="100" margin="0" paddingLeft="300">
                        <ListItem>
                          <strong>ID-based (legacy):</strong> Match student IDs in input files to
                          IDs in the roster using the existing ID-based matching method.
                        </ListItem>
                        <ListItem>
                          <strong>ID-based with background fuzzy matching (transitional):</strong>{' '}
                          Test fuzzy matching in the background while continuing to process jobs
                          with the existing ID-based matches.
                        </ListItem>
                        <ListItem>
                          <strong>Fuzzy matching (recommended):</strong> The recommended mode going
                          forward. Use IDRS to match students using their identifying details.
                          Students without a confident match require review before their records are
                          sent.
                        </ListItem>
                      </UnorderedList>
                      <Text>
                        Existing jobs keep their matching mode. Enabling either fuzzy mode checks
                        the partner's IDRS access when you save.
                      </Text>
                    </VStack>
                  </Collapse>
                </VStack>
              </FormHelperText>
              <Button
                variant="link"
                alignSelf="flex-start"
                textStyle="caption"
                fontSize="xs"
                fontWeight="normal"
                color="green.100"
                _hover={{ color: 'green.50' }}
                onClick={onToggleHelp}
                aria-expanded={isHelpOpen}
                aria-controls="partner-matching-help-details"
              >
                {isHelpOpen ? 'show less' : 'show more'}
              </Button>
            </VStack>
          </HStack>
        </FormControl>
        {draft === null && (
          <Button
            variant="ghost"
            textStyle="button"
            textColor="green.100"
            px="200"
            py="200"
            _hover={{ bg: 'transparent' }}
            onClick={() => {
              setError(null);
              setDraft(config.idMatchingMode);
            }}
          >
            edit
          </Button>
        )}
        {draft !== null && (
          <HStack gap="200" flexShrink={0}>
            <Button
              variant="ghost"
              textStyle="button"
              textColor="green.100"
              px="200"
              py="200"
              _hover={{ bg: 'transparent' }}
              isDisabled={update.isPending}
              onClick={() => (hasChanges ? setDialog('discard') : discard())}
            >
              cancel
            </Button>
            <Button
              layerStyle="buttonPrimary"
              textStyle="button"
              px="300"
              py="300"
              bg="green.100"
              color="green.600"
              _hover={{ bg: 'green.50' }}
              isDisabled={!hasChanges || update.isPending}
              aria-label="save"
              isLoading={update.isPending}
              onClick={() => setDialog('save')}
            >
              save
            </Button>
          </HStack>
        )}
      </HStack>

      <ConfirmChangesModal
        isOpen={dialog === 'save'}
        onClose={() => setDialog(null)}
        onConfirm={save}
        changes={
          hasChanges
            ? [
                `Student identity matching mode: ${labels[config.idMatchingMode]} → ${
                  labels[draft!]
                }`,
              ]
            : []
        }
      />
      <ConfirmModal
        isOpen={dialog === 'discard'}
        onClose={() => setDialog(null)}
        onConfirm={discard}
        title="discard changes"
        description="Discard your unsaved student matching changes?"
        confirmLabel="discard"
      />
      <ConfirmModal
        isOpen={dialog === 'leave'}
        onClose={() => {
          setDialog(null);
          if (blocker.status === 'blocked') blocker.reset();
        }}
        onConfirm={() => {
          setDialog(null);
          if (blocker.status === 'blocked') blocker.proceed();
        }}
        title="unsaved changes"
        description="You have unsaved student matching changes. Leave without saving?"
        confirmLabel="leave"
      />
    </VStack>
  );
};
