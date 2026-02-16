import {
  Box,
  Button,
  FormControl,
  FormLabel,
  HStack,
  Input,
  VisuallyHidden,
} from '@chakra-ui/react';
import { IconPlus } from '../../../assets/icons';
import { FieldError, FieldValues, Path, UseFormRegisterReturn } from 'react-hook-form';
import { useRef, useState } from 'react';

type FileInputProps<K extends Path<T>, T extends FieldValues> = {
  label: string;
  register: UseFormRegisterReturn<K>;
  onClear: () => void;
  accept?: string | string[];
  error?: FieldError | undefined;
  setError: (message: string) => void;
  clearErrors: () => void;
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
  const inputRef = useRef<HTMLInputElement | null>(null);

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

      setError(
        `${file.name} cannot be uploaded because ${forbiddenExtension} files are not supported.${
          acceptedFileTypes
            ? ` Expected file type${
                acceptedFileTypes.split(',').length > 1 ? 's' : ''
              }: ${acceptedFileTypes}`
            : ''
        }`
      );
      return;
    }

    // File is allowed
    clearErrors();
    setFileName(file.name);
    register.onChange(e);
  };

  return (
    <FormControl variant="file" width="100%">
      <FormLabel textColor="blue.50">
        <Box as="span" textStyle="bodyLargeBold">
          {label}
        </Box>
      </FormLabel>
      <VisuallyHidden>
        <Input
          type="file"
          accept={acceptedFileTypes}
          {...register}
          ref={(e) => {
            register.ref(e);
            inputRef.current = e;
          }}
          onChange={handleFileChange}
        />
      </VisuallyHidden>
      <HStack gap="200" alignItems="baseline">
        <Box textStyle="body" wordBreak="break-word" flex={1}>
          {error ? (
            <Box as="span" textColor="pink.100">
              {error.message}
            </Box>
          ) : fileName ? (
            <Box as="span" textColor="blue.50">
              {fileName}
            </Box>
          ) : (
            <Box as="span" textColor="blue.50" fontStyle="italic">
              no file selected
            </Box>
          )}
        </Box>
        {fileName ? (
          <Button
            variant="unstyled"
            textStyle="button"
            textColor="green.100"
            padding="200"
            flexShrink={0}
            onClick={() => {
              onClear();
              setFileName(null);
            }}
          >
            <Box as="span">&mdash;</Box>
            <Box as="span" ml="200">
              remove file
            </Box>
          </Button>
        ) : (
          <Button variant="unstyled" flexShrink={0} onClick={() => inputRef.current?.click()}>
            <HStack as="span" padding="200" gap="200" textStyle="button" layerStyle="buttonPrimary">
              <IconPlus height={12} width={12} />
              <Box as="span">select file</Box>
            </HStack>
          </Button>
        )}
      </HStack>
    </FormControl>
  );
};
