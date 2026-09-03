import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { AgentsService } from './agents.service';
import { AgentRuntimeService } from './agent-runtime.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { AttachToolDto } from './dto/attach-tool.dto';
import { AttachKnowledgeDto } from './dto/attach-knowledge.dto';
import { IsOptional, IsString, IsUUID, IsIn } from 'class-validator';
import { Audit } from '../audit/audit.decorator';
import { ApiTags } from '@nestjs/swagger';

class ChatDto {
  @IsString() message: string;
  @IsOptional() @IsUUID() conversationId?: string;
}

class TestDto {
  @IsString() message: string;
}

class CommitQuery {
  @IsOptional() @IsIn(['true', 'false']) commit?: string;
  @IsOptional() @IsString() changeNotes?: string;
}

class DeployDto {
  @IsUUID() versionId: string;
}

class RollbackDto {
  @IsUUID() versionId: string;
}

class CloneTemplateDto {
  @IsString() templateSlug: string;
}

@ApiTags('agents')
@Controller('agents')
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class AgentsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly runtime: AgentRuntimeService,
    private readonly prisma: PrismaService,
  ) {}

  // ──────────────────────────── List / Get ────────────────────────────

  @Get()
  async findAll(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.agents.findAll({
      orgId: req.organizationId,
      status: status as any,
      search,
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
      includeArchived: includeArchived === 'true',
    });
  }

  @Get('templates')
  async getTemplates(@Query('category') category?: string) {
    return this.agents.getTemplates(category);
  }

  @Post('templates/clone')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'agent.clone_from_template', resourceType: 'agent', resourceIdFrom: 'id' })
  async cloneTemplate(
    @Body() dto: CloneTemplateDto,
    @CurrentUser('sub') userId: string,
    @Req() req: any,
  ) {
    return this.agents.cloneFromTemplate(req.organizationId, userId, dto.templateSlug);
  }

  @Get(':agentId')
  async findOne(@Param('agentId') agentId: string, @Req() req: any) {
    return this.agents.findOne(req.organizationId, agentId);
  }

  @Get(':agentId/stats')
  async getStats(@Param('agentId') agentId: string, @Req() req: any) {
    return this.agents.getStats(req.organizationId, agentId);
  }

  // ──────────────────────────── CRUD ────────────────────────────

  @Post()
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'agent.create', resourceType: 'agent', resourceIdFrom: 'id' })
  async create(@Body() dto: CreateAgentDto, @CurrentUser('sub') userId: string, @Req() req: any) {
    return this.agents.create(req.organizationId, userId, dto);
  }

  @Put(':agentId')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN', 'MANAGER')
  async update(
    @Param('agentId') agentId: string,
    @Body() dto: UpdateAgentDto,
    @CurrentUser('sub') userId: string,
    @Query() q: CommitQuery,
    @Req() req: any,
  ) {
    return this.agents.update(req.organizationId, agentId, dto, userId, {
      commitVersion: q.commit === 'true',
      changeNotes: q.changeNotes,
    });
  }

  @Post(':agentId/duplicate')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'agent.duplicate', resourceType: 'agent', resourceIdFrom: 'id' })
  async duplicate(
    @Param('agentId') agentId: string,
    @CurrentUser('sub') userId: string,
    @Req() req: any,
  ) {
    return this.agents.duplicate(req.organizationId, userId, agentId);
  }

  @Delete(':agentId')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  @Audit({ action: 'agent.archive', resourceType: 'agent', resourceIdFrom: 'id' })
  async remove(@Param('agentId') agentId: string, @Req() req: any) {
    return this.agents.archive(req.organizationId, agentId);
  }

  @Post(':agentId/restore')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  async restore(@Param('agentId') agentId: string, @Req() req: any) {
    return this.agents.restore(req.organizationId, agentId);
  }

  @Delete(':agentId/permanent')
  @UseGuards(RolesGuard)
  @Roles('OWNER')
  @Audit({ action: 'agent.hard_delete', resourceType: 'agent' })
  async hardDelete(@Param('agentId') agentId: string, @Req() req: any) {
    return this.agents.hardDelete(req.organizationId, agentId);
  }

  // ──────────────────────────── Versions ────────────────────────────

  @Get(':agentId/versions')
  async listVersions(@Param('agentId') agentId: string, @Req() req: any) {
    return this.agents.listVersions(req.organizationId, agentId);
  }

  @Get(':agentId/versions/:versionId')
  async getVersion(
    @Param('agentId') agentId: string,
    @Param('versionId') versionId: string,
    @Req() req: any,
  ) {
    return this.agents.getVersion(req.organizationId, agentId, versionId);
  }

  @Post(':agentId/versions')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'agent.version.create', resourceType: 'agent_version', resourceIdFrom: 'id' })
  async createVersion(
    @Param('agentId') agentId: string,
    @CurrentUser('sub') userId: string,
    @Body() body: { changeNotes?: string },
    @Req() req: any,
  ) {
    return this.agents.createVersion(req.organizationId, agentId, userId, body.changeNotes);
  }

  // ──────────────────────────── Deploy / Undeploy / Pause / Resume ────────────────────────────

  @Post(':agentId/deploy')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'agent.deploy', resourceType: 'agent' })
  async deploy(@Param('agentId') agentId: string, @Body() dto: DeployDto, @Req() req: any) {
    return this.agents.deployVersion(req.organizationId, agentId, dto.versionId);
  }

  @Post(':agentId/undeploy')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'agent.undeploy', resourceType: 'agent' })
  async undeploy(@Param('agentId') agentId: string, @Req() req: any) {
    return this.agents.undeploy(req.organizationId, agentId);
  }

  @Post(':agentId/pause')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  async pause(@Param('agentId') agentId: string, @Req() req: any) {
    return this.agents.pause(req.organizationId, agentId);
  }

  @Post(':agentId/resume')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  async resume(@Param('agentId') agentId: string, @Req() req: any) {
    return this.agents.resume(req.organizationId, agentId);
  }

  @Post(':agentId/rollback')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'agent.rollback', resourceType: 'agent' })
  async rollback(
    @Param('agentId') agentId: string,
    @Body() dto: RollbackDto,
    @CurrentUser('sub') userId: string,
    @Req() req: any,
  ) {
    return this.agents.rollback(req.organizationId, agentId, dto.versionId, userId);
  }

  // ──────────────────────────── Attach / Detach ────────────────────────────

  @Post(':agentId/tools')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.CREATED)
  async attachTool(
    @Param('agentId') agentId: string,
    @Body() dto: AttachToolDto,
    @Req() req: any,
  ) {
    return this.agents.attachTool(
      req.organizationId,
      agentId,
      dto.toolId,
      (dto as any).configuration,
      (dto as any).permissions,
    );
  }

  @Delete(':agentId/tools/:toolId')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN', 'MANAGER')
  async detachTool(
    @Param('agentId') agentId: string,
    @Param('toolId') toolId: string,
    @Req() req: any,
  ) {
    return this.agents.detachTool(req.organizationId, agentId, toolId);
  }

  @Post(':agentId/knowledge')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN', 'MANAGER')
  @HttpCode(HttpStatus.CREATED)
  async attachKnowledge(
    @Param('agentId') agentId: string,
    @Body() dto: AttachKnowledgeDto,
    @Req() req: any,
  ) {
    return this.agents.attachKnowledge(req.organizationId, agentId, dto.knowledgeBaseId);
  }

  @Delete(':agentId/knowledge/:knowledgeBaseId')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN', 'MANAGER')
  async detachKnowledge(
    @Param('agentId') agentId: string,
    @Param('knowledgeBaseId') knowledgeBaseId: string,
    @Req() req: any,
  ) {
    return this.agents.detachKnowledge(req.organizationId, agentId, knowledgeBaseId);
  }

  // ──────────────────────────── Runtime ────────────────────────────

  @Post(':agentId/test')
  @HttpCode(HttpStatus.OK)
  async test(
    @Param('agentId') agentId: string,
    @Body() dto: TestDto,
    @CurrentUser('sub') userId: string,
    @Req() req: any,
  ) {
    const result = await this.runtime.run(
      {
        organizationId: req.organizationId,
        userId,
        agentId,
        conversationId: '00000000-0000-0000-0000-000000000000',
        message: dto.message,
        dryRun: true,
      },
    );
    return { ok: !result.error, ...result };
  }

  @Post(':agentId/chat')
  async chat(
    @Param('agentId') agentId: string,
    @Body() dto: ChatDto,
    @CurrentUser('sub') userId: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    let conversationId = dto.conversationId;
    if (conversationId) {
      const conv = await this.prisma.conversation.findFirst({
        where: { id: conversationId, organizationId: req.organizationId, agentId, userId },
      });
      if (!conv) conversationId = undefined;
    }
    if (!conversationId) {
      const conv = await this.prisma.conversation.create({
        data: {
          organizationId: req.organizationId,
          agentId,
          userId,
          title: dto.message.slice(0, 80),
        },
      });
      conversationId = conv?.id;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await this.runtime.run(
        {
          organizationId: req.organizationId,
          userId,
          agentId,
          conversationId: conversationId!,
          message: dto.message,
        },
        (event) => send(event.type, event),
      );
      send('message.done', {
        messageId: result.messageId,
        usage: result.usage,
        citations: result.citations,
        toolCalls: result.toolCalls,
        error: result.error,
      });
      res.end();
    } catch (e: any) {
      send('error', { code: e?.code ?? 'INTERNAL', message: e?.message ?? String(e) });
      res.end();
    }
  }
}
