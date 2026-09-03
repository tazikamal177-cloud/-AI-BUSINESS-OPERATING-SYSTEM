import { Module } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { AgentsController } from './agents.controller';
import { AgentRuntimeService } from './agent-runtime.service';
import { AiModule } from '../ai/ai.module';
import { ToolsModule } from '../tools/tools.module';
import { MemoryModule } from '../memory/memory.module';
import { QuotaModule } from '../quota/quota.module';
import { AuditModule } from '../audit/audit.module';
import { TasksModule } from '../tasks/tasks.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';

@Module({
  imports: [AiModule, ToolsModule, MemoryModule, QuotaModule, AuditModule, TasksModule, KnowledgeModule],
  controllers: [AgentsController],
  providers: [AgentsService, AgentRuntimeService],
  exports: [AgentsService, AgentRuntimeService],
})
export class AgentsModule {}
