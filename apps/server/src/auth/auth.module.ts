import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { loadEnv } from '../config/env';
import { MetadataModule } from '../metadata/metadata.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { SESSION_TTL_SECONDS } from './session-cookie';
import { UserEntity } from './user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity]),
    JwtModule.register({
      secret: loadEnv().JWT_SECRET,
      signOptions: { expiresIn: SESSION_TTL_SECONDS },
    }),
    // Applied only to signup / login / accept-invite (see ThrottlerGuard in AuthController).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: loadEnv().AUTH_RATE_LIMIT }]),
    WorkspaceModule,
    MetadataModule,
    ApiKeysModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Order matters: authenticate first, then check roles.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
