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
import { GetOdsConfigDto, GetSchoolYearWithConfigDto } from '@edanalytics/models';
import { useState } from 'react';
import { useSchoolYears } from '../../helpers/useSchoolYears';
import { useQuery } from '@tanstack/react-query';
import { keyBy } from 'lodash';

export const OdsConfigsPage = () => {
  const { yearsSinceFirstOds } = useSchoolYears();
  // TODO: Two independent queries can cause a brief loading flash — revisit when ODS data is consolidated (PR 5+)
  const { data: odsConfigs } = useQuery(odsConfigQueries.getAll({}));
  const odsConfigByYear = keyBy(odsConfigs, 'schoolYearId');

  const testConnectionQuery = odsConfigQueries.testConnection();
  const testConnection = (odsConfig: GetOdsConfigDto) => {
    testConnectionQuery.mutate({ entity: odsConfig, pathParams: undefined });
  };

  const {
    isOpen: isDeleteModalOpen,
    onOpen: openDeleteModal,
    onClose: closeDeleteModal,
  } = useDisclosure();
  const [yearToDeleteConfig, setYeartoDeleteConfig] = useState<GetSchoolYearWithConfigDto | null>(
    null
  );
  const deleteConnectionQuery = odsConfigQueries.delete();
  const confirmDelete = (year: GetSchoolYearWithConfigDto) => {
    setYeartoDeleteConfig(year);
    openDeleteModal();
  };
  const deleteConfigAndCloseModal = () => {
    if (yearToDeleteConfig) {
      const odsConfig = odsConfigByYear[yearToDeleteConfig.schoolYearId];
      if (odsConfig) {
        deleteConnectionQuery.mutate({ id: odsConfig.id });
      }
    }
    setYeartoDeleteConfig(null);
    closeDeleteModal();
  };

  return (
    <>
      <VStack alignItems="flex-start" gap="500" paddingBottom="800">
        <HStack width="100%" justify="space-between">
          <Box as="h1" textStyle="h1">
            ODS Connections
          </Box>
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
        </HStack>

        <VStack gap="700">
          {yearsSinceFirstOds?.map((y) => {
            const odsConfig = odsConfigByYear[y.schoolYearId] as GetOdsConfigDto | undefined;
            const verified = odsConfig?.lastUseResult === 'success';
            return (
              <Box key={y.schoolYearId} maxWidth="31rem" width="100%">
                <Box as="h2" textStyle="h2" marginBottom="300">
                  {y.startYear} - {y.endYear} school year
                </Box>
                {odsConfig ? (
                  <Box borderWidth="4px" borderColor="blue.600" borderRadius="8px" padding="300">
                    <Box textStyle="body">updated {odsConfig.modifiedOn.toLocaleDateString()}</Box>
                    <Box textStyle="h5" marginBottom="300">
                      {odsConfig.host}
                    </Box>
                    <HStack marginBottom="300" gap="200">
                      <Box
                        bg={verified ? 'green.400' : 'pink.400'}
                        borderRadius="20px"
                        padding="100"
                      >
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
                        isDisabled={testConnectionQuery.isPending}
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
                        onClick={() => confirmDelete(y)}
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
                ) : (
                  <Box textStyle="h3" textColor="blue.300">
                    No ODS added.
                  </Box>
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
            {yearToDeleteConfig?.startYear} - {yearToDeleteConfig?.endYear} school year? This action
            cannot be undone.
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
