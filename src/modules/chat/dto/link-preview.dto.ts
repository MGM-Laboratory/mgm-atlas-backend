import { IsString, IsUrl, MaxLength } from 'class-validator';

export class LinkPreviewRequestDto {
  @IsString()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'], require_tld: true })
  @MaxLength(2048)
  url!: string;
}
