import { Box, Button, FormControl, FormLabel, HStack, Input } from '@chakra-ui/react';
import { IconPlus } from '../../../assets/icons';
import { FieldError, FieldValues, Path, UseFormRegisterReturn } from 'react-hook-form';
import { useState } from 'react';

type FileInputProps<K extends Path<T>, T extends FieldValues> = {
  label: string;
  register: UseFormRegisterReturn<K>;
  onClear: () => void;
  accept?: string | string[];
  error?: FieldError | undefined;
  setError?: (message: string) => void;
  clearErrors?: () => void;
};

// Forbidden file extensions. This is a front-end only, UX check, so users can
// select a new file right away instead of waiting for their job to fail. It is
// NOT a security check.
const FORBIDDEN_EXTENSIONS = [
  '.xlsx',
  '.xls',
  '.pdf',
  '.doc',
  '.docx',
  '.zip',
  '.ppt',
  '.pptx',
  '.exe',
] as const;

const formatFileType = (fileType: string | undefined) =>
  fileType &&
  !fileType.includes('/') && // ignore MIME types (e.g. application/pdf)
  !fileType.startsWith('.')
    ? `.${fileType}`
    : fileType;

export const RunwayFileInput = <K extends Path<T>, T extends FieldValues>({
  label,
  register,
  onClear,
  error,
  accept,
  setError,
  clearErrors,
}: FileInputProps<K, T>) => {
  const [fileName, setFileName] = useState<string | null>(null);

  const acceptedFileTypes = Array.isArray(accept)
    ? accept.map(formatFileType).join(',')
    : formatFileType(accept);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setFileName(null);
      register.onChange(e);
      return;
    }

    const fileNameLower = file.name.toLowerCase();
    const forbiddenExtension = FORBIDDEN_EXTENSIONS.find((ext) => fileNameLower.endsWith(ext));
    if (forbiddenExtension) {
      // Clear the input value so the user can try again
      e.target.value = '';
      setFileName(null);

      if (setError) {
        setError(
          `${file.name} cannot be uploaded because ${forbiddenExtension} files are not supported. ${
            acceptedFileTypes
              ? `Expected file type${
                  acceptedFileTypes.split(',').length > 1 ? 's' : ''
                }: ${acceptedFileTypes}`
              : ''
          }`
        );
      }
      return;
    }

    // File is allowed
    if (clearErrors) {
      clearErrors();
    }
    setFileName(file.name);
    register.onChange(e);
  };

  return (
    <HStack paddingY="200" gap="400" width="100%" alignItems="baseline">
      <FormControl variant="file" padding="0">
        <HStack justifyContent="flex-start" gap="400">
          <FormLabel
            variant="file"
            textColor="blue.50"
            width="100%"
            tabIndex={fileName ? -1 : 0} // remove file input from tab order if file is already selected
            onKeyDown={(e) => {
              // allow opening file input with keyboard
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.currentTarget.click();
              }
            }}
          >
            <HStack as="span" gap="400" justifyContent="space-between">
              <Box as="span" textStyle="bodyLargeBold">
                {label}
              </Box>
              {fileName ? (
                <Box as="span" textStyle="body">
                  {fileName}
                </Box>
              ) : (
                <HStack
                  as="span"
                  padding="200"
                  gap="200"
                  textStyle="button"
                  layerStyle="buttonPrimary"
                >
                  <IconPlus height={12} width={12} />
                  <Box as="span">select file</Box>
                </HStack>
              )}
            </HStack>
          </FormLabel>
          <Input
            display="none"
            type="file"
            accept={acceptedFileTypes}
            {...register}
            onChange={handleFileChange}
          />
        </HStack>
        {!!error && (
          <Box textStyle="body" textColor="pink.100" marginTop="200" wordBreak="break-word">
            {error?.message}
          </Box>
        )}
      </FormControl>
      {fileName && onClear && (
        <Button
          variant="unstyled"
          textStyle="button"
          textColor="green.100"
          padding="200"
          onClick={() => {
            onClear();
            setFileName(null);
          }}
        >
          <Box as="span"> &mdash;</Box>
          <Box as="span" ml="200">
            remove file
          </Box>
        </Button>
      )}
    </HStack>
  );
};
