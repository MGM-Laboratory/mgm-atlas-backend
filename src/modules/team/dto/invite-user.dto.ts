import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ProjectRole } from '@prisma/client';

export class InviteUserDto {
  @IsUUID()
  userId!: string;

  @IsEnum(ProjectRole)
  role!: ProjectRole;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}
