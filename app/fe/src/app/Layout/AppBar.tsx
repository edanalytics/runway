import {
  Box,
  HStack,
  Icon,
  Image,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Text,
  VStack,
} from '@chakra-ui/react';
import { Link as RouterLink } from '@tanstack/react-router';
import axios from 'axios';
import { RxCaretDown } from 'react-icons/rx';
import logoUrl from '../../assets/logo.svg';
import { useMe } from '../api';

export const AppBar = () => {
  const { data: me } = useMe();

  return (
    <HStack
      backgroundColor="blue.50"
      zIndex={2}
      as="header"
      justify="space-between"
      w="100%"
      paddingLeft="400"
      paddingRight="700"
    >
      <RouterLink to="/">
        <Box paddingY="400" paddingLeft="500">
          <Image alt="logo" w="100px" src={logoUrl} />
        </Box>
      </RouterLink>
      <HStack textColor="green.600">
        <Menu>
          <MenuButton as={Box} role="button">
            <HStack gap="200" padding="200">
              <VStack alignItems="baseline" gap="0">
                <Text textStyle="h6">welcome,</Text>
                <Text textStyle="button">{me?.user?.displayName}</Text>
              </VStack>
              <Icon as={RxCaretDown} />
            </HStack>
          </MenuButton>
          <MenuList>
            <MenuItem
              onClick={() => {
                axios
                  .post('/auth/logout', undefined, { withCredentials: true })
                  .then((res) => {
                    window.location.href = res.headers.location;
                  })
                  .catch((err) => console.log(err));
              }}
            >
              Sign out
            </MenuItem>
          </MenuList>
        </Menu>
      </HStack>
    </HStack>
  );
};
