import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { toUniqueSlug } from '@/common/utils/slug.util';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.tag.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  }

  async grouped() {
    const tags = await this.list();
    const grouped: Record<string, typeof tags> = {};
    for (const t of tags) {
      grouped[t.category] = grouped[t.category] ?? [];
      grouped[t.category].push(t);
    }
    return Object.entries(grouped).map(([category, items]) => ({ category, items }));
  }

  async assertCanManage(userId: string, isAdmin: boolean) {
    if (isAdmin) return;
    const isPm = await this.prisma.projectMember.count({
      where: { userId, role: 'PROJECT_MANAGER' },
    });
    if (isPm === 0) {
      throw new ForbiddenException('Only Admins or Project Managers can configure tags.');
    }
  }

  async create(dto: CreateTagDto) {
    return this.prisma.tag.create({
      data: { name: dto.name.trim(), category: dto.category.trim(), slug: toUniqueSlug(`${dto.category}-${dto.name}`) },
    });
  }

  async update(id: string, dto: UpdateTagDto) {
    const tag = await this.prisma.tag.findUnique({ where: { id } });
    if (!tag) throw new NotFoundException('Tag not found.');
    return this.prisma.tag.update({
      where: { id },
      data: {
        name: dto.name ?? tag.name,
        category: dto.category ?? tag.category,
      },
    });
  }

  async remove(id: string) {
    await this.prisma.tag.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('Tag not found.');
    });
    return { deleted: true };
  }
}
