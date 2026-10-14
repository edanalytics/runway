import { Box, HStack, VStack, Grid, GridItem, Link } from '@chakra-ui/react';
import { GetJobDto } from '@edanalytics/models';
import { ContactSupport, getSupportLink } from '../../../components/SupportButton';
import { IconCheckmark, IconExclamation } from '../../../../assets/icons';

const countOfString = (
  result: 'failed' | 'success',
  [resource, summary]: [string, { skipped: number; failed: number; success: number }]
) => {
  const count = summary[result];
  return `${count} ${resource} ${count > 1 ? 'resources' : 'resource'}`;
};

export const ResourceSummary = ({ job }: { job: GetJobDto }) => {
  if (!job.resourceSummaries) {
    return null;
  }

  /**
   * The summary from Lightbeam gives us success, skipped, and failed counts,
   * but we only care about success and failed. We also filter to resources in the
   * reportResources array, if it exists. At the time of this writing, all bundles have
   * reportResources defined and only one resource is present: studentAssessments.
   * Although we do need to handle multiple resources for historical jobs and
   * we *maybe* will need to handle them for future jobs, it's not the case
   * we're designing around. For the vast majority of cases, we're reporting on
   * studentAssessments alone. If any fail, we want to highlight that. If all
   * succeed, then we're good.
   */

  const summariesToDisplay =
    job.template.reportResources
      ?.map((resource) => [resource, job.resourceSummaries?.[resource]])
      .filter(
        (entry): entry is [string, { skipped: number; failed: number; success: number }] =>
          entry[1] !== undefined
      ) ?? Object.entries(job.resourceSummaries);

  const failed = summariesToDisplay.filter(([_, summary]) => summary?.failed > 0);
  const failedSum = failed.reduce((acc, [_, summary]) => acc + summary?.failed, 0);
  const success = summariesToDisplay.filter(([_, summary]) => summary?.success > 0);
  const successSum = success.reduce((acc, [_, summary]) => acc + summary?.success, 0);
  const notSent = job.resourceErrors.filter(({ failed }) => failed === 0);
  const notSentNames = notSent.map(({ resource }) => resource).join(', ');

  const supportMessage =
    failed.length > 0
      ? `Resources failed to ${job.sendToOds ? 'send' : 'process'}: ${failed
          .map(([resource, summary]) => `${resource} (${summary.failed})`) // add some info to help triaging
          .join(', ')}`
      : `No resources ${job.sendToOds ? 'sent' : 'processed'}: ${notSentNames}`;

  return (
    <>
      {
        failed.length === 0 && notSent.length === 0 && success.length > 0 ? (
          <Box>
            <HStack gap="200">
              <Box bg="green.300" padding="100" borderRadius="21px">
                <IconCheckmark />
              </Box>
              <Box textStyle="bodyLargeBold">
                {job.sendToOds
                  ? 'Runway sent all resources to the ODS.'
                  : 'Runway processed all resources successfully.'}
              </Box>
            </HStack>
            {!!job.hasIdBasedUnmatchedStudents && (
              <Box marginTop="200" textStyle="body">
                The summary below does not include resources with unmatched student IDs.
              </Box>
            )}
          </Box>
        ) : failed.length > 0 || notSent.length > 0 ? (
          <HStack
            width="100%"
            justifyContent="space-between"
            bg="blue.600"
            padding="400"
            borderRadius="8px"
            gap="400"
          >
            <HStack gap="200">
              <VStack alignItems="flex-start" textColor="blue.50">
                <HStack gap="200">
                  <Box bg="pink.400" padding="200" borderRadius="21px">
                    <IconExclamation />
                  </Box>
                  <Box textStyle="bodyLargeBold">
                    {failed.length === 0
                      ? job.sendToOds
                        ? 'No resources sent to the ODS'
                        : 'No resources processed'
                      : job.sendToOds
                      ? successSum === 0
                        ? 'All resources failed to send to the ODS'
                        : failedSum === 1
                        ? 'Resource failed to send to the ODS'
                        : 'Resources failed to send to the ODS'
                      : successSum === 0
                      ? 'All resources failed to process'
                      : failedSum === 1
                      ? 'Resource failed to process'
                      : 'Resources failed to process'}
                  </Box>
                </HStack>
                <Box textStyle="body">
                  {failed.length === 0
                    ? job.sendToOds
                      ? `Runway didn't send any ${notSentNames} resources to your ODS.`
                      : `Runway didn't process any ${notSentNames} resources.`
                    : job.sendToOds
                    ? failed.length === 1
                      ? `Runway was unable to send ${countOfString('failed', failed[0])}.`
                      : 'Runway was unable to send the resources listed as "Failed" below to your ODS.'
                    : failed.length === 1
                    ? `Runway was unable to process ${countOfString('failed', failed[0])}.`
                    : 'Runway was unable to process the resources listed as "Failed" below.'}{' '}
                  Please contact{' '}
                  <Link
                    href={getSupportLink(supportMessage)}
                    target="_blank"
                    rel="noopener noreferrer"
                    textStyle="bodyBold"
                    _hover={{ textDecoration: 'underline' }}
                  >
                    Runway Support
                  </Link>{' '}
                  so we can help troubleshoot this error.
                </Box>
              </VStack>
            </HStack>
            <ContactSupport message={supportMessage} />
          </HStack>
        ) : null // only when none of the reported resources is in the summary
      }
      <Grid templateColumns="repeat(4, 1fr)" gap="200" width="100%">
        <GridItem textStyle="bodyBold" colSpan={2}>
          Resource
        </GridItem>
        <GridItem textStyle="bodyBold" colSpan={1}>
          Failed
        </GridItem>
        <GridItem textStyle="bodyBold" colSpan={1}>
          Success
        </GridItem>
        {summariesToDisplay
          .sort(([_, a], [__, b]) => b.failed + b.success - (a.failed + a.success)) // resources with the most records sort to the top
          .flatMap(([resource, summary]) => [
            <GridItem textStyle="body" colSpan={2} key={resource}>
              {resource}
            </GridItem>,
            <GridItem textStyle="body" colSpan={1} key={resource + 'failed'}>
              {summary.failed}
            </GridItem>,
            <GridItem textStyle="body" colSpan={1} key={resource + 'success'}>
              {summary.success}
            </GridItem>,
          ])}
      </Grid>
    </>
  );
};
