import { useState } from 'react';
import {
  Box,
  Button,
  HStack,
  Switch,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useDisclosure,
} from '@chakra-ui/react';
import {
  GetSchoolYearConfigDto,
  GetSchoolYearConfigRowDto,
  useUpdateSchoolYearConfig,
} from '../../api/queries/school-year-config.queries';
import { ConfirmChangesModal } from './ConfirmChangesModal';

interface Props {
  data: GetSchoolYearConfigDto;
  onCancel: () => void;
  onSaved: () => void;
}

function describeChanges(original: GetSchoolYearConfigRowDto[], edited: GetSchoolYearConfigRowDto[]): string[] {
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

export const SchoolYearConfigEditForm = ({ data, onCancel, onSaved }: Props) => {
  const [rows, setRows] = useState<GetSchoolYearConfigRowDto[]>(
    data.rows.map((r) => ({ ...r }))
  );
  const [staleError, setStaleError] = useState<{ lastModifiedOn: string; lastModifiedBy: string | null } | null>(null);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const mutation = useUpdateSchoolYearConfig();

  const changes = describeChanges(data.rows, rows);
  const hasChanges = changes.length > 0;

  const updateRow = (schoolYearId: string, field: 'isEnabled' | 'sendToOds', value: boolean) => {
    setRows((prev) =>
      prev.map((r) => (r.schoolYearId === schoolYearId ? { ...r, [field]: value } : r))
    );
  };

  const handleSave = () => {
    if (!hasChanges) return;
    onOpen();
  };

  const handleConfirm = () => {
    onClose();
    const changedRows = rows.filter((edit) => {
      const orig = data.rows.find((r) => r.schoolYearId === edit.schoolYearId);
      return orig && (orig.isEnabled !== edit.isEnabled || orig.sendToOds !== edit.sendToOds);
    });

    mutation.mutate(
      {
        lastModifiedOn: data.lastModifiedOn,
        rows: changedRows.map((r) => ({
          schoolYearId: r.schoolYearId,
          isEnabled: r.isEnabled,
          sendToOds: r.sendToOds,
        })),
      },
      {
        onSuccess: () => {
          onSaved();
        },
        onError: (error: any) => {
          if (error?.status === 409 || error?.statusCode === 409) {
            setStaleError({
              lastModifiedOn: error.lastModifiedOn ?? error.data?.lastModifiedOn,
              lastModifiedBy: error.lastModifiedBy ?? error.data?.lastModifiedBy,
            });
          }
        },
      }
    );
  };

  return (
    <Box>
      {staleError && (
        <Box
          bg="pink.50"
          color="pink.400"
          p="300"
          borderRadius="md"
          mb="300"
        >
          This config was modified
          {staleError.lastModifiedBy ? ` by ${staleError.lastModifiedBy}` : ''}{' '}
          {staleError.lastModifiedOn
            ? `at ${new Date(staleError.lastModifiedOn).toLocaleString()}`
            : ''}
          . Please reload the page and try again.
        </Box>
      )}

      <Table variant="simple" size="sm">
        <Thead>
          <Tr>
            <Th>School Year</Th>
            <Th>Enabled</Th>
            <Th>Send to ODS</Th>
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
                  colorScheme="green"
                />
              </Td>
              <Td>
                <Switch
                  isChecked={row.sendToOds}
                  onChange={(e) => updateRow(row.schoolYearId, 'sendToOds', e.target.checked)}
                  colorScheme="green"
                />
              </Td>
              <Td>{row.odsCount}</Td>
            </Tr>
          ))}
        </Tbody>
      </Table>

      <HStack mt="300" gap="200">
        <Button
          size="sm"
          layerStyle="buttonPrimary"
          onClick={handleSave}
          isDisabled={!hasChanges || mutation.isPending}
          isLoading={mutation.isPending}
        >
          save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} isDisabled={mutation.isPending}>
          cancel
        </Button>
      </HStack>

      <ConfirmChangesModal
        isOpen={isOpen}
        onClose={onClose}
        onConfirm={handleConfirm}
        changes={changes}
      />
    </Box>
  );
};
