import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Body of POST /auth/login. The token fields are the credential; the
 * identity fields (keycloakId, email, name, picture) are hints only —
 * when token verification is on (default) the authoritative identity
 * comes out of the verified token, not this payload.
 */
export class LoginDto {
  @IsString()
  @IsNotEmpty()
  keycloakId!: string;

  @IsString()
  email!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  picture?: string;

  @IsString()
  @IsNotEmpty()
  accessToken!: string;

  @IsOptional()
  @IsString()
  refreshToken?: string;

  @IsOptional()
  @IsString()
  idToken?: string;
}
