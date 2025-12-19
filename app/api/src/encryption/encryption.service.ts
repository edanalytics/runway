import { Injectable, OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { AppConfigService } from '../config/app-config.service';

/**
 * We have this encryption service because there are various places in the app
 * where we need to encrypt and decrypt data. I looked into use pgcrypto and
 * doing the encryption/decryption as part of the queries, but to call the
 * encrypt/decrypt functions, you need to use raw SQL queries and inject the
 * the encryption key into the query. That makes it so there's not much benefit
 * to using pgcrypto and a clear drawback (i.e. Prisma is less useful). So, here
 * we are.
 *
 * Currently written with node's built-in crypto module.
 * https://nodejs.org/api/crypto.html#class-cipher
 */

@Injectable()
export class EncryptionService implements OnModuleInit {
  private readonly ivLength = 16;
  private readonly algorithm = 'aes-256-cbc';
  private key: string | Buffer;
  constructor(private configService: AppConfigService) {}

  async onModuleInit() {
    const key = await this.configService.encryptionKey();
    if (!key) {
      throw new Error('Unable to find encryption key in config');
    }
    this.key = key;
  }

  encrypt(data: string) {
    const iv = randomBytes(this.ivLength);
    const cipher = createCipheriv(this.algorithm, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);

    return `${iv.toString('hex')}:${encrypted.toString('hex')}`; // IV doesn't need to be secret, just unique and unpredictable
  }

  decrypt(data: string) {
    const [iv, encrypted] = data.split(':').map((part) => Buffer.from(part, 'hex'));
    const decipher = createDecipheriv(this.algorithm, this.key, iv);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf-8');
  }
}
