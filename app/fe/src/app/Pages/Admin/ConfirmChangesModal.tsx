import { List, ListItem } from '@chakra-ui/react';
import { ConfirmModal } from './ConfirmModal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  changes: string[];
}

/** Confirms a set of pending edits before saving them. */
export const ConfirmChangesModal = ({ isOpen, onClose, onConfirm, changes }: Props) => (
  <ConfirmModal
    isOpen={isOpen}
    onClose={onClose}
    onConfirm={onConfirm}
    title="confirm changes"
    description="The following changes will be saved:"
    confirmLabel="confirm"
  >
    {changes.length > 0 && (
      <List spacing="100">
        {changes.map((change, i) => (
          <ListItem key={i} textStyle="body">
            {change}
          </ListItem>
        ))}
      </List>
    )}
  </ConfirmModal>
);
