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
}: FileInputProps<K, T>) => {
  const [fileName, setFileName] = useState<string | null>(null);

  const acceptedFileTypes = Array.isArray(accept)
    ? accept.map(formatFileType).join(',')
    : formatFileType(accept);

  return (
    <HStack paddingY="200" gap="400" width="100%">
      <FormControl variant="file" padding="0" width="100%">
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
            onChange={(e) => {
              const fileName = e.target.files?.[0]?.name;
              setFileName(fileName ?? null); // just controls display, not form value
              register.onChange(e);
            }}
          />
          {!!error && (
            <Box textStyle="body" textColor="pink.100">
              {error?.message}
            </Box>
          )}
        </HStack>
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
