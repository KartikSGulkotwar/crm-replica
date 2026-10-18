import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH } from '@crm-replica/shared';
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { MaxBytes, NormalizeEmail, Trim } from '../../common/validation';

export class CredentialsDto {
  @ApiProperty({ example: 'ada@example.com' })
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'correct horse battery staple' })
  @IsString()
  @IsNotEmpty({ message: 'Enter your password' })
  password: string;
}

export class LoginDto extends CredentialsDto {}

/** Used when joining a workspace (signup or invite): the password must meet the rules. */
export class NewAccountDto extends CredentialsDto {
  @ApiProperty({ example: 'Ada Lovelace' })
  @Trim()
  @IsString()
  @Length(1, 100, { message: 'Name must be 1 to 100 characters' })
  name: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  })
  @MaxBytes(PASSWORD_MAX_BYTES, { message: 'Password is too long' })
  declare password: string;
}

export class SignupDto extends NewAccountDto {
  @ApiProperty({ example: 'Acme Inc.' })
  @Trim()
  @IsString()
  @Length(1, 100, { message: 'Workspace name must be 1 to 100 characters' })
  workspaceName: string;
}

export class AcceptInviteDto extends NewAccountDto {}
