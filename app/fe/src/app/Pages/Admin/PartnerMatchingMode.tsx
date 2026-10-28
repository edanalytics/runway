import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Select,
  Text,
  VStack,
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
  id_based: 'ID-based',
  id_based_fuzzy_background: 'ID-based with background fuzzy matching',
  fuzzy: 'Fuzzy matching',
};

export const PartnerMatchingMode = () => {
  const { data: config, isLoading, isError } = useQuery(partnerIdMatchingModeQuery);
  const update = useUpdatePartnerIdMatchingMode();
  const [draft, setDraft] = useState<Mode | null>(null);
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
    <VStack
      as="section"
      aria-labelledby="student-matching-heading"
      align="stretch"
      gap="200"
      mt="500"
    >
      <HStack justify="space-between" align="baseline">
        <Box as="h3" id="student-matching-heading" textStyle="h3">
          student matching
        </Box>
        {draft === null && (
          <Button
            variant="ghost"
            color="green.100"
            onClick={() => {
              setError(null);
              setDraft(config.idMatchingMode);
            }}
          >
            edit
          </Button>
        )}
      </HStack>
      {error && <RunwayErrorBox message={error} showButton={false} />}
      <Box layerStyle="contentBox" padding="300">
        <FormControl id="partner-matching-mode" variant="plain">
          <FormLabel color="blue.50">Matching mode</FormLabel>
          {draft === null ? (
            <Text color="blue.50">{labels[config.idMatchingMode]}</Text>
          ) : (
            <Select
              value={draft}
              onChange={(event) => setDraft(event.target.value as Mode)}
              isDisabled={update.isPending}
              aria-describedby="partner-matching-help"
            >
              {Object.entries(labels).map(([mode, label]) => (
                <option key={mode} value={mode}>
                  {label}
                </option>
              ))}
            </Select>
          )}
          <FormHelperText id="partner-matching-help" color="blue.50">
            Applies to new jobs for all tenants in this partner. Existing jobs keep their matching
            mode. Background fuzzy matching continues ID-based delivery while collecting fuzzy
            suggestions. Fuzzy matching lets reviewers resolve uncertain matches before sending
            those students. Enabling either fuzzy mode checks the partner's IDRS access when you
            save.
          </FormHelperText>
        </FormControl>
      </Box>
      {draft !== null && (
        <HStack justify="flex-end" gap="200">
          <Button
            variant="ghost"
            color="green.100"
            isDisabled={update.isPending}
            onClick={() => (hasChanges ? setDialog('discard') : discard())}
          >
            cancel
          </Button>
          <Button
            layerStyle="buttonPrimary"
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
      <ConfirmChangesModal
        isOpen={dialog === 'save'}
        onClose={() => setDialog(null)}
        onConfirm={save}
        changes={
          hasChanges
            ? [`Student matching: ${labels[config.idMatchingMode]} → ${labels[draft!]}`]
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
