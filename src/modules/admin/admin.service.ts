import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateCollaborationRoleDto, UpdateCollaborationRoleDto } from './dto/collaboration-role.dto';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  listRoles() {
    return this.prisma.collaborationRole.findMany({
      where: { archivedAt: null },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });
  }

  createRole(dto: CreateCollaborationRoleDto) {
    return this.prisma.collaborationRole.create({
      data: { name: dto.name, order: dto.order ?? 0 },
    });
  }

  async updateRole(id: string, dto: UpdateCollaborationRoleDto) {
    const exists = await this.prisma.collaborationRole.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException();
    return this.prisma.collaborationRole.update({
      where: { id },
      data: { name: dto.name ?? exists.name, order: dto.order ?? exists.order },
    });
  }

  async archiveRole(id: string) {
    return this.prisma.collaborationRole.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }
}
