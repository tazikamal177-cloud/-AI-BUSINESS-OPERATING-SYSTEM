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
  UploadedFile,
  UseInterceptors,
  Req,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { KnowledgeService } from './knowledge.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';
import { UpdateKnowledgeBaseDto } from './dto/update-knowledge-base.dto';
import { SearchKnowledgeDto } from './dto/search-knowledge.dto';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

@Controller('knowledge-bases')
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  // ──────────────────────── Knowledge Bases ────────────────────────

  @Get()
  list(@Req() req: any) {
    return this.knowledge.listBases(req.organizationId);
  }

  @Get(':kbId')
  get(@Param('kbId') kbId: string, @Req() req: any) {
    return this.knowledge.getBase(req.organizationId, kbId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateKnowledgeBaseDto, @Req() req: any) {
    return this.knowledge.createBase(req.organizationId, dto);
  }

  @Patch(':kbId')
  update(
    @Param('kbId') kbId: string,
    @Body() dto: UpdateKnowledgeBaseDto,
    @Req() req: any,
  ) {
    return this.knowledge.updateBase(req.organizationId, kbId, dto);
  }

  @Delete(':kbId')
  archive(@Param('kbId') kbId: string, @Req() req: any) {
    return this.knowledge.archiveBase(req.organizationId, kbId);
  }

  // ──────────────────────── Documents ────────────────────────

  @Get(':kbId/documents')
  listDocuments(@Param('kbId') kbId: string, @Req() req: any) {
    return this.knowledge.listDocuments(req.organizationId, kbId);
  }

  @Post(':kbId/documents')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_SIZE },
    }),
  )
  @HttpCode(HttpStatus.CREATED)
  async upload(
    @Param('kbId') kbId: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined,
    @CurrentUser('sub') userId: string,
    @Body('url') url: string | undefined,
    @Req() req: any,
  ) {
    if (!file && !url) {
      throw new BadRequestException('Either file or url is required');
    }
    return this.knowledge.uploadDocument({
      organizationId: req.organizationId,
      userId,
      knowledgeBaseId: kbId,
      buffer: file?.buffer ?? undefined,
      filename: file?.originalname ?? (url ? 'webpage' : 'document'),
      mimeType: file?.mimetype ?? 'text/html',
      url,
    });
  }

  @Post(':kbId/documents/:documentId/reindex')
  reindex(
    @Param('kbId') kbId: string,
    @Param('documentId') documentId: string,
    @Req() req: any,
  ) {
    return this.knowledge.reindexDocument(req.organizationId, documentId);
  }

  @Delete(':kbId/documents/:documentId')
  removeDocument(
    @Param('documentId') documentId: string,
    @Req() req: any,
  ) {
    return this.knowledge.deleteDocument(req.organizationId, documentId);
  }

  // ──────────────────────── Search (debug) ────────────────────────

  @Post(':kbId/search')
  @HttpCode(HttpStatus.OK)
  search(
    @Param('kbId') kbId: string,
    @Body() dto: SearchKnowledgeDto,
    @Req() req: any,
  ) {
    return this.knowledge.debugSearch(req.organizationId, kbId, dto.query, dto.topK);
  }

  /** Legacy GET variant for quick debugging. */
  @Get(':kbId/search')
  searchGet(
    @Param('kbId') kbId: string,
    @Query() dto: SearchKnowledgeDto,
    @Req() req: any,
  ) {
    return this.knowledge.debugSearch(req.organizationId, kbId, dto.query, dto.topK);
  }
}
