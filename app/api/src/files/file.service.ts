import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class FileService {
  private s3Client: S3Client = new S3Client({ region: process.env.AWS_REGION });
  private logger = new Logger(FileService.name);

  constructor(private readonly appConfig: AppConfigService) {}

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
    const { Contents } = await this.s3Client.send(
      new ListObjectsV2Command({
        Bucket: this.appConfig.s3Bucket(),
        Prefix: prefix,
      })
    );
    return Contents?.map((content) => content.Key);
  }

  async doFilesExist(fullPaths: string[]): Promise<boolean> {
    const results = await Promise.all(
      fullPaths.map(async (fullPath) => {
        try {
          const result = await this.s3Client.send(
            new HeadObjectCommand({
              Bucket: this.appConfig.s3Bucket(),
              Key: fullPath,
            })
          );
          return result.ContentLength !== undefined && result.ContentLength > 0;
        } catch (error) {
          // NotFound or similar errors mean the file doesn't exist
          return false;
        }
      })
    );
    return results.every((exists) => exists);
  }
}
