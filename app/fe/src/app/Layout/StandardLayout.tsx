import { Box, Flex, HStack, VStack } from '@chakra-ui/react';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { AppBar } from './AppBar';
import { Nav } from './Nav';
import { Metas } from './Metas';
import { Footer } from './Footer';
import backgroundUrl from '../../assets/background-logo.svg';

export const StandardLayout = () => {
  const matches = useRouterState({ select: (s) => s.matches });
  const hideSideNav = matches[matches.length - 1].context.hideSideNav;

  return (
    <VStack spacing={0} minH="100vh" height="100%" bg="blue.700" color="blue.50">
      <Metas />
      <AppBar />
      <Flex as="main" flexGrow="1" width="100%" flexDirection="column">
        <HStack
          flexGrow="1"
          align="start"
          background={`url("${backgroundUrl}")`} // without double-quotes, vite won't build this properly; this and other style props get dropped
          backgroundRepeat="no-repeat"
          backgroundSize="cover"
          backgroundPosition="top"
          backgroundAttachment="fixed"
          gap="700"
          paddingLeft="400"
          paddingRight="700"
        >
          {!hideSideNav ? (
            <Box position="sticky" top="0" paddingTop="500">
              <Nav />
            </Box>
          ) : null}

          <Box flexGrow={1} height="100%" paddingTop="500">
            <Outlet />
          </Box>
        </HStack>
        <Footer />
      </Flex>
    </VStack>
  );
};
