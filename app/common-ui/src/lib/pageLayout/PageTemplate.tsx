import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Box,
  BoxProps,
  Button,
  ChakraComponent,
  HStack,
  Heading,
  Link,
  List,
  ListItem,
  Text,
  UnorderedList,
  VStack,
  chakra,
} from '@chakra-ui/react';
import { standardizeError } from '@edanalytics/models';
import { useQueryErrorResetBoundary } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { ActionGroup, ActionsType, PageActions } from '..';
import { Link as RouterLink, useLocation } from '@tanstack/react-router';

/**
 * Standard page template
 *
 * There is a CSS class to de-radius the upper right corner of any children with the `.page-content-card` class whenever the page actions are not empty.
 */
export const PageTemplate = (props: {
  title?: ReactNode;
  children?: ReactNode;
  /**
   * @deprecated doesn't do anything. Set width within your content instead.
   */
  constrainWidth?: boolean;
  justifyActionsLeft?: boolean;
  actions?: ActionsType;
  actionsShowCount?: number | undefined | true;
  customPageContentCard?: boolean;
}) => {
  const { reset } = useQueryErrorResetBoundary();
  return (
    <Box
      mx="-0.5rem"
      w="fit-content"
      minW="100%"
      px="0.5rem"
      css={{
        '&:has(.page-actions .chakra-button)>div.page-content-card': {
          borderTopRightRadius: '0',
        },
        '&:has(.page-actions .chakra-button)>div.page-content-card ~ div.page-content-card': {
          borderTopRightRadius: 'var(--chakra-radii-md)',
        },
      }}
    >
      <HStack alignItems="end" justify="space-between" pr="1px">
        <Heading mb={2} whiteSpace="nowrap" color="gray.700" size="page-heading">
          {props.title ?? <>&nbsp;</>}
        </Heading>
        <ErrorBoundary
          onReset={reset}
          FallbackComponent={() => (
            <Text as="i" color="gray.500" fontSize="sm">
              Unable to show actions
            </Text>
          )}
        >
          <ActionGroup
            zIndex={0}
            className="page-actions"
            css={{
              '& > a': {
                borderRadius: 0,
              },
              '& > button': {
                borderRadius: 0,
              },
              // Using first-child causes an error so this and the sibling selector are used instead
              // [class] is needed for precedence purposes
              '& > *[class]': {
                borderTopLeftRadius: 'var(--chakra-radii-md)',
              },
              '& > *:last-child': {
                borderTopRightRadius: 'var(--chakra-radii-md)',
              },
              '& > * + *[class]': {
                borderLeftWidth: '1px',
                borderTopLeftRadius: 0,
              },
            }}
            isAttached
            p={0}
            m={0}
          >
            {props.actions && <PageActions actions={props.actions} show={props.actionsShowCount} />}
          </ActionGroup>
        </ErrorBoundary>
      </HStack>
      <ErrorBoundary
        onReset={reset}
        FallbackComponent={(arg) => {
          const error = standardizeError(arg.error);
          return (
            <Box mr="1px">
              <Alert status="error">
                <AlertIcon />
                <HStack flexGrow={1} alignItems="baseline">
                  <AlertTitle>{error.title}</AlertTitle>
                  <AlertDescription>{error.message || null}</AlertDescription>
                </HStack>
              </Alert>
            </Box>
          );
        }}
      >
        {props.customPageContentCard ? (
          props.children
        ) : (
          <PageContentCard className="page-content-card">{props.children}</PageContentCard>
        )}
      </ErrorBoundary>
    </Box>
  );
};

type DivComponent = ChakraComponent<'div', object>;

export const PageContentCard = ((props: BoxProps) => (
  <chakra.div
    {...{
      mb: 6,
      boxShadow: 'lg',
      border: '1px solid',
      borderColor: 'gray.200',
      borderRadius: 'md',
      bg: 'foreground-bg',
      minW: '100%',
      w: 'fit-content',
      p: '1.5em',
      className: 'page-content-card',
      ...props,
    }}
    css={{
      '& .content-section:not(:last-child)': {
        marginBottom: 'var(--chakra-space-10)',
      },
    }}
  />
)) as DivComponent;

export const NotFoundPage = (props: { entityDisplayName: string }) => {
  const path = useLocation().pathname;
  const displayName =
    props.entityDisplayName.slice(0, 1).toLocaleLowerCase() + props.entityDisplayName.slice(1);
  return (
    <VStack mx="-0.5rem" w="fit-content" minW="100%" px="0.5rem" h="70%" justify="space-around">
      <Box color="gray.600" fontStyle="italic">
        <Text fontWeight="bold" fontStyle="normal" fontSize="large" color="gray.500" mb={4}>
          We can't find {path}
        </Text>
        <Text maxW="50ch" mb={4}>
          Sorry, this {displayName} could not be found. It may not exist, or you may lack access to
          it. Please check with support if you think there is a problem.
        </Text>
        <UnorderedList>
          <ListItem>
            <Link href="/" color="blue.500">
              Go to this site's homepage
            </Link>
          </ListItem>
          <ListItem>
            <Link
              href="https://www.edanalytics.org"
              color="blue.500"
              target="_blank"
              rel="noopener noreferrer"
            >
              Submit a support ticket
            </Link>
          </ListItem>
          <ListItem>Go back</ListItem>
        </UnorderedList>
      </Box>
    </VStack>
  );
};
