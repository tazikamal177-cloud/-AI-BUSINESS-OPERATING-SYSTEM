import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { ToolsService } from './tools.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { CreateToolDto } from './dto/create-tool.dto';

@Controller('tools')
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class ToolsController {
  constructor(private readonly toolsService: ToolsService) {}

  @Get()
  async findAll(@Req() req: any) {
    return this.toolsService.findAll(req.organizationId);
  }

  @Get(':toolId')
  async findOne(@Param('toolId') toolId: string, @Req() req: any) {
    return this.toolsService.findOne(req.organizationId, toolId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateToolDto, @Req() req: any) {
    return this.toolsService.create(req.organizationId, dto);
  }
}
