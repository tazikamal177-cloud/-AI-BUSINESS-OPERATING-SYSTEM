import { Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(orgId: string, userId: string, status?: string) {
    return this.prisma.task.findMany({
      where: {
        organizationId: orgId,
        ...(status ? { status: status as any } : {}),
      },
      include: {
        assignee: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(orgId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId: orgId },
      include: {
        assignee: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    return task;
  }

  async create(orgId: string, userId: string, dto: CreateTaskDto) {
    return this.prisma.task.create({
      data: {
        id: uuidv4(),
        organizationId: orgId,
        agentId: dto.agentId,
        assignedTo: dto.assignedTo,
        title: dto.title,
        description: dto.description,
        priority: (dto.priority || 'MEDIUM') as any,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        source: dto.source || 'manual',
      },
    });
  }

  async update(orgId: string, taskId: string, dto: UpdateTaskDto) {
    const existing = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId: orgId },
    });

    if (!existing) {
      throw new NotFoundException('Task not found');
    }

    return this.prisma.task.update({
      where: { id: taskId },
      data: {
        title: dto.title,
        description: dto.description,
        status: dto.status as any,
        priority: dto.priority as any,
        assignedTo: dto.assignedTo,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        result: dto.result,
        completedAt: dto.status === 'COMPLETED' ? new Date() : undefined,
      },
    });
  }

  async remove(orgId: string, taskId: string) {
    const existing = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId: orgId },
    });

    if (!existing) {
      throw new NotFoundException('Task not found');
    }

    await this.prisma.task.delete({
      where: { id: taskId },
    });

    return { message: 'Task deleted successfully' };
  }

  /**
   * Create a "REQUIRES_APPROVAL" task. Used by the Agent Runtime when a
   * high-risk tool is invoked. The task holds the tool call details in
   * `result` and is approved/rejected by a Manager/Owner.
   */
  async createApprovalTask(opts: {
    organizationId: string;
    agentId?: string;
    conversationId?: string;
    title: string;
    description: string;
    payload: Record<string, unknown>;
  }) {
    return this.prisma.task.create({
      data: {
        organizationId: opts.organizationId,
        agentId: opts.agentId,
        title: opts.title,
        description: opts.description,
        priority: 'HIGH',
        status: 'REQUIRES_APPROVAL',
        source: 'agent_hitl',
        sourceId: opts.conversationId,
        result: opts.payload as any,
      },
    });
  }
}
