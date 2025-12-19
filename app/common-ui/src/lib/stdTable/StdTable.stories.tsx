import { Box } from '@chakra-ui/react';
import { Meta } from '@storybook/react';
import { StdTable, StdTableFilters, StdTablePagination, StdTableSearch, ValueAsDate } from '.';
import { makeData } from '../dataTable/storybook-helpers/helpers';
import { StdTableProvider } from './StdTableProvider';
import { OnChangeFn, RowSelectionState } from '@tanstack/react-table';
import { useState } from 'react';

const meta: Meta<typeof StdTableProvider> = {
  title: 'StdTable',
  component: StdTableProvider,
};
export default meta;

const people = makeData(25000);
export const Standard = ({ enableRowSelection }: { enableRowSelection: boolean }) => (
  <StdTableProvider
    enableRowSelection={enableRowSelection}
    data={people}
    columns={[
      {
        accessorKey: 'firstName',
        cell: (info) => info.getValue(),
        header: 'First name',
      },
      {
        accessorFn: (row) => row.lastName,
        id: 'lastName',
        cell: (info) => info.getValue(),
        header: 'Last name',
      },
      {
        accessorKey: 'age',
        header: 'Age',
      },
      {
        accessorKey: 'visits',
        header: 'Visits',
        meta: {
          type: 'number',
        },
      },
      {
        accessorKey: 'status',
        header: 'Status',
      },
      {
        accessorKey: 'progress',
        header: 'Profile progress',
      },
      {
        accessorKey: 'createdAt',
        cell: ValueAsDate(),
        header: 'Created on',
        meta: {
          type: 'date',
        },
      },
    ]}
  >
    <Box mb={10}>
      <StdTableSearch />
      <StdTableFilters />
    </Box>
    <StdTable />
    <StdTablePagination />
  </StdTableProvider>
);
export const ControlledSelection = () => {
  const [selectedRows, setSelectedRows] = useState<RowSelectionState>({});
  return <ExternalSelection selectedRows={selectedRows} setSelectedRows={setSelectedRows} />;
};

const ExternalSelection = ({
  selectedRows,
  setSelectedRows,
}: {
  selectedRows: RowSelectionState;
  setSelectedRows: OnChangeFn<RowSelectionState>;
}) => {
  return (
    <StdTableProvider
      enableRowSelection
      rowSelectionState={selectedRows}
      onRowSelectionChange={setSelectedRows}
      data={people}
      columns={[
        {
          accessorKey: 'firstName',
          cell: (info) => info.getValue(),
          header: 'First name',
        },
        {
          accessorFn: (row) => row.lastName,
          id: 'lastName',
          cell: (info) => info.getValue(),
          header: 'Last name',
        },
        {
          accessorKey: 'age',
          header: 'Age',
        },
        {
          accessorKey: 'visits',
          header: 'Visits',
          meta: {
            type: 'number',
          },
        },
        {
          accessorKey: 'status',
          header: 'Status',
        },
        {
          accessorKey: 'progress',
          header: 'Profile progress',
        },
        {
          accessorKey: 'createdAt',
          cell: ValueAsDate(),
          header: 'Created on',
          meta: {
            type: 'date',
          },
        },
      ]}
    >
      <Box mb={10}>
        <StdTableSearch />
        <StdTableFilters />
      </Box>
      <StdTable />
      <StdTablePagination />
      <pre>{JSON.stringify(selectedRows, null, 2)}</pre>
    </StdTableProvider>
  );
};
