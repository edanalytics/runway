import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth/auth.service';
import { IdentityProviderService } from '../auth/login/identity-provider.service';
import { AppConfigService } from '../config/app-config.service';
import {
  PRISMA_ANONYMOUS,
  PRISMA_APP_USER,
  PRISMA_READ_ONLY,
  provideDatabaseService,
  providePrismaAnon,
  providePrismaReadonly,
  providePrismaWrite,
} from '../database/database.service';
import { UsersService } from '../users/users.service';

// const imports = [];
const providers = [
  ConfigService,
  AppConfigService,
  IdentityProviderService,
  AuthService,
  UsersService,
];

@Global()
@Module({
  // imports: imports,
  providers: [
    ...providers,
    provideDatabaseService,
    providePrismaAnon,
    providePrismaWrite,
    providePrismaReadonly,
  ],
  exports: [
    // ...imports,
    ...providers,
    { provide: 'DatabaseService', useExisting: 'DatabaseService' },
    { provide: PRISMA_ANONYMOUS, useExisting: PRISMA_ANONYMOUS },
    { provide: PRISMA_APP_USER, useExisting: PRISMA_APP_USER },
    { provide: PRISMA_READ_ONLY, useExisting: PRISMA_READ_ONLY },
  ],
})
export class ServicesModule {}
