import { HStack, Link, VStack, Text } from '@chakra-ui/react';
import eaLogoUrl from '../../assets/ea-logo.svg';
import { SUPPORT_LINK } from '../helpers/constants';

export const Footer = () => {
  return (
    <HStack
      as="footer"
      bg="blue.50"
      color="green.600"
      w="100%"
      justify="space-between"
      paddingY="400"
      paddingX="700"
    >
      <VStack gap="200" alignItems="baseline">
        <Text textStyle="accent" py="200">
          brought to you by
        </Text>
        <img src={eaLogoUrl} />
      </VStack>
      <VStack gap="200" alignItems="end">
        <HStack textStyle="button" color="green.400" gap="200">
          <Link
            href="https://www.edanalytics.org/product-privacy-policy"
            target="_blank"
            rel="noopener noreferrer"
            padding="200"
          >
            privacy policy
          </Link>
          <Link href={SUPPORT_LINK} padding="200" target="_blank" rel="noopener noreferrer">
            support
          </Link>
        </HStack>

        <Text textStyle="body">
          ©{new Date().getFullYear()} Education Analytics, Inc. All Rights Reserved.
        </Text>
      </VStack>
    </HStack>
  );
};
