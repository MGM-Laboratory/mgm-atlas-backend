import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { SearchChatDto } from './dto/search-chat.dto';
import { ChatSearchService } from './services/chat-search.service';

/**
 * Full-text chat search. Scope is ALWAYS enforced server-side
 * regardless of the channelId / projectId the client passes — the
 * service intersects the requested scope with the user's accessible
 * project set, so a malicious client can never search a channel
 * they're not an insider of.
 */
@ApiBearerAuth()
@ApiTags('chat')
@Controller('chat/search')
export class ChatSearchController {
  constructor(private readonly search: ChatSearchService) {}

  @Get()
  run(@CurrentUser() user: AuthenticatedUser, @Query() query: SearchChatDto) {
    return this.search.search({
      user,
      scope: query.scope,
      q: query.q,
      channelId: query.channelId,
      projectId: query.projectId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }
}
