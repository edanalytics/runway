import { Button, ButtonProps } from '@chakra-ui/react';
import { IconDownload } from '../../../../assets/icons';
import { useState } from 'react';

export const DownloadFileButton = ({
  fileName,
  getPresignedUrl,
  label = 'download',
  onError,
  onSuccess,
  ...buttonProps
}: {
  fileName: string;
  getPresignedUrl: () => Promise<string>;
  label?: string;
  onError?: (e: unknown) => void;
  onSuccess?: () => void;
} & Omit<ButtonProps, 'onClick'>) => {
  const [inProcess, setInProcess] = useState<boolean>(false);

  const handleDownload = async () => {
    setInProcess(true);

    try {
      // Get S3 download URL from backend
      const url = await getPresignedUrl();
      if (!url || typeof url !== 'string') {
        throw new Error('Invalid download url');
      }

      // Perform the download
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      if (onSuccess) {
        onSuccess();
      }
    } catch (e) {
      console.error('Error downloading file', e);
      if (onError) {
        onError(e);
      }
    }
    setInProcess(false);
  };

  return (
    <Button
      variant="unstyled"
      leftIcon={<IconDownload />}
      onClick={handleDownload}
      isLoading={inProcess}
      isDisabled={inProcess}
      {...buttonProps}
    >
      {label}
    </Button>
  );
};
