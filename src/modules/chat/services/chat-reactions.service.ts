import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class ChatReactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async add(messageId: string, userId: string, emoji: string) {
    const message = await this.prisma.chatMessage.findFirst({
      where: { id: messageId, deletedAt: null },
      select: { id: true, channelId: true, channel: { select: { projectId: true } } },
    });
    if (!message) throw new NotFoundException('Message not found.');

    try {
      await this.prisma.chatReaction.create({
        data: { messageId, userId, emoji },
      });
    } catch (err) {
      // Unique-constraint hit → user already reacted with this emoji; idempotent no-op.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
        throw err;
      }
    }
    return {
      messageId,
      channelId: message.channelId,
      projectId: message.channel.projectId,
      emoji,
      userId,
    };
  }

  async remove(messageId: string, userId: string, emoji: string) {
    const message = await this.prisma.chatMessage.findFirst({
      where: { id: messageId },
      select: { id: true, channelId: true, channel: { select: { projectId: true } } },
    });
    if (!message) throw new NotFoundException('Message not found.');

    await this.prisma.chatReaction.deleteMany({ where: { messageId, userId, emoji } });
    return {
      messageId,
      channelId: message.channelId,
      projectId: message.channel.projectId,
      emoji,
      userId,
    };
  }
}
