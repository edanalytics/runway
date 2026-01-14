import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfigService } from '../config/app-config.service';
import { readdir } from 'fs/promises';
import * as path from 'path';

@Injectable()
export class FileService {
  private s3Client: S3Client = new S3Client({ region: process.env.AWS_REGION });
  private logger = new Logger(FileService.name);

  constructor(private readonly appConfig: AppConfigService) {}

  private isLocalMode(): boolean {
    return !!this.appConfig.get('LOCAL_EXECUTOR');
  }

  private localStorageRoot(): string {
    const root = this.appConfig.localStorageRoot();
    if (!root) {
      throw new Error('Local storage root is not configured');
    }
    return root;
  }

  localFilePath(relativePath: string): string {
    const trimmed = relativePath.replace(/^\/+/, '');
    return path.resolve(this.localStorageRoot(), trimmed);
  }

  async getPresignedUploadUrl({ fullPath, fileType }: { fullPath: string; fileType: string }) {
    const command = new PutObjectCommand({
      Bucket: this.appConfig.s3Bucket(),
      Key: fullPath,
      ContentType: fileType,
    });

    return await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
  }

  async getPresignedDownloadUrl({
    fullPath,
    nameForDownload,
  }: {
    fullPath: string;
    nameForDownload: string;
  }) {
    const command = new GetObjectCommand({
      Bucket: this.appConfig.s3Bucket(),
      Key: fullPath,
      ResponseContentDisposition: `attachment; filename="${nameForDownload}"`,
    });
    return await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
  }

  async listFilesAtPath(prefix: string) {
    if (this.isLocalMode()) {
      const normalizedPrefix = prefix.replace(/\/+$/, '');
      const localDir = this.localFilePath(normalizedPrefix);
      const entries = await readdir(localDir, { withFileTypes: true }).catch(() => []);
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => path.posix.join(normalizedPrefix, entry.name));
    }

    const { Contents } = await this.s3Client.send(
      new ListObjectsV2Command({
        Bucket: this.appConfig.s3Bucket(),
        Prefix: prefix,
      })
    );
    return Contents?.map((content) => content.Key);
  }
}
