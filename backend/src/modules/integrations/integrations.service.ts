import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CredentialsService } from './credentials.service';
import {
  CrmConnector,
  EmailConnector,
  GoogleCalendarConnector,
} from './connectors/connectors';
import { Connector, ConnectorContext, ConnectorResult } from './connectors/connector.types';
import { CreateIntegrationDto } from './dto/create-integration.dto';

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);
  private readonly connectors: Map<string, Connector>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CredentialsService,
    email: EmailConnector,
    calendar: GoogleCalendarConnector,
    crm: CrmConnector,
  ) {
    const list: [string, Connector][] = [
      [email.id, email],
      [calendar.id, calendar],
      [crm.id, crm],
    ];
    this.connectors = new Map<string, Connector>(list);
  }

  listConnectors() {
    return Array.from(this.connectors.values()).map((c) => ({ id: c.id, name: c.name }));
  }

  list(orgId: string) {
    return this.prisma.integration.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        provider: true,
        name: true,
        type: true,
        status: true,
        lastSyncAt: true,
        configuration: true,
        createdAt: true,
      },
    });
  }

  async get(orgId: string, id: string) {
    const it = await this.prisma.integration.findFirst({ where: { id, organizationId: orgId } });
    if (!it) throw new NotFoundException('Integration not found');
    return it;
  }

  async create(orgId: string, dto: CreateIntegrationDto) {
    if (!this.connectors.has(dto.provider)) {
      throw new BadRequestException(`Unknown provider: ${dto.provider}`);
    }
    if (!dto.credentials || Object.keys(dto.credentials).length === 0) {
      throw new BadRequestException('At least one credential is required');
    }

    const integration = await this.prisma.integration.create({
      data: {
        id: randomUUID(),
        organizationId: orgId,
        provider: dto.provider,
        name: dto.name,
        type: dto.type as any,
        configuration: (dto.configuration ?? {}) as any,
      },
    });

    // Encrypt & store each credential
    for (const [key, value] of Object.entries(dto.credentials)) {
      await this.prisma.integrationCredential.create({
        data: {
          id: randomUUID(),
          integrationId: integration.id,
          credentialType: key,
          encryptedValue: this.crypto.encrypt(value),
        },
      });
    }
    return this.get(orgId, integration.id);
  }

  async update(orgId: string, id: string, dto: { name?: string; configuration?: Record<string, unknown> }) {
    const it = await this.get(orgId, id);
    return this.prisma.integration.update({
      where: { id: it.id },
      data: {
        name: dto.name,
        configuration: (dto.configuration as any) ?? undefined,
      },
    });
  }

  async rotateCredential(orgId: string, id: string, key: string, value: string) {
    const it = await this.get(orgId, id);
    const existing = await this.prisma.integrationCredential.findFirst({
      where: { integrationId: it.id, credentialType: key },
    });
    if (existing) {
      await this.prisma.integrationCredential.update({
        where: { id: existing.id },
        data: { encryptedValue: this.crypto.encrypt(value) },
      });
    } else {
      await this.prisma.integrationCredential.create({
        data: {
          id: randomUUID(),
          integrationId: it.id,
          credentialType: key,
          encryptedValue: this.crypto.encrypt(value),
        },
      });
    }
    return { ok: true };
  }

  async archive(orgId: string, id: string) {
    const it = await this.get(orgId, id);
    await this.prisma.integration.update({
      where: { id: it.id },
      data: { status: 'INACTIVE' as any },
    });
    return { ok: true };
  }

  async test(orgId: string, id: string): Promise<ConnectorResult> {
    const it = await this.get(orgId, id);
    const connector = this.connectors.get(it.provider);
    if (!connector) return { ok: false, error: 'Connector not registered' };
    const ctx = await this.resolve(orgId, it.id);
    const result = await connector.ping(ctx);
    if (result.ok) {
      await this.prisma.integration.update({
        where: { id: it.id },
        data: { status: 'ACTIVE' as any, lastSyncAt: new Date() },
      });
    } else {
      await this.prisma.integration.update({
        where: { id: it.id },
        data: { status: 'ERROR' as any },
      });
    }
    return result;
  }

  /**
   * Resolve an integration into a fully-decrypted `ConnectorContext` ready to
   * be passed to a connector. Used by the tools layer when the agent invokes
   * an integration-backed tool.
   */
  async resolve(orgId: string, id: string): Promise<ConnectorContext> {
    const it = await this.get(orgId, id);
    const encrypted = await this.prisma.integrationCredential.findMany({
      where: { integrationId: it.id },
    });
    const credentials: Record<string, string> = {};
    for (const row of encrypted) {
      try {
        credentials[row.credentialType] = this.crypto.decrypt(row.encryptedValue);
      } catch (e: any) {
        this.logger.error(`Failed to decrypt ${row.credentialType} for ${it.id}: ${e?.message}`);
      }
    }
    return {
      organizationId: orgId,
      credentials,
      config: (it.configuration as any) ?? undefined,
      timeoutMs: 15_000,
    };
  }

  /** Used by the tools layer to find which integration (if any) powers a given tool. */
  findIntegrationForTool(orgId: string, toolSlug: string) {
    return this.prisma.tool.findFirst({
      where: { organizationId: orgId, slug: toolSlug, type: 'INTEGRATION' as any },
      include: { _count: { select: { agentTools: true } } } as any,
    });
  }
}
