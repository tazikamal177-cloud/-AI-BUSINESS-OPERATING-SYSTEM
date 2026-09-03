import {
  Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { WorkflowsService } from './workflows.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';

@Controller('workflows')
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get()
  list(@Req() req: any) {
    return this.workflows.list(req.organizationId);
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: any) {
    return this.workflows.get(req.organizationId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateWorkflowDto, @Req() req: any) {
    return this.workflows.create(req.organizationId, req.user.sub, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWorkflowDto, @Req() req: any) {
    return this.workflows.update(req.organizationId, req.user.sub, id, dto);
  }

  @Post(':id/activate')
  activate(@Param('id') id: string, @Req() req: any) {
    return this.workflows.activate(req.organizationId, req.user.sub, id);
  }

  @Post(':id/pause')
  pause(@Param('id') id: string, @Req() req: any) {
    return this.workflows.pause(req.organizationId, req.user.sub, id);
  }

  @Delete(':id')
  archive(@Param('id') id: string, @Req() req: any) {
    return this.workflows.archive(req.organizationId, req.user.sub, id);
  }

  // Runs
  @Post(':id/run')
  @HttpCode(HttpStatus.ACCEPTED)
  run(@Param('id') id: string, @Body() body: { trigger?: Record<string, unknown> } | undefined, @Req() req: any) {
    return this.workflows.runWorkflow(req.organizationId, req.user.sub, id, body?.trigger ?? {});
  }

  @Get(':id/runs')
  runs(@Param('id') id: string, @Req() req: any) {
    return this.workflows.listRuns(req.organizationId, id);
  }

  @Get(':id/runs/:runId')
  getRun(@Param('id') id: string, @Param('runId') runId: string, @Req() req: any) {
    return this.workflows.getRun(req.organizationId, runId);
  }

  @Post(':id/runs/:runId/cancel')
  cancelRun(@Param('runId') runId: string, @Req() req: any) {
    return this.workflows.cancelRun(req.organizationId, runId);
  }
}
