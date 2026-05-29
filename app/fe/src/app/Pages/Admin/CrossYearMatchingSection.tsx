import { useEffect, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  HStack,
  Switch,
  Text,
  VStack,
  useDisclosure,
} from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import {
  partnerConfigQuery,
  useUpdatePartnerConfig,
} from '../../api/queries/partner-config.queries';
import { ConfirmChangesModal } from './ConfirmChangesModal';
import { RunwayErrorBox } from '../../components/Form/RunwayFormErrorBox';
import { IconCheckmark, IconExclamation } from '../../../assets/icons';

const switchSx = {
  '.chakra-switch__track': {
    bg: 'blue.800',
    _checked: { bg: 'green.300' },
  },
  '.chakra-switch__thumb': { bg: 'blue.50' },
} as const;

export const CrossYearMatchingSection = () => {
  const { data: config, isLoading } = useQuery(partnerConfigQuery);
  const update = useUpdatePartnerConfig();

  const [isEditing, setIsEditing] = useState(false);
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [modalMode, setModalMode] = useState<'save' | 'leave'>('save');
  const [pendingLeaveAction, setPendingLeaveAction] = useState<null | 'cancel'>(null);

  useEffect(() => {
    if (config && !isEditing) setDraftEnabled(config.crossYearMatchingEnabled);
  }, [config?.crossYearMatchingEnabled, isEditing]);

  const hasChanges = !!config && draftEnabled !== config.crossYearMatchingEnabled;
  const shouldWarnAboutUnsavedChanges = isEditing && hasChanges && !update.isPending;
  const blocker = useBlocker({ condition: shouldWarnAboutUnsavedChanges });

  useEffect(() => {
    if (!shouldWarnAboutUnsavedChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [shouldWarnAboutUnsavedChanges]);

  useEffect(() => {
    if (blocker.status === 'blocked') {
      setModalMode('leave');
      onOpen();
    }
  }, [blocker.status, onOpen]);

  if (isLoading || !config) {
    return <Box textStyle="body">loading...</Box>;
  }

  // Backend rejects enable-when-no-creds; mirror that on the FE so the
  // affordance disappears before the user can hit a 400.
  const cannotEnable = !config.eduCredsExist;
  const switchDisabled = !isEditing || (cannotEnable && !draftEnabled);

  const startEdit = () => {
    setDraftEnabled(config.crossYearMatchingEnabled);
    setIsEditing(true);
  };

  const handleCancel = () => {
    if (shouldWarnAboutUnsavedChanges) {
      setPendingLeaveAction('cancel');
      setModalMode('leave');
      onOpen();
      return;
    }
    setDraftEnabled(config.crossYearMatchingEnabled);
    setIsEditing(false);
  };

  const handleSave = () => {
    if (!hasChanges) return;
    setModalMode('save');
    onOpen();
  };

  const handleSaveConfirm = () => {
    update.mutate(
      { crossYearMatchingEnabled: draftEnabled },
      {
        onSuccess: () => {
          onClose();
          setIsEditing(false);
        },
        onError: () => {
          onClose();
          setGeneralError('Something went wrong saving your changes. Please try again.');
        },
      },
    );
  };

  const handleLeaveConfirm = () => {
    onClose();
    if (blocker.status === 'blocked') {
      blocker.proceed();
      return;
    }
    if (pendingLeaveAction === 'cancel') {
      setPendingLeaveAction(null);
      setDraftEnabled(config.crossYearMatchingEnabled);
      setIsEditing(false);
    }
  };

  const handleModalClose = () => {
    onClose();
    if (blocker.status === 'blocked') blocker.reset();
    setPendingLeaveAction(null);
  };

  const changes = hasChanges
    ? [
        `source roster from EDU: ${config.crossYearMatchingEnabled ? 'yes' : 'no'} → ${
          draftEnabled ? 'yes' : 'no'
        }`,
      ]
    : [];

  return (
    <VStack align="stretch" gap="200" mt="500">
      <HStack justify="space-between" align="baseline">
        <Box as="h3" textStyle="h3">
          partner-wide configuration
        </Box>
        {!isEditing && (
          <Button
            variant="ghost"
            textStyle="button"
            textColor="green.100"
            px="200"
            py="200"
            _hover={{ bg: 'transparent' }}
            onClick={startEdit}
          >
            edit
          </Button>
        )}
      </HStack>

      {generalError && <RunwayErrorBox message={generalError} showButton={false} mb="300" />}

      <Box layerStyle="contentBox" padding="300" maxWidth="100%">
        <HStack align="center" gap="400">
          <Text textStyle="body" fontWeight="semibold" color="blue.50" whiteSpace="nowrap">
            source roster from EDU
          </Text>
          {isEditing ? (
            <Switch
              sx={switchSx}
              isChecked={draftEnabled}
              isDisabled={switchDisabled || update.isPending}
              onChange={(e) => setDraftEnabled(e.target.checked)}
            />
          ) : (
            <Badge
              borderRadius="999px"
              bg={config.crossYearMatchingEnabled ? 'green.100' : 'blue.800'}
              color={config.crossYearMatchingEnabled ? 'green.600' : 'green.50'}
              px="200"
              py="100"
              textTransform="none"
            >
              {config.crossYearMatchingEnabled ? 'enabled' : 'disabled'}
            </Badge>
          )}
          <HStack gap="200" flexShrink={0}>
            <Box
              bg={config.eduCredsExist ? 'green.300' : 'pink.400'}
              borderRadius="20px"
              padding="100"
              flexShrink={0}
            >
              {config.eduCredsExist ? <IconCheckmark /> : <IconExclamation />}
            </Box>
            <Box
              textStyle="h6"
              textColor={config.eduCredsExist ? 'green.50' : 'pink.50'}
              whiteSpace="nowrap"
            >
              {config.eduCredsExist ? 'EDU connected' : 'EDU not connected'}
            </Box>
          </HStack>
          <Text textStyle="caption" fontSize="xs" fontWeight="normal" color="blue.50">
            when on, IDs that fail to match the ODS roster can match against an
            EDU cross-year roster and be made available for side-loading.
            {!config.eduCredsExist && (
              <> An EDU connection must be configured to enable this setting.</>
            )}
          </Text>
        </HStack>
      </Box>

      {isEditing && (
        <HStack mt="100" gap="200" justifyContent="flex-end" width="100%">
          <Button
            variant="ghost"
            textStyle="button"
            textColor="green.100"
            px="200"
            py="200"
            _hover={{ bg: 'transparent' }}
            onClick={handleCancel}
            isDisabled={update.isPending}
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
            onClick={handleSave}
            isDisabled={!hasChanges || update.isPending}
            isLoading={update.isPending}
          >
            save
          </Button>
        </HStack>
      )}

      <ConfirmChangesModal
        isOpen={isOpen}
        onClose={handleModalClose}
        onConfirm={modalMode === 'save' ? handleSaveConfirm : handleLeaveConfirm}
        title={modalMode === 'save' ? 'confirm changes' : 'unsaved changes'}
        description={
          modalMode === 'save'
            ? 'The following changes will be saved:'
            : 'You have unsaved partner configuration changes. Leave without saving?'
        }
        confirmLabel={modalMode === 'save' ? 'confirm' : 'leave'}
        changes={modalMode === 'save' ? changes : []}
      />
    </VStack>
  );
};
