import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LinkPreviewRequestDto } from './dto/link-preview.dto';
import { ChatLinkPreviewService } from './services/chat-link-preview.service';

/**
 * Open Graph preview proxy. Any authenticated user can fetch a
 * preview — keys/URLs aren't sensitive — but the SSRF guard inside
 * the service prevents pivoting to internal hosts.
 */
@ApiBearerAuth()
@ApiTags('chat')
@Controller('chat/link-preview')
export class ChatLinkPreviewController {
  constructor(private readonly preview: ChatLinkPreviewService) {}

  @Post()
  resolve(@Body() dto: LinkPreviewRequestDto) {
    return this.preview.resolve(dto.url);
  }
}
