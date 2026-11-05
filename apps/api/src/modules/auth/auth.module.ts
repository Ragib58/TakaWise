import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersController } from '../users/users.controller';
import { UsersService } from '../users/users.service';
import { UserProvisioningService } from '../users/user-provisioning.service';
import { AccessTokenService } from './access-token.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordHasher } from './crypto/password-hasher.service';
import { CsrfGuard } from './guards/csrf.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { SessionsService } from './sessions.service';
import { VerificationService } from './verification.service';

/** Identity: auth flows, sessions and the signed-in user's profile. */
@Module({
  // Secrets and options are passed per call from AppConfig (see AccessTokenService).
  imports: [JwtModule.register({})],
  controllers: [AuthController, UsersController],
  providers: [
    AuthService,
    AccessTokenService,
    PasswordHasher,
    SessionsService,
    VerificationService,
    CsrfGuard,
    JwtAuthGuard,
    UsersService,
    UserProvisioningService,
  ],
  exports: [JwtAuthGuard, AccessTokenService],
})
export class AuthModule {}
