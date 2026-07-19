import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  // PasswordService et TokensService viennent d'AuthModule : la creation d'un
  // utilisateur hache un mot de passe, et un changement de role ferme les
  // sessions ouvertes.
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
