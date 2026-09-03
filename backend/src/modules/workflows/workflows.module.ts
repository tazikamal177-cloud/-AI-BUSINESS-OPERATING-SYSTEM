import { Module } from '@nestjs/common';
import { WorkflowsService } from './workflows.service';
import { WorkflowsController } from './workflows.controller';
import { WebhookController } from './webhook.controller';
import { WorkflowRunner } from './engine/workflow-runner';
import { TriggerHandler } from './engine/handlers/trigger.handler';
import { EndHandler } from './engine/handlers/end.handler';
import { WaitHandler } from './engine/handlers/wait.handler';
import { AgentNodeHandler } from './engine/handlers/agent.handler';
import { ActionNodeHandler } from './engine/handlers/action.handler';
import { ConditionHandler } from './engine/handlers/condition.handler';
import { ParallelHandler } from './engine/handlers/parallel.handler';
import { AuditModule } from '../audit/audit.module';
import { AgentsModule } from '../agents/agents.module';
import { ToolsModule } from '../tools/tools.module';

@Module({
  imports: [AuditModule, AgentsModule, ToolsModule],
  controllers: [WorkflowsController, WebhookController],
  providers: [
    WorkflowsService,
    WorkflowRunner,
    TriggerHandler,
    EndHandler,
    WaitHandler,
    AgentNodeHandler,
    ActionNodeHandler,
    ConditionHandler,
    ParallelHandler,
  ],
  exports: [WorkflowsService, WorkflowRunner],
})
export class WorkflowsModule {}
