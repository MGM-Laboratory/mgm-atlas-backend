import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ChatStickersService } from './services/chat-stickers.service';

/**
 * Public sticker library read endpoints. Any authenticated user can
 * fetch the active packs; the picker hides itself for non-insiders
 * since chat UI is gated upstream by access.isInsider.
 */
@ApiBearerAuth()
@ApiTags('chat')
@Controller('chat/stickers')
export class ChatStickersController {
  constructor(private readonly stickers: ChatStickersService) {}

  @Get('packs')
  packs() {
    return this.stickers.listActivePacks();
  }
}
