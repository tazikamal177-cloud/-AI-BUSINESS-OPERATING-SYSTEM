import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  Query,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Controller('tasks')
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  async findAll(@CurrentUser('sub') userId: string, @Req() req: any, @Query('status') status: string) {
    return this.tasksService.findAll(req.organizationId, userId, status);
  }

  @Get(':taskId')
  async findOne(@Param('taskId') taskId: string, @Req() req: any) {
    return this.tasksService.findOne(req.organizationId, taskId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateTaskDto, @CurrentUser('sub') userId: string, @Req() req: any) {
    return this.tasksService.create(req.organizationId, userId, dto);
  }

  @Put(':taskId')
  async update(@Param('taskId') taskId: string, @Body() dto: UpdateTaskDto, @Req() req: any) {
    return this.tasksService.update(req.organizationId, taskId, dto);
  }

  @Delete(':taskId')
  async remove(@Param('taskId') taskId: string, @Req() req: any) {
    return this.tasksService.remove(req.organizationId, taskId);
  }
}
