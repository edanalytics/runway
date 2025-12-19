import { Button, Flex, StackDivider, VStack } from '@chakra-ui/react';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { GetJobDto } from '@edanalytics/models';
import { getJobNotes, postJobNote } from '../../../api/queries/job-note-queries';
import { JobNote, EditJobNote } from './JobNote';
import { IconPlus } from '../../../../assets/icons/IconPlus';
import { useState } from 'react';

const AddNoteButton = ({ onClick }: { onClick: () => void }) => (
  <Button variant="primary" size="sm" color="green.100" leftIcon={<IconPlus />} onClick={onClick}>
    add note
  </Button>
);

export const JobNotes = ({ job }: { job: GetJobDto }) => {
  const { data: notes } = useSuspenseQuery(getJobNotes(job.id));
  const [isCreatingNote, setIsCreatingNote] = useState(false);
  const postNote = useMutation(postJobNote(job.id));

  if (notes?.length === 0 && !isCreatingNote) {
    // when no notes, show button just above the existing content pane.
    // Might want to refactor so positioning is controlled by the parent
    // rather than in here, but works ok for now
    return (
      <Flex width="100%" justifyContent="flex-end" marginBottom="-2rem">
        <AddNoteButton onClick={() => setIsCreatingNote(true)} />
      </Flex>
    );
  }

  return (
    <VStack
      width="100%"
      alignItems="flex-start"
      padding="400"
      layerStyle="contentBox"
      gap="200"
      divider={<StackDivider borderColor="blue.50-40" />}
    >
      {notes?.map((note) => (
        <JobNote key={note.id} note={note} />
      ))}
      {isCreatingNote ? (
        <EditJobNote
          onCancel={() => setIsCreatingNote(false)}
          onSave={(text) => {
            setIsCreatingNote(false);
            postNote.mutate({ noteText: text });
          }}
          text=""
        />
      ) : (
        <Flex width="100%" justifyContent="flex-end">
          <AddNoteButton onClick={() => setIsCreatingNote(true)} />
        </Flex>
      )}
    </VStack>
  );
};
