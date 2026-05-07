import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateCollaborationRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(48)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class UpdateCollaborationRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(48)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
