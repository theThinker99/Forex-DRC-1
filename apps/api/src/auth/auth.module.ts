import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleIdentityService } from './google-identity.service';
import { PasswordService } from './password.service';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    ConfigModule,
    // global: true — le JwtAuthGuard est enregistre comme guard global dans
    // AppModule et doit pouvoir injecter JwtService sans importer AuthModule.
    // Les secrets sont passes explicitement a chaque signature/verification,
    // car access et refresh utilisent deux cles distinctes.
    JwtModule.register({ global: true }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokensService,
    GoogleIdentityService,
  ],
  exports: [AuthService, PasswordService, TokensService],
})
export class AuthModule {}
