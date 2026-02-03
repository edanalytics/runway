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

// Forbidden file extensions (case-insensitive check)
const FORBIDDEN_EXTENSIONS = ['.xlsx', '.xls', '.pdf', '.doc', '.docx', '.zip'] as const;

// Forbidden MIME types
// Note: application/vnd.ms-excel is intentionally NOT forbidden as it can be used for CSVs
const FORBIDDEN_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/zip',
  'application/x-zip-compressed',
] as const;

// Maps MIME types to their corresponding extensions for error messages
// Only used when the file is missing an extension.
const MIME_TO_EXTENSION: Record<
  (typeof FORBIDDEN_MIME_TYPES)[number],
  (typeof FORBIDDEN_EXTENSIONS)[number]
> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
};

/**
 * Checks if a file has a forbidden type based on extension or MIME type.
 *
 * We use both extension and MIME type because we cannot rely on either to be
 * present or accurate.
 */
const getForbiddenFileExtension = (file: File): string | null => {
  // Check extension
  const fileName = file.name.toLowerCase();
  const forbiddenExtension = FORBIDDEN_EXTENSIONS.find((ext) => fileName.endsWith(ext));
  if (forbiddenExtension) {
    return forbiddenExtension;
  }

  // Check MIME type
  const mimeType = file.type.toLowerCase(); // can be empty string, but that'll fail the .find below
  const forbiddenMime = FORBIDDEN_MIME_TYPES.find((forbidden) => forbidden === mimeType);
  if (forbiddenMime) {
    return MIME_TO_EXTENSION[forbiddenMime];
  }

  return null;
};

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

    const forbiddenExtension = getForbiddenFileExtension(file);
    if (forbiddenExtension) {
      // Clear the input value so the user can try again
      e.target.value = '';
      setFileName(null);

      if (setError) {
        setError(`${file.name} cannot be uploaded. ${forbiddenExtension} files are not supported.`);
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
    <HStack paddingY="200" gap="400" width="100%" alignItems="flex-start">
      <FormControl variant="file" padding="0" width="24rem">
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
