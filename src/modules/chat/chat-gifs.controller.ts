import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ChatGifsService } from './services/chat-gifs.service';

@ApiBearerAuth()
@ApiTags('chat')
@Controller('chat/gifs')
export class ChatGifsController {
  constructor(private readonly gifs: ChatGifsService) {}

  @Get('config')
  config() {
    // The frontend hides the GIF tab when `available` is false instead
    // of trying to render an empty grid.
    return { available: this.gifs.available() };
  }

  @Get('search')
  search(@Query('q') q: string, @Query('pos') pos?: string) {
    return this.gifs.search(q ?? '', pos);
  }

  @Get('trending')
  trending(@Query('pos') pos?: string) {
    return this.gifs.trending(pos);
  }
}
