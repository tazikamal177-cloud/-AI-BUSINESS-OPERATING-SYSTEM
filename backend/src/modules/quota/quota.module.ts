import { Global, Module } from '@nestjs/common';
import { QuotaService } from './quota.service';
import { UsageService } from './usage.service';

@Global()
@Module({
  providers: [QuotaService, UsageService],
  exports: [QuotaService, UsageService],
})
export class QuotaModule {}
