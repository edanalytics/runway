import { useState } from 'react';
import {
  Box,
  Button,
  Divider,
  FormLabel,
  HStack,
  List,
  ListItem,
  Text,
  VStack,
  useDisclosure,
} from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { Select } from 'chakra-react-select';
import {
  TenantFuzzyOptInChange,
  tenantFuzzyOptInsQuery,
  useUpdateTenantFuzzyOptIn,
} from '../../api/queries/tenant-fuzzy-opt-in.queries';
import { ConfirmModal } from './ConfirmModal';
import { RunwayErrorBox } from '../../components/Form/RunwayFormErrorBox';

/**
 * The tenants whose new jobs use fuzzy matching whatever the partner's mode.
 * Each add or remove saves one tenant immediately, apart from the partner-wide
 * configuration form.
 */
export const TenantFuzzyOptIns = () => {
  const { data: optIns, isLoading } = useQuery(tenantFuzzyOptInsQuery);
  const update = useUpdateTenantFuzzyOptIn();

  const [selectedTenantCode, setSelectedTenantCode] = useState<string | null>(null);
  // Kept after the modal closes, so its copy doesn't change while it animates out.
  const [change, setChange] = useState<TenantFuzzyOptInChange | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const { isOpen: isConfirmOpen, onOpen: onConfirmOpen, onClose: onConfirmClose } = useDisclosure();

  if (isLoading || !optIns) {
    return <Box textStyle="body">loading...</Box>;
  }

  const optedIn = optIns.tenants.filter((tenant) => tenant.fuzzyOptIn);
  // Options stay client-side: even the largest partner's ~1,000 tenants are one small read.
  const tenantOptions = optIns.tenants
    .filter((tenant) => !tenant.fuzzyOptIn)
    .map(({ tenantCode }) => ({ value: tenantCode, label: tenantCode }));

  const confirmChange = (next: TenantFuzzyOptInChange) => {
    setGeneralError(null);
    setChange(next);
    onConfirmOpen();
  };

  const handleConfirm = () => {
    if (!change) return;
    update.mutate(change, {
      onSuccess: () => {
        onConfirmClose();
        if (change.fuzzyOptIn) setSelectedTenantCode(null);
      },
      onError: (error: any) => {
        onConfirmClose();
        // The IDRS check's 400 carries a message written for the admin.
        setGeneralError(
          error?.statusCode === 400 && typeof error.message === 'string'
            ? error.message
            : 'Something went wrong saving your change. Please try again.'
        );
      },
    });
  };

  return (
    <VStack align="stretch" gap="200" mt="500">
      <Box as="h3" textStyle="h3">
        fuzzy matching pilot
      </Box>

      {generalError && <RunwayErrorBox message={generalError} showButton={false} mb="300" />}

      <VStack layerStyle="contentBox" padding="300" align="stretch" gap="300">
        {optedIn.length > 0 ? (
          // A fixed width, so remove lines up whatever the codes' lengths.
          <List spacing="100" maxWidth="32rem">
            {optedIn.map(({ tenantCode }) => (
              <ListItem key={tenantCode}>
                <HStack justify="space-between" gap="300">
                  <Text textStyle="body" color="blue.50">
                    {tenantCode}
                  </Text>
                  <Button
                    variant="ghost"
                    textStyle="button"
                    textColor="green.100"
                    px="200"
                    py="100"
                    _hover={{ bg: 'transparent' }}
                    aria-label={`remove ${tenantCode}`}
                    onClick={() => confirmChange({ tenantCode, fuzzyOptIn: false })}
                  >
                    remove
                  </Button>
                </HStack>
              </ListItem>
            ))}
          </List>
        ) : (
          <Text textStyle="body" color="blue.50">
            No tenants have been added.
          </Text>
        )}

        <Divider borderColor="blue.50-40" />

        <VStack
          align="stretch"
          gap="100"
          maxWidth="48rem"
          textStyle="caption"
          fontSize="xs"
          color="blue.50"
        >
          <Text>
            Add tenants here to try fuzzy matching in them before switching the whole partner over.
          </Text>
        </VStack>

        <HStack gap="200" align="center">
          <FormLabel
            htmlFor="tenant-fuzzy-opt-in-add"
            mb="0"
            textStyle="body"
            fontWeight="semibold"
            color="blue.50"
            whiteSpace="nowrap"
          >
            Add tenant
          </FormLabel>
          <Box minWidth="22rem">
            {/* The menu matches PartnerConfig's mode menu: dark text on a light menu. */}
            <Select
              inputId="tenant-fuzzy-opt-in-add"
              value={
                selectedTenantCode ? { value: selectedTenantCode, label: selectedTenantCode } : null
              }
              options={tenantOptions}
              onChange={(option) => setSelectedTenantCode(option?.value ?? null)}
              placeholder="type a tenant code"
              isDisabled={update.isPending}
              menuPortalTarget={document.body}
              chakraStyles={{
                control: (baseStyles) => ({ ...baseStyles, bg: 'blue.800', color: 'blue.50' }),
                placeholder: (baseStyles) => ({ ...baseStyles, color: 'blue.100' }),
                dropdownIndicator: (baseStyles) => ({
                  ...baseStyles,
                  bg: 'transparent',
                  color: 'blue.50',
                }),
                menu: (baseStyles) => ({
                  ...baseStyles,
                  textStyle: 'body',
                  textColor: 'blue.700',
                  bg: 'blue.50',
                }),
                menuList: (baseStyles) => ({ ...baseStyles, border: 'none' }),
                option: (baseStyles) => ({ ...baseStyles, padding: '200' }),
              }}
            />
          </Box>
          <Button
            layerStyle="buttonPrimary"
            textStyle="button"
            px="300"
            py="300"
            bg="green.100"
            color="green.600"
            _hover={{ bg: 'green.50' }}
            isDisabled={!selectedTenantCode || update.isPending}
            onClick={() =>
              selectedTenantCode &&
              confirmChange({ tenantCode: selectedTenantCode, fuzzyOptIn: true })
            }
          >
            add
          </Button>
        </HStack>
      </VStack>

      <ConfirmModal
        isOpen={isConfirmOpen}
        onClose={onConfirmClose}
        onConfirm={handleConfirm}
        isLoading={update.isPending}
        title={change?.fuzzyOptIn ? 'add tenant' : 'remove tenant'}
        description={
          change?.fuzzyOptIn
            ? `New jobs in ${change.tenantCode} will use fuzzy matching.`
            : `New jobs in ${change?.tenantCode} will use the partner-wide matching mode.`
        }
        confirmLabel={change?.fuzzyOptIn ? 'add' : 'remove'}
      />
    </VStack>
  );
};
