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
  Switch,
  Text,
  UnorderedList,
  VStack,
  useDisclosure,
} from '@chakra-ui/react';
import { PartnerConfigValuesDto } from '@edanalytics/models';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Select } from 'chakra-react-select';
import { useBlocker } from '@tanstack/react-router';
import {
  partnerConfigQuery,
  useUpdatePartnerConfig,
} from '../../api/queries/partner-config.queries';
import { ConfirmChangesModal } from './ConfirmChangesModal';
import { ConfirmModal } from './ConfirmModal';
import { RunwayErrorBox } from '../../components/Form/RunwayFormErrorBox';
import { IconCheckmark, IconExclamation } from '../../../assets/icons';

type IdMatchingMode = PartnerConfigValuesDto['idMatchingMode'];
const modeLabels: Record<IdMatchingMode, string> = {
  id_based: 'ID-based',
  id_based_fuzzy_background: 'ID-based with background fuzzy matching',
  fuzzy: 'Fuzzy matching',
};
const modeOptions = Object.entries(modeLabels).map(([value, label]) => ({
  value: value as IdMatchingMode,
  label,
}));

export const PartnerConfig = () => {
  const { data: config, isLoading } = useQuery(partnerConfigQuery);
  const update = useUpdatePartnerConfig();
  const queryClient = useQueryClient();

  const [isEditing, setIsEditing] = useState(false);
  // null until the user starts editing (or config first loads); the saved
  // config is the source of truth otherwise.
  const [draftConfig, setDraftConfig] = useState<PartnerConfigValuesDto | null>(null);
  // The saved config when editing started. The save sends it as `expected`, so
  // the server refuses it if another admin has saved since, even when a
  // background refetch has already brought their change into `config`.
  const [baseConfig, setBaseConfig] = useState<PartnerConfigValuesDto | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const { isOpen: isSaveOpen, onOpen: onSaveOpen, onClose: onSaveClose } = useDisclosure();
  // Two distinct exits: discarding edits (cancel button, stay on the page) vs.
  // navigating away with unsaved changes (router blocker / tab close).
  const { isOpen: isDiscardOpen, onOpen: onDiscardOpen, onClose: onDiscardClose } = useDisclosure();
  const { isOpen: isLeaveOpen, onOpen: onLeaveOpen, onClose: onLeaveClose } = useDisclosure();
  const { isOpen: isHelpOpen, onToggle: onToggleHelp } = useDisclosure();
  const { isOpen: isModeHelpOpen, onToggle: onToggleModeHelp } = useDisclosure();

  const hasChanges =
    !!baseConfig &&
    !!draftConfig &&
    (draftConfig.crossYearMatchingEnabled !== baseConfig.crossYearMatchingEnabled ||
      draftConfig.idMatchingMode !== baseConfig.idMatchingMode);
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
  const saved: PartnerConfigValuesDto = {
    crossYearMatchingEnabled: config.crossYearMatchingEnabled,
    idMatchingMode: config.idMatchingMode,
  };
  const draft = draftConfig ?? saved;
  const base = baseConfig ?? saved;

  // Backend rejects enable-when-no-creds; mirror that on the FE so the
  // affordance disappears before the user can hit a 400.
  const cannotEnable = !config.canConnectToEdu;
  const switchDisabled = !isEditing || (cannotEnable && !draft.crossYearMatchingEnabled);

  const startEdit = () => {
    setGeneralError(null);
    setBaseConfig(saved);
    setDraftConfig(saved);
    setIsEditing(true);
  };

  const discardEdits = () => {
    setGeneralError(null);
    setBaseConfig(null);
    setDraftConfig(null);
    setIsEditing(false);
  };

  const handleCancel = () => {
    if (shouldWarnAboutUnsavedChanges) {
      onDiscardOpen();
      return;
    }
    discardEdits();
  };

  const handleDiscardConfirm = () => {
    onDiscardClose();
    discardEdits();
  };

  const handleSave = () => {
    if (!hasChanges) return;
    onSaveOpen();
  };

  const handleSaveConfirm = () => {
    setGeneralError(null);
    update.mutate(
      { ...draft, expected: base },
      {
        onSuccess: () => {
          onSaveClose();
          discardEdits();
        },
        onError: (error: any) => {
          onSaveClose();
          if (error?.statusCode === 409) {
            // Show the settings as they now are, for the admin to edit again.
            discardEdits();
            queryClient.invalidateQueries({ queryKey: partnerConfigQuery.queryKey });
            setGeneralError(
              'Another admin changed these settings while you were editing. The current settings are shown below; edit them again to make your changes.'
            );
            return;
          }
          // The 400s from the EDU and IDRS checks carry messages written for the admin.
          setGeneralError(
            error?.statusCode === 400 && typeof error.message === 'string'
              ? error.message
              : 'Something went wrong saving your changes. Please try again.'
          );
        },
      }
    );
  };

  const handleLeaveConfirm = () => {
    onLeaveClose();
    if (blocker.status === 'blocked') blocker.proceed();
  };

  const handleLeaveCancel = () => {
    onLeaveClose();
    if (blocker.status === 'blocked') blocker.reset();
  };

  const changes = [
    ...(draft.crossYearMatchingEnabled !== base.crossYearMatchingEnabled
      ? [
          `Cross-year roster for ID matching: ${base.crossYearMatchingEnabled ? 'yes' : 'no'} → ${
            draft.crossYearMatchingEnabled ? 'yes' : 'no'
          }`,
        ]
      : []),
    ...(draft.idMatchingMode !== base.idMatchingMode
      ? [
          `Student identity matching mode: ${modeLabels[base.idMatchingMode]} → ${
            modeLabels[draft.idMatchingMode]
          }`,
        ]
      : []),
  ];

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

      <VStack layerStyle="contentBox" padding="300" maxWidth="100%" align="stretch" gap="400">
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
                  bg={config.canConnectToEdu ? 'green.300' : 'pink.400'}
                  borderRadius="20px"
                  padding="100"
                  flexShrink={0}
                >
                  {config.canConnectToEdu ? <IconCheckmark /> : <IconExclamation />}
                </Box>
                <Box
                  textStyle="h6"
                  textColor={config.canConnectToEdu ? 'green.50' : 'pink.50'}
                  whiteSpace="nowrap"
                >
                  {config.canConnectToEdu ? 'EDU connected' : 'EDU not connected'}
                </Box>
              </HStack>
              {!config.canConnectToEdu && (
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
        <FormControl id="id-matching-mode" variant="plain">
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
            {isEditing ? (
              <Box minWidth="22rem" flexShrink={0}>
                {/* The menu matches RunwaySelect's: dark text on a light menu. */}
                <Select
                  value={modeOptions.find((option) => option.value === draft.idMatchingMode)}
                  options={modeOptions}
                  onChange={(option) =>
                    option && setDraftConfig({ ...draft, idMatchingMode: option.value })
                  }
                  isDisabled={update.isPending}
                  isSearchable={false}
                  menuPortalTarget={document.body}
                  chakraStyles={{
                    control: (baseStyles) => ({ ...baseStyles, bg: 'blue.800', color: 'blue.50' }),
                    dropdownIndicator: (baseStyles) => ({
                      ...baseStyles,
                      bg: 'transparent',
                      color: 'blue.50',
                    }),
                    menu: (baseStyles) => ({
                      ...baseStyles,
                      textStyle: 'body',
                      textColor: 'blue.700',
                      bg: 'blue.50',
                    }),
                    menuList: (baseStyles) => ({ ...baseStyles, border: 'none' }),
                    option: (baseStyles) => ({ ...baseStyles, padding: '200' }),
                  }}
                />
              </Box>
            ) : (
              <Badge
                borderRadius="999px"
                bg="green.100"
                color="green.600"
                px="200"
                py="100"
                textTransform="none"
                flexShrink={0}
              >
                {modeLabels[config.idMatchingMode]}
              </Badge>
            )}
            <VStack align="stretch" gap="100">
              <FormHelperText
                id="id-matching-mode-help"
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
                  <Collapse in={isModeHelpOpen} animateOpacity>
                    <VStack id="id-matching-mode-help-details" align="stretch" gap="100">
                      <UnorderedList spacing="100" margin="0" paddingLeft="300">
                        <ListItem>
                          <strong>ID-based:</strong> Match student IDs in input files to IDs in the
                          roster using the existing ID-based matching method.
                        </ListItem>
                        <ListItem>
                          <strong>ID-based with background fuzzy matching:</strong> Records are sent
                          exactly as with ID-based, and no review is needed. IDRS also matches each
                          new job's students in the background and stores its suggestions, for
                          comparison before switching to fuzzy matching.
                        </ListItem>
                        <ListItem>
                          <strong>Fuzzy matching:</strong> Use IDRS to match students on their
                          names, birth dates, schools and IDs together. Records for students without
                          a confident match aren't sent until someone matches or excludes them on
                          the job's Unmatched Students tab.
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
                onClick={onToggleModeHelp}
                aria-expanded={isModeHelpOpen}
                aria-controls="id-matching-mode-help-details"
              >
                {isModeHelpOpen ? 'show less' : 'show more'}
              </Button>
            </VStack>
          </HStack>
        </FormControl>
      </VStack>

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
        isLoading={update.isPending}
        changes={changes}
      />
      <ConfirmModal
        isOpen={isDiscardOpen}
        onClose={onDiscardClose}
        onConfirm={handleDiscardConfirm}
        title="discard changes"
        description="Discard your unsaved changes?"
        confirmLabel="discard"
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
