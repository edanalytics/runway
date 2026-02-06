import { GetJobDto } from '@edanalytics/models';
import { Box, Button, Collapse, HStack, Text } from '@chakra-ui/react';
import { StdTable, StdTablePagination, StdTableProvider } from '@edanalytics/common-ui';
import { JobStatus, statusToLabel } from './SharedJobComponents/JobStatus';
import { Row } from '@tanstack/react-table';
import { Link as RouterLink } from '@tanstack/react-router';
import { RunwayStdTableSearch } from '../../components/Table/RunwayStdTableSearch';
import { RunwayStdTable } from '../../components/Table/RunwayStdTable';
import { RunwayStdTablePagination } from '../../components/Table/RunwayStdTablePagination';

export const JobsTable = ({ jobs }: { jobs: GetJobDto[] }) => {
  return (
    <StdTableProvider
      data={jobs}
      columns={[
        {
          header: 'ID',
          accessorKey: 'id',
          cell: ({ row }: { row: Row<GetJobDto> }) => {
            return (
              <Text
                as={RouterLink}
                to={`/assessments/${row.original.id}`}
                textStyle="button"
                textColor="green.100"
                whiteSpace="nowrap"
              >
                {/* TODO: maybe hide "View" when not hovered to reduce visual clutter */}
                {row.original.id} - view
              </Text>
            );
          },
        },
        {
          header: 'Assessment',
          accessorKey: 'name',
          meta: {
            type: 'options',
          },
        },
        {
          header: 'School Year',
          accessorKey: 'schoolYear.displayName',
          meta: {
            type: 'options',
          },
        },
        {
          header: 'Status',
          accessorFn: (row) => statusToLabel({ job: row }),
          cell: ({ row }: { row: Row<GetJobDto> }) => (
            <JobStatus job={row.original} allowStatusChange={true} />
          ),
          sortingFn: 'alphanumeric', // we might want to sort by the order in which a job moves through statuses, but I doubt that'll be as intuitive as alpha (plus there's no clear precedence between error and success)
          meta: {
            type: 'options',
          },
        },
        {
          header: 'File',
          accessorFn: (row) => row.files.map((file) => file.nameFromUser).join(', '),
          cell: ({ row }: { row: Row<GetJobDto> }) => {
            return (
              <Box
                title={row.original.files.map((file) => file.nameFromUser).join(', ')}
                maxWidth="20rem"
                overflow="hidden"
                textOverflow="ellipsis"
              >
                {row.original.files.map((file) => file.nameFromUser).join(', ')}
              </Box>
            );
          },
          meta: {
            type: 'str-equals',
          },
        },
        {
          header: 'Date',
          accessorFn: (row) => (row.lastRun?.createdOn ? row.lastRun.createdOn.getTime() : null),
          sortingFn: 'datetime',
          cell: ({ row }: { row: Row<GetJobDto> }) => row.original.displayStartedOn,
          meta: {
            type: 'date',
          },
        },

        {
          header: 'User',
          accessorFn: (row) =>
            row.createdBy ? row.createdBy.displayName : row.apiClientName ?? null,
          meta: {
            type: 'options',
          },
        },
      ]}
    >
      <RunwayStdTableSearch mb="200" />
      <RunwayStdTable />
      <RunwayStdTablePagination />
    </StdTableProvider>
  );
};
