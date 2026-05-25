import { IsString } from 'class-validator';

export class ForwardMessageDto {
  @IsString()
  targetChannelId!: string;
}
