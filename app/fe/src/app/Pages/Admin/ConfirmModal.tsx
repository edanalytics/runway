import { ReactNode } from 'react';
import {
  Box,
  Button,
  HStack,
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
  title: string;
  description: string;
  confirmLabel: string;
  // While true, the confirm button shows a spinner and ignores clicks, so a
  // pending action can't be sent twice.
  isLoading?: boolean;
  // Optional extra body content rendered below the description (e.g. a list of
  // pending changes).
  children?: ReactNode;
}

/**
 * Generic confirm/cancel dialog shell. Not used directly — see the intent-named
 * wrappers (ConfirmChangesModal, ConfirmLeaveModal) that own the copy.
 */
export const ConfirmModal = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  isLoading,
  children,
}: Props) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>{title}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Box textStyle="body" mb={children ? '200' : '0'}>
            {description}
          </Box>
          {children}
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
              isLoading={isLoading}
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
