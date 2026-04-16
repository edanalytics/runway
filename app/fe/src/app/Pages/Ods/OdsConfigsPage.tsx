import {
  Box,
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  useDisclosure,
  VStack,
} from '@chakra-ui/react';
import {
  IconCheckmark,
  IconExclamation,
  IconPencil,
  IconPlus,
  IconTrash,
} from '../../../assets/icons';
import { Link as RouterLink } from '@tanstack/react-router';
import { odsConfigQueries } from '../../api';
import { GetOdsConfigDto, GetTenantSchoolYearConfigDto } from '@edanalytics/models';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { tenantSchoolYearConfigQuery } from '../../api/queries/school-year-config.queries';
import { ContactSupport } from '../../components/SupportButton';
import { keyBy } from 'lodash';

export const OdsConfigsPage = () => {
  const { data: yearConfigs } = useQuery(tenantSchoolYearConfigQuery);
  const { data: odsConfigs } = useQuery(odsConfigQueries.getAll({}));
  const odsConfigByYear = keyBy(odsConfigs, 'schoolYearId');

  const sortedYears = [...(yearConfigs ?? [])].sort((a, b) => b.startYear - a.startYear);
  const hasYearNeedingOds = sortedYears.some((y) => y.sendToOds && !y.hasOds);

  const testConnectionQuery = odsConfigQueries.testConnection();
  const testConnection = (odsConfig: GetOdsConfigDto) => {
    testConnectionQuery.mutate({ entity: odsConfig, pathParams: undefined });
  };

  const {
    isOpen: isDeleteModalOpen,
    onOpen: openDeleteModal,
    onClose: closeDeleteModal,
  } = useDisclosure();
  const [yearToDelete, setYearToDelete] = useState<GetTenantSchoolYearConfigDto | null>(null);
  const deleteConnectionQuery = odsConfigQueries.delete();
  const confirmDelete = (yearConfig: GetTenantSchoolYearConfigDto) => {
    setYearToDelete(yearConfig);
    openDeleteModal();
  };
  const deleteConfigAndCloseModal = () => {
    if (yearToDelete) {
      const odsConfig = odsConfigByYear[yearToDelete.schoolYearId];
      if (odsConfig) {
        deleteConnectionQuery.mutate({ id: (odsConfig as GetOdsConfigDto).id });
      }
    }
    setYearToDelete(null);
    closeDeleteModal();
  };

  return (
    <>
      <VStack alignItems="flex-start" gap="500" paddingBottom="800">
        <HStack width="100%" justify="space-between">
          <Box as="h1" textStyle="h1">
            ODS Connections
          </Box>
          {hasYearNeedingOds && (
            <HStack
              as={RouterLink}
              to="/ods-configs/new/connection"
              maxWidth="16.5rem"
              width="100%"
              h="min-content"
              justify="center"
              padding="300"
              gap="200"
              layerStyle="buttonPrimary"
              textStyle="button"
            >
              <Box padding="100">
                <IconPlus />
              </Box>
              <Box textStyle="button" as="span">
                add ODS
              </Box>
            </HStack>
          )}
        </HStack>

        <VStack gap="700">
          {sortedYears.map((yearConfig) => {
            const odsConfig = odsConfigByYear[yearConfig.schoolYearId] as
              | GetOdsConfigDto
              | undefined;
            return (
              <Box key={yearConfig.schoolYearId} maxWidth="31rem" width="100%">
                <Box as="h2" textStyle="h2" marginBottom="300">
                  {yearConfig.startYear} - {yearConfig.endYear} school year
                </Box>
                {yearConfig.sendToOds ? (
                  <OdsYearContent
                    odsConfig={odsConfig}
                    testConnection={testConnection}
                    isTestPending={testConnectionQuery.isPending}
                    onDelete={() => confirmDelete(yearConfig)}
                  />
                ) : (
                  <RosterYearContent hasRoster={yearConfig.hasRoster === true} />
                )}
              </Box>
            );
          })}
        </VStack>
      </VStack>
      <Modal isOpen={isDeleteModalOpen} onClose={closeDeleteModal} closeOnOverlayClick={false}>
        <ModalOverlay />
        <ModalContent bg="blue.50" textColor="green.600" textStyle="h3">
          <ModalHeader>Delete ODS Configuration?</ModalHeader>
          <ModalCloseButton />
          <ModalBody textStyle="body">
            Are you sure you want to delete the ODS configuration for the{' '}
            {yearToDelete?.startYear} - {yearToDelete?.endYear} school year? This action cannot be
            undone.
          </ModalBody>

          <ModalFooter gap="200">
            <Button
              layerStyle="buttonPrimary"
              textStyle="button"
              bg="green.400"
              textColor="blue.50"
              _hover={{ bg: 'green.300' }}
              onClick={deleteConfigAndCloseModal}
            >
              Yes, delete
            </Button>
            <Button
              layerStyle="buttonPrimary"
              textStyle="button"
              bg="transparent"
              textColor="green.600"
              _hover={{ textColor: 'green.400' }}
              onClick={closeDeleteModal}
            >
              No, do not delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
};

const OdsYearContent = ({
  odsConfig,
  testConnection,
  isTestPending,
  onDelete,
}: {
  odsConfig: GetOdsConfigDto | undefined;
  testConnection: (odsConfig: GetOdsConfigDto) => void;
  isTestPending: boolean;
  onDelete: () => void;
}) => {
  if (!odsConfig) {
    return (
      <Box textStyle="h3" textColor="blue.300">
        No ODS added.
      </Box>
    );
  }

  const verified = odsConfig.lastUseResult === 'success';
  return (
    <Box layerStyle="contentBox" padding="300">
      <Box textStyle="body">updated {odsConfig.modifiedOn.toLocaleDateString()}</Box>
      <Box textStyle="h5" marginBottom="300">
        {odsConfig.host}
      </Box>
      <HStack marginBottom="300" gap="200">
        <Box bg={verified ? 'green.400' : 'pink.400'} borderRadius="20px" padding="100">
          {verified ? <IconCheckmark /> : <IconExclamation />}
        </Box>
        <Box textStyle="h6" textColor="green.50">
          {verified ? 'verified' : 'failed verification'}{' '}
          {odsConfig.lastUseOn?.toLocaleDateString()}
        </Box>
        <Button
          onClick={() => testConnection(odsConfig)}
          textStyle="button"
          textColor="green.100"
          variant="unstyled"
          isDisabled={isTestPending}
        >
          refresh
        </Button>
      </HStack>
      <HStack justifyContent="space-between">
        <HStack
          as={Button}
          textStyle="button"
          textColor="pink.100"
          variant="unstyled"
          padding="200"
          gap="200"
          onClick={onDelete}
        >
          <IconTrash />
          <Box>delete</Box>
        </HStack>
        <HStack
          as={RouterLink}
          to={`/ods-configs/${odsConfig.id}/connection`}
          textStyle="button"
          textColor="green.100"
          padding="200"
          gap="200"
        >
          <IconPencil />
          <Box>view / edit</Box>
        </HStack>
      </HStack>
    </Box>
  );
};

const RosterYearContent = ({ hasRoster }: { hasRoster: boolean }) => {
  if (hasRoster) {
    return (
      <Box layerStyle="contentBox" padding="300" width="100%">
        <HStack gap="200">
          <Box bg="green.400" borderRadius="20px" padding="100">
            <IconCheckmark />
          </Box>
          <Box textStyle="h6" textColor="green.50">
            Roster file loaded
          </Box>
        </HStack>
      </Box>
    );
  }

  return (
    <Box layerStyle="contentBox" padding="300">
      <HStack gap="200" justifyContent="space-between">
        <HStack gap="200">
          <Box bg="pink.400" borderRadius="20px" padding="100" flexShrink={0}>
            <IconExclamation />
          </Box>
          <Box textStyle="h6" textColor="pink.50">
            Roster file must be loaded
          </Box>
        </HStack>
        <ContactSupport message="Roster file needs to be loaded for my account." />
      </HStack>
    </Box>
  );
};
