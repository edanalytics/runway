import { FileService } from '../../../src/files/file.service';

/** Sets the S3 mock's methods to their defaults, so no test inherits another's stubs. */
export const resetFileServiceMock = (fileService: FileService) => {
  const mock = fileService as unknown as Record<string, jest.Mock>;
  mock.getPresignedUploadUrl
    .mockReset()
    .mockImplementation((f) => Promise.resolve(`s3-test-upload-url://${f.fullPath}`));
  mock.getPresignedDownloadUrl
    .mockReset()
    .mockImplementation((f) => Promise.resolve(`s3-test-download-url://${f.fullPath}`));
  mock.listFilesAtPath.mockReset().mockResolvedValue([
    { key: 'test-path/test-file-1', name: 'test-file-1' },
    { key: 'test-path/test-file-2', name: 'test-file-2' },
  ]);
  mock.doesFileExist.mockReset().mockResolvedValue(true);
  mock.doFilesExist.mockReset().mockResolvedValue(true);
};

/** The S3 mock the test app provides in place of FileService, with the defaults applied. */
export const createFileServiceMock = () => {
  const fileService = {
    getPresignedUploadUrl: jest.fn(),
    getPresignedDownloadUrl: jest.fn(),
    listFilesAtPath: jest.fn(),
    doesFileExist: jest.fn(),
    doFilesExist: jest.fn(),
  } as unknown as FileService;
  resetFileServiceMock(fileService);
  return fileService;
};
