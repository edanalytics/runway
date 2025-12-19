// PaginationControls.tsx
import { IconButton, ButtonGroup, HStack, Icon, Select, Text, StackProps } from '@chakra-ui/react';
import React from 'react';
import { FiChevronLeft, FiChevronRight, FiChevronsLeft, FiChevronsRight } from 'react-icons/fi';

interface PaginationControlsProps {
  pageIndex: number;
  pageCount: number;
  canPreviousPage: boolean;
  canNextPage: boolean;
  onFirstPage: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onLastPage: () => void;
  pageSizes: number[];
  pageSize: number;
  onPageSizeChange: (size: number) => void;
}

export const PaginationControls: React.FC<PaginationControlsProps & StackProps> = ({
  pageIndex,
  pageCount,
  canPreviousPage,
  canNextPage,
  onFirstPage,
  onPreviousPage,
  onNextPage,
  onLastPage,
  pageSizes,
  pageSize,
  onPageSizeChange,
  ...props
}) => {
  return (
    <HStack justify="center" p={4} {...props}>
      <ButtonGroup size="sm" variant="outline">
        <IconButton
          aria-label="First Page"
          w={8}
          borderRadius={'8em'}
          onClick={onFirstPage}
          isDisabled={!canPreviousPage}
          icon={<Icon as={FiChevronsLeft} />}
        />
        <IconButton
          aria-label="Previous Page"
          w={8}
          borderRadius={'8em'}
          onClick={onPreviousPage}
          isDisabled={!canPreviousPage}
          icon={<Icon as={FiChevronLeft} />}
        />
      </ButtonGroup>
      <Text>
        {pageIndex + 1}&nbsp;of&nbsp;{pageCount}
      </Text>
      <ButtonGroup size="sm" variant="outline">
        <IconButton
          aria-label="Next Page"
          w={8}
          borderRadius={'8em'}
          onClick={onNextPage}
          isDisabled={!canNextPage}
          icon={<Icon as={FiChevronRight} />}
        />
        <IconButton
          aria-label="Last Page"
          w={8}
          borderRadius={'8em'}
          onClick={onLastPage}
          isDisabled={!canNextPage}
          icon={<Icon as={FiChevronsRight} />}
        />
      </ButtonGroup>
      {pageSizes.length > 1 && (
        <Select
          size="sm"
          w="auto"
          value={String(pageSize)}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
        >
          {pageSizes.map((size) => (
            <option key={size} value={size}>
              Show {size}
            </option>
          ))}
        </Select>
      )}
    </HStack>
  );
};
