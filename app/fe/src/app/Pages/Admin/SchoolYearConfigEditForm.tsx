import { GetSchoolYearConfigDto } from '@edanalytics/models';
import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  HStack,
  Switch,
  TableContainer,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  SystemStyleObject,
  useDisclosure,
} from '@chakra-ui/react';
import { useUpdateSchoolYearConfig } from '../../api/queries/school-year-config.queries';
import { useBlocker } from '@tanstack/react-router';
import { RunwayErrorBox } from '../../components/Form/RunwayFormErrorBox';
import { ConfirmChangesModal } from './ConfirmChangesModal';
import { ConfirmModal } from './ConfirmModal';

const switchSx = {
  '.chakra-switch__track': {
    bg: 'blue.800',
    _checked: {
      bg: 'green.300',
    },
  },
  '.chakra-switch__thumb': {
    bg: 'blue.50',
  },
} as const;

interface Props {
  data: GetSchoolYearConfigDto[];
  modifiedAt: string | null;
  tableSx?: SystemStyleObject;
  onCancel: () => void;
  onSaved: () => void;
}

function describeChanges(original: GetSchoolYearConfigDto[], edited: GetSchoolYearConfigDto[]): string[] {
  const changes: string[] = [];
  for (const edit of edited) {
    const orig = original.find((r) => r.schoolYearId === edit.schoolYearId);
    if (!orig) continue;
    const label = `${edit.startYear} - ${edit.endYear}`;
    if (orig.isEnabled !== edit.isEnabled) {
      changes.push(`${label}: enabled ${orig.isEnabled ? 'yes' : 'no'} → ${edit.isEnabled ? 'yes' : 'no'}`);
    }
    if (orig.sendToOds !== edit.sendToOds) {
      changes.push(`${label}: send to ODS ${orig.sendToOds ? 'yes' : 'no'} → ${edit.sendToOds ? 'yes' : 'no'}`);
    }
  }
  return changes;
}

export const SchoolYearConfigEditForm = ({ data, modifiedAt, tableSx, onCancel, onSaved }: Props) => {
  const [rows, setRows] = useState<GetSchoolYearConfigDto[]>(
    data.map((r) => ({ ...r }))
  );
  const [staleError, setStaleError] = useState<{ lastModifiedOn: string; lastModifiedBy: string | null } | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const { isOpen: isSaveOpen, onOpen: onSaveOpen, onClose: onSaveClose } = useDisclosure();
  const { isOpen: isLeaveOpen, onOpen: onLeaveOpen, onClose: onLeaveClose } = useDisclosure();
  const [pendingLeaveAction, setPendingLeaveAction] = useState<null | 'cancel'>(null);
  const mutation = useUpdateSchoolYearConfig();

  const changes = describeChanges(data, rows);
  const hasChanges = changes.length > 0;
  const shouldWarnAboutUnsavedChanges = hasChanges && !mutation.isPending;
  const staleMessage = staleError
    ? `This config was modified${staleError.lastModifiedBy ? ` by ${staleError.lastModifiedBy}` : ''}${
        staleError.lastModifiedOn
          ? ` at ${new Date(staleError.lastModifiedOn).toLocaleString()}`
          : ''
      }. Please reload the page and try again.`
    : null;
  const blocker = useBlocker({
    condition: shouldWarnAboutUnsavedChanges,
  });

  useEffect(() => {
    if (!shouldWarnAboutUnsavedChanges) {
      return;
    }

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

  const updateRow = (schoolYearId: string, field: 'isEnabled' | 'sendToOds', value: boolean) => {
    setRows((prev) =>
      prev.map((r) => (r.schoolYearId === schoolYearId ? { ...r, [field]: value } : r))
    );
  };

  const handleSave = () => {
    if (!hasChanges) return;
    onSaveOpen();
  };

  const handleCancel = () => {
    if (shouldWarnAboutUnsavedChanges) {
      setPendingLeaveAction('cancel');
      onLeaveOpen();
      return;
    }
    onCancel();
  };

  const handleSaveConfirm = () => {
    mutation.mutate(
      {
        modifiedAt,
        rows: rows.map((r) => ({
          schoolYearId: r.schoolYearId,
          isEnabled: r.isEnabled,
          sendToOds: r.sendToOds,
        })),
      },
      {
        onSuccess: () => {
          onSaveClose();
          onSaved();
        },
        onError: (error: any) => {
          onSaveClose();
          if (error?.status === 409 || error?.statusCode === 409) {
            setStaleError({
              lastModifiedOn: error.lastModifiedOn ?? error.data?.lastModifiedOn,
              lastModifiedBy: error.lastModifiedBy ?? error.data?.lastModifiedBy,
            });
          } else {
            setGeneralError('Something went wrong saving your changes. Please try again.');
          }
        },
      }
    );
  };

  const handleLeaveConfirm = () => {
    onLeaveClose();
    if (blocker.status === 'blocked') {
      blocker.proceed();
      return;
    }
    if (pendingLeaveAction === 'cancel') {
      setPendingLeaveAction(null);
      onCancel();
    }
  };

  const handleLeaveCancel = () => {
    onLeaveClose();
    if (blocker.status === 'blocked') {
      blocker.reset();
    }
    setPendingLeaveAction(null);
  };

  return (
    <Box>
      {staleMessage && <RunwayErrorBox message={staleMessage} showButton={false} mb="300" />}
      {generalError && <RunwayErrorBox message={generalError} showButton={false} mb="300" />}

      <TableContainer
        overflow="auto"
        maxWidth="calc(100vw - 320px)"
        layerStyle="contentBox"
        padding="300"
      >
        <Table variant="simple" size="sm" sx={tableSx}>
          <Thead>
            <Tr>
              <Th>School Year</Th>
              <Th>Enabled?</Th>
              <Th>Send to ODS?</Th>
              <Th>ODS Count</Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((row) => (
              <Tr key={row.schoolYearId}>
                <Td>{row.startYear} - {row.endYear}</Td>
                <Td>
                  <Switch
                    isChecked={row.isEnabled}
                    onChange={(e) => updateRow(row.schoolYearId, 'isEnabled', e.target.checked)}
                    sx={switchSx}
                  />
                </Td>
                <Td>
                  <Switch
                    isChecked={row.sendToOds}
                    onChange={(e) => updateRow(row.schoolYearId, 'sendToOds', e.target.checked)}
                    sx={switchSx}
                  />
                </Td>
                <Td>{row.odsCount}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </TableContainer>

      <HStack mt="300" gap="200" justifyContent="space-between" width="100%">
        <Box flex="1" />
        <HStack gap="200">
          <Button
            variant="ghost"
            textStyle="button"
            textColor="green.100"
            px="200"
            py="200"
            _hover={{ bg: 'transparent' }}
            onClick={handleCancel}
            isDisabled={mutation.isPending}
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
            isDisabled={!hasChanges || mutation.isPending}
            isLoading={mutation.isPending}
          >
            save
          </Button>
        </HStack>
      </HStack>

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
        description="You have unsaved school year config changes. Leave without saving?"
        confirmLabel="leave"
      />
    </Box>
  );
};
