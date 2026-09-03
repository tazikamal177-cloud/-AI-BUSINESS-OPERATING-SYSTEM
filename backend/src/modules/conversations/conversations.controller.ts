import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Delete,
  Patch,
  UseGuards,
  HttpCode,
  HttpStatus,
  Sse,
  MessageEvent,
  Req,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';

@Controller('conversations')
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  async findAll(@CurrentUser('sub') userId: string, @Req() req: any) {
    return this.conversationsService.findAll(req.organizationId, userId);
  }

  @Get(':conversationId')
  async findOne(
    @Param('conversationId') conversationId: string,
    @CurrentUser('sub') userId: string,
    @Req() req: any,
  ) {
    return this.conversationsService.findOne(req.organizationId, conversationId, userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateConversationDto,
    @CurrentUser('sub') userId: string,
    @Req() req: any,
  ) {
    return this.conversationsService.create(req.organizationId, userId, dto);
  }

  @Post(':conversationId/messages')
  async sendMessage(
    @Param('conversationId') conversationId: string,
    @Body() dto: SendMessageDto,
    @CurrentUser('sub') userId: string,
    @Req() req: any,
  ) {
    return this.conversationsService.sendMessage(req.organizationId, conversationId, userId, dto);
  }

  @Sse(':conversationId/messages/stream')
  streamMessage(
    @Param('conversationId') conversationId: string,
    @Body() dto: SendMessageDto,
    @CurrentUser('sub') userId: string,
    @Req() req: any,
  ): Observable<MessageEvent> {
    return new Observable<string>((subscriber) => {
      this.conversationsService.sendMessage(
        req.organizationId,
        conversationId,
        userId,
        dto,
        (chunk) => subscriber.next(chunk),
      )
        .then(() => subscriber.complete())
        .catch((err) => subscriber.error(err));
    }).pipe(
      map((chunk) => ({
        data: { chunk, timestamp: new Date().toISOString() },
      })),
    );
  }

  @Patch(':conversationId/archive')
  async archive(
    @Param('conversationId') conversationId: string,
    @CurrentUser('sub') userId: string,
    @Req() req: any,
  ) {
    return this.conversationsService.archive(req.organizationId, conversationId, userId);
  }

  @Delete(':conversationId')
  async remove(
    @Param('conversationId') conversationId: string,
    @CurrentUser('sub') userId: string,
    @Req() req: any,
  ) {
    return this.conversationsService.remove(req.organizationId, conversationId, userId);
  }
}
