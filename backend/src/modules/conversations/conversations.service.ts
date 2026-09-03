import { Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentRuntimeService } from '../agents/agent-runtime.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agentRuntime: AgentRuntimeService,
  ) {}

  async findAll(orgId: string, userId: string, agentId?: string) {
    return this.prisma.conversation.findMany({
      where: {
        organizationId: orgId,
        userId,
        ...(agentId ? { agentId } : {}),
      },
      include: {
        agent: {
          select: { id: true, name: true, avatarUrl: true },
        },
        _count: {
          select: { messages: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(orgId: string, conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        organizationId: orgId,
        userId,
      },
      include: {
        agent: true,
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return conversation;
  }

  async create(orgId: string, userId: string, dto: CreateConversationDto) {
    // Verify agent exists and belongs to org
    const agent = await this.prisma.agent.findFirst({
      where: { id: dto.agentId, organizationId: orgId },
    });

    if (!agent) {
      throw new NotFoundException('Agent not found');
    }

    return this.prisma.conversation.create({
      data: {
        id: uuidv4(),
        organizationId: orgId,
        agentId: dto.agentId,
        userId,
        title: dto.title || 'New Conversation',
        status: 'ACTIVE',
      },
      include: {
        agent: {
          select: { id: true, name: true, avatarUrl: true },
        },
      },
    });
  }

  async sendMessage(
    orgId: string,
    conversationId: string,
    userId: string,
    dto: SendMessageDto,
    onChunk?: (chunk: string) => void,
  ) {
    // Verify conversation
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        organizationId: orgId,
        userId,
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    // Save user message
    await this.prisma.message.create({
      data: {
        id: uuidv4(),
        conversationId,
        role: 'USER',
        content: dto.message,
      },
    });

    // Execute agent
    const result = await this.agentRuntime.run(
      {
        agentId: conversation.agentId,
        conversationId,
        organizationId: orgId,
        userId,
        message: dto.message,
      },
      onChunk as any,
    );

    // Update conversation timestamp
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    return {
      messageId: result.messageId,
      content: result.content,
      toolCalls: result.toolCalls,
      usage: result.usage,
    };
  }

  async archive(orgId: string, conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        organizationId: orgId,
        userId,
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'ARCHIVED' },
    });
  }

  async remove(orgId: string, conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        organizationId: orgId,
        userId,
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    await this.prisma.conversation.delete({
      where: { id: conversationId },
    });

    return { message: 'Conversation deleted successfully' };
  }
}
