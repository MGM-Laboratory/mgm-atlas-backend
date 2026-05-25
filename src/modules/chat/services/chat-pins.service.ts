import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class ChatPinsService {
  constructor(private readonly prisma: PrismaService) {}

  list(channelId: string) {
    return this.prisma.chatPinned.findMany({
      where: { channelId },
      orderBy: { position: 'asc' },
      include: {
        message: {
          include: {
            author: { select: { id: true, name: true, avatarUrl: true } },
            attachments: true,
          },
        },
        pinnedBy: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
  }

  async pin(messageId: string, pinnedById: string) {
    const message = await this.prisma.chatMessage.findFirst({
      where: { id: messageId, deletedAt: null },
      select: { id: true, channelId: true, channel: { select: { projectId: true } } },
    });
    if (!message) throw new NotFoundException('Message not found.');

    // Append to the end of the pin list.
    const last = await this.prisma.chatPinned.findFirst({
      where: { channelId: message.channelId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const nextPosition = (last?.position ?? -1) + 1;

    try {
      const pin = await this.prisma.chatPinned.create({
        data: {
          channelId: message.channelId,
          messageId,
          pinnedById,
          position: nextPosition,
        },
      });
      return { pin, channelId: message.channelId, projectId: message.channel.projectId };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Message is already pinned.');
      }
      throw err;
    }
  }

  async unpin(messageId: string) {
    const pin = await this.prisma.chatPinned.findFirst({
      where: { messageId },
      select: { id: true, channelId: true, channel: { select: { projectId: true } } },
    });
    if (!pin) throw new NotFoundException('Pin not found.');

    await this.prisma.chatPinned.delete({ where: { id: pin.id } });
    return { channelId: pin.channelId, projectId: pin.channel.projectId, messageId };
  }
}
