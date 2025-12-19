import {
  Button,
  Collapse,
  HStack,
  Icon,
  IconButton,
  Link,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Text,
} from '@chakra-ui/react';
import { BiPlus } from 'react-icons/bi';
import { BsX } from 'react-icons/bs';
import { ColumnFilter, ColumnFilterContent } from './ColumnFilter';
import { DivComponent, useStdTableContext } from './StdTableProvider';

export const StdTableFilters: DivComponent = (props) => {
  const { children, ...rest } = props;
  const {
    table,
    showSettings: [showSettings],
  } = useStdTableContext();

  if (!table) {
    return null as any;
  }

  return (
    <Collapse in={showSettings} animateOpacity>
      <HStack
        borderTop="1px solid"
        borderColor="gray.200"
        pt={3}
        px={2}
        mt={3}
        fontSize="sm"
        {...rest}
      >
        <Sorting />
        <Filters />
      </HStack>
    </Collapse>
  );
};

export const Sorting = () => {
  const { table } = useStdTableContext();

  if (!table) {
    return null as any;
  }
  const sortableColumns = table
    .getAllFlatColumns()
    .filter((column) => column.getCanSort() && !column.getIsSorted());

  const sortingState = table.getState().sorting;

  return (
    <HStack gap={0}>
      <Menu>
        <MenuButton
          isDisabled={!sortableColumns.length}
          title={!sortableColumns.length ? 'No columns available to sort' : undefined}
          variant="outline"
          colorScheme="teal"
          as={Button}
          size="xs"
          rightIcon={<Icon as={BiPlus} />}
          mr={2}
        >
          Add sort
        </MenuButton>
        <MenuList>
          {sortableColumns.map((column) => (
            <MenuItem onClick={() => column.toggleSorting(false, true)} key={column.id}>
              {typeof column.columnDef.header === 'function'
                ? column.columnDef.header({ table, column, header: null as any })
                : column.columnDef.header}
            </MenuItem>
          ))}
        </MenuList>
      </Menu>
      {sortingState.length ? <Text fontWeight="bold">Sort by:</Text> : null}
      {sortingState.map((sort, i) => {
        const column = table.getColumn(sort.id);
        if (!column) {
          table.setSorting([]);
          return null;
        }
        return (
          <HStack key={sort.id + i} h={6} px={2} pr={1} gap={0}>
            <Link
              onClick={() =>
                column.getIsSorted() === 'desc'
                  ? column.toggleSorting(false, true)
                  : column.toggleSorting(true, true)
              }
              as="button"
              key={sort.id}
            >
              {typeof column.columnDef.header === 'function'
                ? column.columnDef.header({ table, column, header: null as any })
                : column.columnDef.header}
              {sort.desc ? <>&darr;</> : <>&uarr;</>}
            </Link>
            <IconButton
              minW="auto"
              variant="link"
              border="1px solid transparent"
              _hover={{
                borderColor: 'gray.400',
              }}
              aria-label="clear column filter"
              icon={<Icon fontSize="md" as={BsX} />}
              size="xs"
              onClick={column.clearSorting}
            />
          </HStack>
        );
      })}
    </HStack>
  );
};

const Filters = () => {
  const { table, pendingFilterColumn, setPendingFilterColumn } = useStdTableContext();

  const isOpen = !!pendingFilterColumn;
  const onClose = () => {
    setPendingFilterColumn(false);
  };
  const onToggle = () => {
    setPendingFilterColumn(pendingFilterColumn ? false : true);
  };

  if (!table) {
    return null as any;
  }
  const filterableColumns = table
    .getAllFlatColumns()
    .filter(
      (column) => column.getCanFilter() && !column.getIsFiltered() && column.columnDef.meta?.type
    );

  const { columnFilters } = table.getState();
  const pendingFilterColumnDef =
    typeof pendingFilterColumn === 'string' ? table.getColumn(pendingFilterColumn) : undefined;

  return (
    <HStack gap={0}>
      <Popover
        returnFocusOnClose={false}
        isOpen={isOpen}
        onClose={onClose}
        placement="bottom-start"
        closeOnBlur={true}
      >
        <PopoverTrigger>
          <Button
            isDisabled={!filterableColumns.length}
            title={!filterableColumns.length ? 'No filters available' : undefined}
            onClick={onToggle}
            variant="outline"
            colorScheme="teal"
            size="xs"
            rightIcon={<Icon as={BiPlus} />}
          >
            Add filter
          </Button>
        </PopoverTrigger>
        {isOpen ? (
          <PopoverContent w="auto">
            <PopoverArrow />
            {pendingFilterColumn === true ? (
              <PopoverBody w="auto" minW="15em" display="block" px={0}>
                {filterableColumns.map((column) => (
                  <Button
                    textAlign="left"
                    width="100%"
                    size="sm"
                    fontWeight="normal"
                    variant="ghost"
                    borderRadius={0}
                    display="block"
                    onClick={() => {
                      setPendingFilterColumn(column.id);
                    }}
                    key={column.id}
                  >
                    {typeof column.columnDef.header === 'function'
                      ? column.columnDef.header({ table, column, header: null as any })
                      : column.columnDef.header}
                  </Button>
                ))}
              </PopoverBody>
            ) : pendingFilterColumnDef ? (
              <ColumnFilterContent
                cancel={() => setPendingFilterColumn(false)}
                apply={(filter) => {
                  pendingFilterColumnDef.setFilterValue(filter);
                  setPendingFilterColumn(false);
                }}
                column={pendingFilterColumnDef}
              />
            ) : null}
          </PopoverContent>
        ) : null}
      </Popover>
      {columnFilters.map((columnFilter) => {
        const column = table.getColumn(columnFilter.id);
        if (column) {
          return <ColumnFilter column={column} key={columnFilter.id} />;
        } else {
          return null;
        }
      })}
    </HStack>
  );
};
