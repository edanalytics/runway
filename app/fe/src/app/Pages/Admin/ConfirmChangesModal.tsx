import {
  Box,
  Button,
  HStack,
  List,
  ListItem,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
} from '@chakra-ui/react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  changes: string[];
}

export const ConfirmChangesModal = ({ isOpen, onClose, onConfirm, changes }: Props) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>confirm changes</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Box textStyle="body" mb="200">
            The following changes will be saved:
          </Box>
          <List spacing="100">
            {changes.map((change, i) => (
              <ListItem key={i} textStyle="body">
                {change}
              </ListItem>
            ))}
          </List>
        </ModalBody>
        <ModalFooter>
          <HStack gap="200">
            <Button variant="ghost" onClick={onClose}>
              cancel
            </Button>
            <Button layerStyle="buttonPrimary" onClick={onConfirm}>
              confirm
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
