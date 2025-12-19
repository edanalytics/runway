import { Box, Button, HStack, Text, Textarea, VStack } from '@chakra-ui/react';
import { GetJobNoteDto, NOTE_CHAR_LIMIT } from '@edanalytics/models';
import { useEffect, useRef, useState } from 'react';
import { deleteJobNote, putJobNote } from '../../../api/queries/job-note-queries';
import { useMutation } from '@tanstack/react-query';
import { stdMed } from '@edanalytics/utils';
import { ConfirmAction } from '@edanalytics/common-ui';

export const JobNote = ({ note }: { note: GetJobNoteDto }) => {
  const [isEditing, setIsEditing] = useState(false);
  const putNote = useMutation(putJobNote(note.jobId, note.id));
  const deleteNote = useMutation(deleteJobNote(note.jobId, note.id));

  if (isEditing) {
    return (
      <EditJobNote
        onCancel={() => setIsEditing(false)}
        onSave={(text) => {
          putNote.mutate({ noteText: text });
          setIsEditing(false);
        }}
        text={note.noteText}
      />
    );
  }

  return (
    <VStack width="100%" alignItems="flex-start" gap="100">
      <HStack
        justifyContent="space-between"
        width="100%"
        gap="200"
        fontSize="0.875rem"
        fontWeight="200"
      >
        <HStack gap="300" flexGrow={1}>
          <Text>
            <Text as="span" fontWeight="600">
              {note.createdBy?.displayName}
            </Text>
            {` ${stdMed(note.createdOn)}`}
            {!!note.modifiedBy &&
              (note.modifiedById === note.createdById ? (
                `, edited ${stdMed(note.modifiedOn)}`
              ) : (
                <>
                  {`, edited by `}
                  <Text as="span" fontWeight="600">
                    {note.modifiedBy?.displayName}
                  </Text>
                  {` ${stdMed(note.modifiedOn)}`}
                </>
              ))}
          </Text>
        </HStack>
        <HStack gap="200" width="fit-content" justifyContent="flex-end">
          <ConfirmAction
            headerText="Delete note?"
            bodyText="This note will be permanently deleted."
            yesButtonText="yes, delete it"
            noButtonText="no, keep it"
            action={() => deleteNote.mutate()}
          >
            {(confirmProps) => (
              <>
                <Button variant="secondary" size="xs" fontWeight="200" {...confirmProps}>
                  delete
                </Button>
              </>
            )}
          </ConfirmAction>
          <Button variant="secondary" size="xs" onClick={() => setIsEditing(true)}>
            edit
          </Button>
        </HStack>
      </HStack>
      <Box textStyle="body" wordBreak="break-word" whiteSpace="pre-line">
        {note.noteText}
      </Box>
    </VStack>
  );
};

export const EditJobNote = ({
  onCancel,
  onSave,
  text,
}: {
  onCancel: () => void;
  onSave: (text: string) => void;
  text: string;
}) => {
  const [noteText, setNoteText] = useState(text);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (textAreaRef.current) {
      textAreaRef.current.focus();
      textAreaRef.current.setSelectionRange(noteText.length, noteText.length);
    }
  }, []);

  return (
    <VStack width="100%" alignItems="flex-end">
      <Textarea
        backgroundColor="blue.50"
        color="blue.700"
        ref={textAreaRef}
        placeholder="Add a note"
        rows={2}
        value={noteText}
        onChange={(e) => setNoteText(e.target.value)}
      />
      <HStack gap="200">
        {noteText.length >= NOTE_CHAR_LIMIT * 0.95 && (
          <Box fontSize="0.875rem" fontWeight="200" color="pink.100">
            {noteText.length > NOTE_CHAR_LIMIT
              ? `character limit exceeded`
              : `${NOTE_CHAR_LIMIT - noteText.length} characters remaining`}
          </Box>
        )}
        {noteText === text ? (
          <Button variant="secondary" size="sm" onClick={onCancel}>
            cancel
          </Button>
        ) : (
          <ConfirmAction
            headerText="Cancel editing?"
            bodyText="Any updates you made will be lost."
            yesButtonText="yes, cancel"
            noButtonText="no, continue editing"
            action={onCancel}
          >
            {(confirmProps) => (
              <Button variant="secondary" size="sm" {...confirmProps}>
                cancel
              </Button>
            )}
          </ConfirmAction>
        )}
        <Button
          layerStyle="buttonPrimary"
          backgroundColor="green.100"
          color="green.600"
          _hover={{
            backgroundColor: 'green.50',
          }}
          size="sm"
          onClick={() => onSave(noteText)}
          isDisabled={noteText.length > NOTE_CHAR_LIMIT || noteText.trim().length === 0}
        >
          save
        </Button>
      </HStack>
    </VStack>
  );
};
