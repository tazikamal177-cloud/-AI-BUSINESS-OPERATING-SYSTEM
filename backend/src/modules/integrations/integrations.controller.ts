import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { CreateIntegrationDto } from './dto/create-integration.dto';
import { IsObject, IsOptional, IsString } from 'class-validator';

class UpdateIntegrationDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsObject() configuration?: Record<string, unknown>;
}

class RotateCredentialDto {
  @IsString() key!: string;
  @IsString() value!: string;
}

@Controller('integrations')
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  /** List connector types that the platform knows about. */
  @Get('connectors')
  connectors() {
    return this.integrations.listConnectors();
  }

  @Get()
  list(@Req() req: any) {
    return this.integrations.list(req.organizationId);
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: any) {
    return this.integrations.get(req.organizationId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateIntegrationDto, @Req() req: any) {
    return this.integrations.create(req.organizationId, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateIntegrationDto, @Req() req: any) {
    return this.integrations.update(req.organizationId, id, dto);
  }

  @Post(':id/rotate')
  @HttpCode(HttpStatus.OK)
  rotate(@Param('id') id: string, @Body() dto: RotateCredentialDto, @Req() req: any) {
    return this.integrations.rotateCredential(req.organizationId, id, dto.key, dto.value);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  test(@Param('id') id: string, @Req() req: any) {
    return this.integrations.test(req.organizationId, id);
  }

  @Delete(':id')
  archive(@Param('id') id: string, @Req() req: any) {
    return this.integrations.archive(req.organizationId, id);
  }
}
