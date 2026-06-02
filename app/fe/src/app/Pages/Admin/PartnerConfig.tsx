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
  Switch,
  Text,
  VStack,
  useDisclosure,
} from '@chakra-ui/react';
import { PutPartnerConfigDto } from '@edanalytics/models';
import { useQuery } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import {
  partnerConfigQuery,
  useUpdatePartnerConfig,
} from '../../api/queries/partner-config.queries';
import { ConfirmChangesModal } from './ConfirmChangesModal';
import { ConfirmModal } from './ConfirmModal';
import { RunwayErrorBox } from '../../components/Form/RunwayFormErrorBox';
import { IconCheckmark, IconExclamation } from '../../../assets/icons';

export const PartnerConfig = () => {
  const { data: config, isLoading } = useQuery(partnerConfigQuery);
  const update = useUpdatePartnerConfig();

  const [isEditing, setIsEditing] = useState(false);
  // null until the user starts editing (or config first loads); the saved
  // config is the source of truth otherwise.
  const [draftConfig, setDraftConfig] = useState<PutPartnerConfigDto | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const { isOpen: isSaveOpen, onOpen: onSaveOpen, onClose: onSaveClose } = useDisclosure();
  const { isOpen: isLeaveOpen, onOpen: onLeaveOpen, onClose: onLeaveClose } = useDisclosure();
  const { isOpen: isHelpOpen, onToggle: onToggleHelp } = useDisclosure();
  const [pendingLeaveAction, setPendingLeaveAction] = useState<null | 'cancel'>(null);

  const hasChanges =
    !!config &&
    !!draftConfig &&
    draftConfig.crossYearMatchingEnabled !== config.crossYearMatchingEnabled;
  const shouldWarnAboutUnsavedChanges = isEditing && hasChanges && !update.isPending;
  const blocker = useBlocker({ condition: shouldWarnAboutUnsavedChanges });

  // Native guard for unsaved edits on tab close / refresh / external nav (the
  // cases the in-app router blocker below can't intercept).
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
      onLeaveOpen();
    }
  }, [blocker.status, onLeaveOpen]);

  if (isLoading || !config) {
    return <Box textStyle="body">loading...</Box>;
  }

  // draftConfig is null outside of editing; fall back to the saved config so
  // the edit controls always have a concrete value to render and submit.
  const draft = draftConfig ?? { crossYearMatchingEnabled: config.crossYearMatchingEnabled };

  // Backend rejects enable-when-no-creds; mirror that on the FE so the
  // affordance disappears before the user can hit a 400.
  const cannotEnable = !config.eduCredsExist;
  const switchDisabled = !isEditing || (cannotEnable && !draft.crossYearMatchingEnabled);

  const startEdit = () => {
    setGeneralError(null);
    setDraftConfig({ crossYearMatchingEnabled: config.crossYearMatchingEnabled });
    setIsEditing(true);
  };

  const handleCancel = () => {
    if (shouldWarnAboutUnsavedChanges) {
      setPendingLeaveAction('cancel');
      onLeaveOpen();
      return;
    }
    setDraftConfig(null);
    setIsEditing(false);
  };

  const handleSave = () => {
    if (!hasChanges) return;
    onSaveOpen();
  };

  const handleSaveConfirm = () => {
    setGeneralError(null);
    update.mutate(draft, {
      onSuccess: () => {
        onSaveClose();
        setDraftConfig(null);
        setIsEditing(false);
      },
      onError: () => {
        onSaveClose();
        setGeneralError('Something went wrong saving your changes. Please try again.');
      },
    });
  };

  const handleLeaveConfirm = () => {
    onLeaveClose();
    if (blocker.status === 'blocked') {
      blocker.proceed();
      return;
    }
    if (pendingLeaveAction === 'cancel') {
      setPendingLeaveAction(null);
      setDraftConfig(null);
      setIsEditing(false);
    }
  };

  const handleLeaveCancel = () => {
    onLeaveClose();
    if (blocker.status === 'blocked') blocker.reset();
    setPendingLeaveAction(null);
  };

  const changes = hasChanges
    ? [
        `Cross-year roster for ID matching: ${config.crossYearMatchingEnabled ? 'yes' : 'no'} → ${
          draft.crossYearMatchingEnabled ? 'yes' : 'no'
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
        <FormControl id="cross-year-toggle" variant="plain">
          <HStack align="center" gap="500">
            <FormLabel
              mb="0"
              textStyle="body"
              fontWeight="semibold"
              color="blue.50"
              whiteSpace="nowrap"
            >
              Cross-year roster for ID matching
            </FormLabel>
            {isEditing ? (
              <Switch
                sx={{
                  '.chakra-switch__track': {
                    bg: 'blue.800',
                    _checked: { bg: 'green.300' },
                  },
                  '.chakra-switch__thumb': { bg: 'blue.50' },
                }}
                aria-describedby="cross-year-edu-status"
                isChecked={draft.crossYearMatchingEnabled}
                isDisabled={switchDisabled || update.isPending}
                onChange={(e) =>
                  setDraftConfig({ ...draft, crossYearMatchingEnabled: e.target.checked })
                }
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
            <VStack id="cross-year-edu-status" align="start" gap="100" flexShrink={0}>
              <HStack gap="200">
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
              {!config.eduCredsExist && (
                <Text textStyle="caption" fontSize="xs" color="pink.50" maxW="14rem">
                  An EDU connection must be configured to enable this setting.
                </Text>
              )}
            </VStack>
            <VStack align="stretch" gap="100">
              <FormHelperText
                mt="0"
                textStyle="caption"
                fontSize="xs"
                fontWeight="normal"
                color="blue.50"
              >
                <VStack align="stretch" gap="100">
                  <Text>
                    Allow Runway to process records for students who were rostered in any year
                    available in EDU, even if the student is not rostered in the ODS year.
                  </Text>
                  <Collapse in={isHelpOpen} animateOpacity>
                    <VStack id="cross-year-help-details" align="stretch" gap="100">
                      <Text>
                        For jobs sent to an ODS, Runway will continue to match IDs against the ODS
                        roster first. If an ID does not match against the ODS roster, Runway will
                        attempt to match against the cross-year roster from EDU. If the ID matches
                        the cross-year roster, the student will be made available for side-loading
                        to EDU. IDs that do not match against either roster will follow the normal
                        unmatched ID review flow.
                      </Text>
                      <Text>
                        For jobs NOT sent to an ODS, Runway will use the cross-year roster from EDU,
                        if this setting is enabled. Otherwise, non-ODS jobs will expect a roster
                        file in S3.
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
                aria-controls="cross-year-help-details"
              >
                {isHelpOpen ? 'show less' : 'show more'}
              </Button>
            </VStack>
          </HStack>
        </FormControl>
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
        isOpen={isSaveOpen}
        onClose={onSaveClose}
        onConfirm={handleSaveConfirm}
        changes={changes}
      />
      <ConfirmModal
        isOpen={isLeaveOpen}
        onClose={handleLeaveCancel}
        onConfirm={handleLeaveConfirm}
        title="unsaved changes"
        description="You have unsaved partner configuration changes. Leave without saving?"
        confirmLabel="leave"
      />
    </VStack>
  );
};
