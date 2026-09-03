import { Module } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeController } from './knowledge.controller';
import { RagService } from './rag.service';
import { AiModule } from '../ai/ai.module';
import { AuditModule } from '../audit/audit.module';
import { TextChunker } from './chunker/text-chunker';
import {
  CsvExtractor,
  DocxExtractor,
  HtmlExtractor,
  PdfExtractor,
  TextExtractor,
  UrlExtractor,
} from './extractors/extractors';

@Module({
  imports: [AiModule, AuditModule],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeService,
    RagService,
    TextChunker,
    PdfExtractor,
    DocxExtractor,
    TextExtractor,
    CsvExtractor,
    HtmlExtractor,
    UrlExtractor,
  ],
  exports: [KnowledgeService, RagService],
})
export class KnowledgeModule {}
