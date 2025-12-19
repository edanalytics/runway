import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertProps,
  AlertTitle,
  Box,
  CloseButton,
  HStack,
  Link,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  chakra,
} from '@chakra-ui/react';
import { StatusResponse, stdDetailed } from '@edanalytics/utils';
import omit from 'lodash/omit';
import sortBy from 'lodash/sortBy';
import { ReactNode, createContext, useContext, useMemo, useState } from 'react';

type BannerItemData = Omit<StatusResponse, 'message'> & { message?: ReactNode | string };
type BannerItem = BannerItemData | ((props: { onDelete: () => void }) => BannerItemData);

type BannerState = Record<number, BannerItem>;

const NotificationBannerContext = createContext<{
  banners: BannerState;
  setBanners: React.Dispatch<React.SetStateAction<BannerState>>;
}>({
  banners: [],
  setBanners: () => undefined,
});

export const NotificationBannerProvider = (props: { children: ReactNode }) => {
  const [banners, setBanners] = useState<BannerState>({});
  return (
    <NotificationBannerContext.Provider value={{ banners, setBanners }}>
      {props.children}
    </NotificationBannerContext.Provider>
  );
};

export const useBannerContext = () => useContext(NotificationBannerContext);

export const usePopBanner = () => {
  const { setBanners } = useContext(NotificationBannerContext);
  const popBanner = useMemo(
    () => (banner: BannerItem) => {
      const timestamp = Number(new Date());
      setBanners((old) => ({
        ...old,
        [timestamp]: banner,
      }));
    },
    [setBanners]
  );
  return popBanner;
};

export const NotificationBanners = () => {
  const { banners, setBanners } = useBannerContext();

  const onRemove = (key: string) => () => setBanners((value) => omit(value, key));

  return (
    <Box>
      {sortBy(Object.entries(banners), 0).map(([id, banner], i) => {
        const bannerValue =
          typeof banner === 'function' ? banner({ onDelete: onRemove(id) }) : banner;
        const alertProps: Partial<AlertProps> =
          bannerValue.type === 'Error' || bannerValue.type === 'ValidationError'
            ? {
                borderColor: 'red.200',
                bg: 'red.100',
                status: 'error',
              }
            : bannerValue.type === 'RequiresForceDelete' || bannerValue.type === 'Warning'
            ? {
                borderColor: 'orange.200',
                bg: 'orange.100',
                status: 'warning',
              }
            : bannerValue.type === 'Success'
            ? {
                borderColor: 'green.200',
                bg: 'green.100',
                status: 'success',
              }
            : {
                borderColor: 'blue.200',
                bg: 'blue.100',
                status: 'info',
              };
        return (
          <Alert
            pos="initial"
            key={id}
            title={`${stdDetailed(new Date(Number(id)))}${
              bannerValue.regarding ? ` - ${bannerValue.regarding}` : ''
            }`}
            py={1}
            borderBottomWidth="1px"
            borderBottomStyle="solid"
            {...alertProps}
          >
            <AlertIcon />
            <HStack flexGrow={1} alignItems="baseline">
              <AlertTitle>{bannerValue.title}</AlertTitle>
              <AlertDescription>
                {bannerValue.message || null}
                {typeof bannerValue.data === 'object' ? (
                  <Popover trigger="hover">
                    {({ isOpen }) => (
                      <>
                        {' '}
                        <PopoverTrigger>
                          <Link lineHeight="0.7" as="button">
                            (see more)
                          </Link>
                        </PopoverTrigger>
                        <PopoverContent
                          w="auto"
                          boxShadow="lg"
                          display={!isOpen ? 'none' : undefined}
                        >
                          <PopoverArrow />
                          <PopoverBody borderRadius="md" p="unset" overflow="clip">
                            <Box
                              overflow="auto"
                              minH="7rem"
                              maxH="30rem"
                              minW="20rem"
                              maxW="50rem"
                              w="auto"
                              p={2}
                            >
                              <chakra.pre fontSize="sm" whiteSpace="break-spaces">
                                {JSON.stringify(bannerValue.data, null, 2)}
                              </chakra.pre>
                            </Box>
                          </PopoverBody>
                        </PopoverContent>
                      </>
                    )}
                  </Popover>
                ) : null}
              </AlertDescription>
            </HStack>
            <CloseButton onClick={onRemove(id)} />
          </Alert>
        );
      })}
    </Box>
  );
};
