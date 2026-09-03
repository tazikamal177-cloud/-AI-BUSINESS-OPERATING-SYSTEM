import { Module } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { IntegrationsController } from './integrations.controller';
import { CredentialsService } from './credentials.service';
import {
  CrmConnector,
  EmailConnector,
  GoogleCalendarConnector,
} from './connectors/connectors';

@Module({
  controllers: [IntegrationsController],
  providers: [
    IntegrationsService,
    CredentialsService,
    EmailConnector,
    GoogleCalendarConnector,
    CrmConnector,
  ],
  exports: [IntegrationsService, CredentialsService],
})
export class IntegrationsModule {}
