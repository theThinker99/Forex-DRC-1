import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Politique de mot de passe : 12 caracteres minimum avec 3 classes.
 * Un poste de guichet est souvent partage et peu surveille : la longueur
 * prime sur la rotation.
 */
export const PASSWORD_PATTERN =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[\s\S]{12,128}$/;

export const PASSWORD_MESSAGE =
  'Le mot de passe doit contenir au moins 12 caracteres, dont une minuscule, une majuscule et un chiffre.';

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toLowerCase().trim() : value;

export class LoginDto {
  @ApiProperty({ example: 'admin@change-rdc.cd' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Adresse email invalide.' })
  @MaxLength(190)
  email!: string;

  @ApiProperty({ example: 'MotDePasse2026!' })
  @IsString()
  @IsNotEmpty({ message: 'Le mot de passe est obligatoire.' })
  @MaxLength(128)
  password!: string;
}

export class GoogleLoginDto {
  @ApiProperty({
    description:
      'Jeton d\'identite (JWT) renvoye par Google Identity Services cote navigateur.',
  })
  @IsString()
  @IsNotEmpty({ message: 'Le jeton Google est obligatoire.' })
  @MaxLength(4096)
  credential!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ description: 'Mot de passe actuel. Omis si le compte n\'en a pas encore.' })
  @IsString()
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({ example: 'NouveauMotDePasse2026' })
  @IsString()
  @MinLength(12, { message: PASSWORD_MESSAGE })
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_MESSAGE })
  newPassword!: string;
}

export class SetPasswordDto {
  @ApiProperty({
    example: 'MonMotDePasse2026',
    description:
      'Definit un mot de passe sur un compte cree via Google et qui n\'en a pas encore.',
  })
  @IsString()
  @MinLength(12, { message: PASSWORD_MESSAGE })
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_MESSAGE })
  newPassword!: string;
}
