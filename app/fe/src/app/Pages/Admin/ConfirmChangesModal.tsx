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
  title?: string;
  description?: string;
  confirmLabel?: string;
  changes?: string[];
}

export const ConfirmChangesModal = ({
  isOpen,
  onClose,
  onConfirm,
  title = 'confirm changes',
  description = 'The following changes will be saved:',
  confirmLabel = 'confirm',
  changes = [],
}: Props) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>{title}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Box textStyle="body" mb={changes.length > 0 ? '200' : '0'}>
            {description}
          </Box>
          {changes.length > 0 && (
            <List spacing="100">
              {changes.map((change, i) => (
                <ListItem key={i} textStyle="body">
                  {change}
                </ListItem>
              ))}
            </List>
          )}
        </ModalBody>
        <ModalFooter>
          <HStack gap="200">
            <Button variant="ghost" _hover={{ bg: 'transparent' }} onClick={onClose}>
              cancel
            </Button>
            <Button
              layerStyle="buttonPrimary"
              textStyle="button"
              bg="green.600"
              color="green.50"
              _hover={{ bg: 'green.400' }}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
