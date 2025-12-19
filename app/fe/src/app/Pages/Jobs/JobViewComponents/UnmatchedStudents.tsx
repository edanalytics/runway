import { Box, HStack, Text, VStack } from '@chakra-ui/react';
import { GetJobDto } from '@edanalytics/models';
import { DownloadFileButton } from '../SharedJobComponents/DownloadFileLink';
import { SecondaryNavLink } from '../../../components/links';
import { IconUpload } from '../../../../assets/icons/IconUpload';
import { getOutputFileDownloadUrl } from '../../../api/queries/job.queries';
import { IconExclamation } from '../../../../assets/icons';

export const UnmatchedStudents = ({ job }: { job: GetJobDto }) => {
  if (!job.unmatchedStudentsFile) {
    return null;
  }
  const fileName = job.unmatchedStudentsFile.name;
  const columnName = job.lastRun?.unmatchedStudentsInfo?.name;
  let displayIDType = job.lastRun?.unmatchedStudentsInfo?.type;
  const unmatchedStudentsCount = job.lastRun?.unmatchedStudentsInfo?.count;
  if (displayIDType && !displayIDType.toLowerCase().endsWith('id')) {
    displayIDType = `${displayIDType} ID`; // make it easier to construct text below
  }

  return (
    <Box padding="300" borderRadius="8px" backgroundColor="blue.600">
      <Box textStyle="bodyBold">
        <HStack gap="200" mb="200">
          <Box bg="pink.400" padding="200" borderRadius="21px">
            <IconExclamation />
          </Box>

          <Box textStyle="bodyLargeBold">
            {unmatchedStudentsCount
              ? `${unmatchedStudentsCount} student ${
                  unmatchedStudentsCount > 1 ? 'IDs' : 'ID'
                } could not be matched`
              : 'Some student IDs could not be matched'}
          </Box>
        </HStack>
        <Box textStyle="body" mb="400">
          Follow the steps below to update the student IDs and reprocess the file.
        </Box>
        <VStack as="ol" align="flex-start" paddingLeft="400">
          <UnmatchedStudentStep>
            <Box>Download the list</Box>
            <DownloadFileButton
              fileName={fileName}
              getPresignedUrl={() => getOutputFileDownloadUrl({ jobId: job.id, fileName })}
              label="download list"
              textColor="green.100"
              minWidth="fit-content"
            />
          </UnmatchedStudentStep>
          <UnmatchedStudentStep>
            <Box minW="fit-content">Look up the correct student IDs</Box>
            <Box textStyle="body" textAlign="right" maxWidth="70%">
              {displayIDType && (
                <>
                  Find the student's <Emphasized text={displayIDType} />.{' '}
                </>
              )}
              If the file already contains the correct ID, then the student likely does not exist in
              the ODS. Contact your district administrator.
            </Box>
          </UnmatchedStudentStep>
          <UnmatchedStudentStep>
            <Box minW="fit-content">Update the file</Box>
            {displayIDType && columnName ? (
              <Box textStyle="body" textAlign="right">
                Update the <Emphasized text={columnName} /> column with each student's{' '}
                <Emphasized text={displayIDType} />
              </Box>
            ) : (
              <Box textStyle="body" textAlign="right">
                Update the file with the correct ID.
              </Box>
            )}
          </UnmatchedStudentStep>
          <UnmatchedStudentStep isLast>
            <Box>Upload the revised file</Box>
            <SecondaryNavLink
              text="upload revised"
              color="green.600"
              backgroundColor="green.100"
              borderRadius="8px"
              minWidth="fit-content"
              icon={IconUpload}
              to="/assessments/new"
            />
          </UnmatchedStudentStep>
        </VStack>
      </Box>
    </Box>
  );
};

const Emphasized = ({ text }: { text: string }) => {
  return (
    <Text as="span" textStyle="bodyBold">
      {text}
    </Text>
  );
};

const UnmatchedStudentStep = ({
  children,
  isLast = false,
}: {
  children: React.ReactNode;
  isLast?: boolean;
}) => {
  return (
    <Box as="li" width="100%" paddingX="200">
      <HStack
        justifyContent="space-between"
        borderBottom={isLast ? 'none' : '2px solid'}
        borderColor={isLast ? 'transparent' : 'blue.50-40'}
        paddingY="200"
        gap="200"
      >
        {children}
      </HStack>
    </Box>
  );
};
