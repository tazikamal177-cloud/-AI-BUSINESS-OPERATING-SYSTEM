import { Module } from '@nestjs/common';
import { ToolsService } from './tools.service';
import { ToolsController } from './tools.controller';
import { ToolExecutor } from './tool-executor';
import { EcommerceModule } from './ecommerce/ecommerce.module';
import { TasksModule } from '../tasks/tasks.module';
import { AuditModule } from '../audit/audit.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [EcommerceModule, TasksModule, AuditModule, IntegrationsModule],
  controllers: [ToolsController],
  providers: [ToolsService, ToolExecutor],
  exports: [ToolsService, ToolExecutor, EcommerceModule],
})
export class ToolsModule {}
