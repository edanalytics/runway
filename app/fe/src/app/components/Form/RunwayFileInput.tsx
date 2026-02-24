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
import {
  Control,
  FieldPath,
  FieldValues,
  useController,
  UseControllerProps,
} from 'react-hook-form';
import { useRef, useState } from 'react';

type FileInputProps<T extends FieldValues, K extends FieldPath<T>> = {
  label: string;
  accept?: string | string[];
  name: K;
  control: Control<T>;
  rules?: UseControllerProps<T, K>['rules'];
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

export const RunwayFileInput = <T extends FieldValues, K extends FieldPath<T>>({
  label,
  accept,
  name,
  control,
  rules,
}: FileInputProps<T, K>) => {
  const { field, fieldState } = useController({ name, control, rules });
  const [forbiddenError, setForbiddenError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const acceptedFileTypes = Array.isArray(accept)
    ? accept.map(formatFileType).join(',')
    : formatFileType(accept);

  const fileName: string | null = field.value?.[0]?.name ?? null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      field.onChange(null);
      return;
    }

    const fileNameLower = file.name.toLowerCase();
    const forbiddenExtension = FORBIDDEN_EXTENSIONS.find((ext) => fileNameLower.endsWith(ext));
    if (forbiddenExtension) {
      e.target.value = '';
      field.onChange(null);
      setForbiddenError(
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

    setForbiddenError(null);
    field.onChange(e.target.files);
  };

  const errorMessage = forbiddenError || fieldState.error?.message;

  return (
    <FormControl variant="file" width="100%" paddingX="0px">
      <FormLabel textColor="blue.50">
        <Box as="span" textStyle="bodyLargeBold">
          {label}
        </Box>
      </FormLabel>
      <VisuallyHidden>
        <Input type="file" accept={acceptedFileTypes} ref={inputRef} onChange={handleFileChange} />
      </VisuallyHidden>
      <HStack gap="200" alignItems="baseline">
        <Box textStyle="body" wordBreak="break-word" flex={1}>
          {errorMessage ? (
            <Box as="span" textColor="pink.100">
              {errorMessage}
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
              setForbiddenError(null);
              field.onChange(null);
              if (inputRef.current) inputRef.current.value = '';
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
