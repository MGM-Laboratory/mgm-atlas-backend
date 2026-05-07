import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { AdminGuard } from '../auth/guards/admin.guard';
import { SetAdminDto } from './dto/set-admin.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UsersService } from './users.service';

@ApiBearerAuth()
@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.users.getMe(user.id);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMeDto) {
    return this.users.updateMe(user.id, dto);
  }

  @Get('me/dashboard')
  dashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.users.getDashboard(user.id);
  }

  @Get('me/bookmarks')
  listBookmarks(@CurrentUser() user: AuthenticatedUser) {
    return this.users.listBookmarks(user.id);
  }

  @Post('me/bookmarks/:projectId')
  addBookmark(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.users.addBookmark(user.id, projectId);
  }

  @Delete('me/bookmarks/:projectId')
  removeBookmark(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.users.removeBookmark(user.id, projectId);
  }

  @Get()
  list(
    @Query('q') search?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.users.listUsers({ search, page, pageSize });
  }

  @Patch(':id/admin')
  @UseGuards(AdminGuard)
  setAdmin(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetAdminDto,
  ) {
    return this.users.setAdmin(actor.id, id, dto.isAdmin);
  }
}
