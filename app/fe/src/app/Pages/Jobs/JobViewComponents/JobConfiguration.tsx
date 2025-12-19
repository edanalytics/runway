import { Box, Grid, GridItem, HStack, VStack } from '@chakra-ui/react';
import { GetFileDto, GetJobDto } from '@edanalytics/models';
import { useState } from 'react';
import { DownloadFileButton } from '../SharedJobComponents/DownloadFileLink';
import { getInputFileDownloadUrl } from '../../../api/queries/job.queries';

const FileForDownload = ({ file }: { file: GetFileDto }) => {
  const [hasDownloadError, setHasDownloadError] = useState<boolean>(false);
  return (
    <VStack
      gap="0"
      justifyContent="flex-start"
      alignItems="flex-end"
      key={`${file.templateKey}-name`}
    >
      <HStack gap="400" width="100%">
        <Box textStyle="bodyBold">{file.nameFromUser}</Box>
        <DownloadFileButton
          textStyle="button"
          textColor="green.100"
          fileName={file.nameFromUser}
          getPresignedUrl={() => getInputFileDownloadUrl(file)}
          onError={() => setHasDownloadError(true)}
          onSuccess={() => setHasDownloadError(false)}
        />
      </HStack>
      {hasDownloadError && (
        <Box textStyle="body" textColor="pink.100" marginTop="-0.5rem">
          error downloading file
        </Box>
      )}
    </VStack>
  );
};

const ConfigCell = ({ children, type }: { children: React.ReactNode; type: 'value' | 'label' }) => {
  return (
    <GridItem
      textStyle={type === 'value' ? 'bodyBold' : 'body'}
      colSpan={type === 'value' ? 3 : 1}
      display="flex"
      alignItems="center"
    >
      {children}
    </GridItem>
  );
};

export const JobConfiguration = ({ job }: { job: GetJobDto }) => {
  return (
    <Grid templateColumns="repeat(4, 1fr)" width="100%" gap="200">
      {[
        ...(job.inputParams ?? []).flatMap((param) => [
          <ConfigCell type="label" key={`${param.templateKey}-label`}>
            {param.name}
          </ConfigCell>,
          <ConfigCell type="value" key={`${param.templateKey}-value`}>
            {param.value}
          </ConfigCell>,
        ]),
        ...job.files.flatMap((file) => [
          <ConfigCell type="label" key={`${file.templateKey}-label`}>
            {job.template.files.find((f) => f.templateKey === file.templateKey)?.name ??
              file.templateKey}
          </ConfigCell>,
          <ConfigCell type="value" key={`${file.templateKey}-value`}>
            <FileForDownload file={file} key={`${file.templateKey}-value`} />
          </ConfigCell>,
        ]),
      ]}
    </Grid>
  );
};
