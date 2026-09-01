import { Box, HStack, VStack } from '@chakra-ui/react';
import { GetJobDto } from '@edanalytics/models';
import { useState } from 'react';
import { DownloadFileButton } from '../SharedJobComponents/DownloadFileLink';
import { getJobOutputFiles, getOutputFileDownloadUrl } from '../../../api/queries/job.queries';
import { useQuery } from '@tanstack/react-query';

type FileTreeNode = {
  name: string;
  path: string;
  children: FileTreeNode[];
};

/**
 * Output file names may be folder-qualified (e.g. `transformed/results.jsonl`) when
 * earthmover writes into subfolders under the run's output path. Group flat names into
 * a tree so the FE can render the same folder hierarchy as S3.
 */
const buildFileTree = (fileNames: string[]): FileTreeNode[] => {
  const root: FileTreeNode[] = [];
  for (const fullPath of fileNames) {
    let siblings = root;
    let pathSoFar = '';
    for (const segment of fullPath.split('/')) {
      pathSoFar = pathSoFar ? `${pathSoFar}/${segment}` : segment;
      let node = siblings.find((n) => n.name === segment);
      if (!node) {
        node = { name: segment, path: pathSoFar, children: [] };
        siblings.push(node);
      }
      siblings = node.children;
    }
  }
  return root;
};

const FileForDownload = ({ path, name, jobId }: { path: string; name: string; jobId: GetJobDto['id'] }) => {
  const [hasDownloadError, setHasDownloadError] = useState<boolean>(false);
  return (
    <VStack gap="0" alignItems="flex-end" width="100%">
      <HStack gap="400" width="100%" justifyContent="space-between">
        <Box textStyle="bodyBold">{name}</Box>
        <DownloadFileButton
          textStyle="button"
          textColor="green.100"
          fileName={name}
          getPresignedUrl={() => getOutputFileDownloadUrl({ jobId, fileName: path })}
          onError={() => setHasDownloadError(true)}
          onSuccess={() => setHasDownloadError(false)}
        />
      </HStack>
      {hasDownloadError && (
        <Box textStyle="body" textColor="pink.100">
          error downloading file
        </Box>
      )}
    </VStack>
  );
};

const FileTreeNodeView = ({ node, jobId }: { node: FileTreeNode; jobId: GetJobDto['id'] }) => {
  if (node.children.length === 0) {
    return <FileForDownload path={node.path} name={node.name} jobId={jobId} />;
  }

  return (
    <VStack alignItems="flex-start" width="100%" gap="200">
      <Box textStyle="bodyBold">{node.name}/</Box>
      <VStack
        alignItems="flex-start"
        width="100%"
        gap="200"
        paddingLeft="400"
        borderLeft="2px solid"
        borderColor="blue.50-40"
      >
        {node.children.map((child) => (
          <FileTreeNodeView key={child.path} node={child} jobId={jobId} />
        ))}
      </VStack>
    </VStack>
  );
};

export const JobOutputFiles = ({ job }: { job: GetJobDto }) => {
  const outputFiles =  useQuery(getJobOutputFiles(job.id)).data ?? [];
  const tree = buildFileTree(outputFiles.map((file) => file.nameFromUser));

  return (
    <VStack width="100%" alignItems="flex-start" gap="200">
      {tree.map((node) => (
        <FileTreeNodeView key={node.path} node={node} jobId={job.id} />
      ))}
    </VStack>
  );
};
