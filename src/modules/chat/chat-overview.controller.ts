import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { ChatOverviewService } from './services/chat-overview.service';

/**
 * Cross-project endpoints used by the navbar shortcut and the
 * /chat global page. Lives at `/chat/me` so it doesn't collide with
 * the project-scoped controller.
 */
@ApiBearerAuth()
@ApiTags('chat')
@Controller('chat/me')
export class ChatOverviewController {
  constructor(private readonly overview: ChatOverviewService) {}

  @Get('projects')
  myProjects(@CurrentUser() user: AuthenticatedUser) {
    return this.overview.listMyProjects(user);
  }
}
