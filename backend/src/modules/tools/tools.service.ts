import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateToolDto } from './dto/create-tool.dto';
import { EcommerceService } from './ecommerce/ecommerce.service';
import { buildSavTools, SavToolDefinition } from './ecommerce/sav.tools';
import { IntegrationsService } from '../integrations/integrations.service';
import { EmailConnector } from '../integrations/connectors/email.connector';
import { GoogleCalendarConnector } from '../integrations/connectors/google-calendar.connector';
import { CrmConnector } from '../integrations/connectors/crm.connector';
import { assertSafeUrl, safeFetch } from '../../common/security/ssrf';

type ToolHandler = (args: any, ctx: any) => Promise<any>;

interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: any;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  isBuiltIn: boolean;
  source: 'BUILT_IN' | 'SAV_ECOMMERCE' | 'CUSTOM';
  handler: ToolHandler;
}

@Injectable()
export class ToolsService {
  private readonly logger = new Logger(ToolsService.name);
  private registry: Map<string, RegisteredTool> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ecommerce: EcommerceService,
    private readonly integrations: IntegrationsService,
    private readonly email: EmailConnector,
    private readonly calendar: GoogleCalendarConnector,
    private readonly crm: CrmConnector,
  ) {
    this.registerBuiltInTools();
    this.registerSavTools();
    this.registerIntegrationTools();
  }

  async findAll(orgId: string) {
    return this.prisma.tool.findMany({
      where: {
        OR: [{ organizationId: orgId }, { isBuiltIn: true }],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(orgId: string, toolId: string) {
    const tool = await this.prisma.tool.findFirst({
      where: {
        id: toolId,
        OR: [{ organizationId: orgId }, { isBuiltIn: true }],
      },
    });

    if (!tool) {
      throw new NotFoundException('Tool not found');
    }

    return tool;
  }

  async create(orgId: string, dto: CreateToolDto) {
    const slug = dto.slug ?? (dto.name || 'custom-tool').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return this.prisma.tool.create({
      data: {
        id: uuidv4(),
        organizationId: orgId,
        slug,
        name: dto.name,
        description: dto.description,
        type: 'CUSTOM',
        inputSchema: dto.inputSchema,
        outputSchema: dto.outputSchema,
        configuration: dto.configuration,
        permissions: dto.permissions,
        riskLevel: (dto.riskLevel || 'LOW') as any,
      },
    });
  }

  async getToolsForAgent(agentId: string, orgId: string) {
    const agentTools = await this.prisma.agentTool.findMany({
      where: { agentId },
      include: { tool: true },
    });

    const schemas: any[] = [];

    for (const at of agentTools) {
      const registered = this.registry.get(at.tool.name);
      if (registered) {
        schemas.push({
          type: 'function',
          function: {
            name: registered.name,
            description: registered.description,
            parameters: registered.inputSchema,
          },
        });
      } else if (at.tool.inputSchema) {
        schemas.push({
          type: 'function',
          function: {
            name: at.tool.name,
            description: at.tool.description,
            parameters: at.tool.inputSchema,
          },
        });
      }
    }

    return schemas;
  }

  async executeTool(
    toolName: string,
    args: any,
    context: any,
  ): Promise<any> {
    const registered = this.registry.get(toolName);

    if (registered) {
      return registered.handler(args || {}, context);
    }

    const tool = await this.prisma.tool.findFirst({
      where: {
        name: toolName,
        OR: [
          { organizationId: context.organizationId },
          { isBuiltIn: true },
        ],
      },
    });

    if (!tool) {
      throw new NotFoundException(`Tool "${toolName}" not found`);
    }

    if (tool.type === 'WEBHOOK') {
      return this.executeWebhookTool(tool, args);
    }

    if (tool.type === 'CUSTOM') {
      return this.executeCustomTool(tool, args, context);
    }

    throw new Error(`Unknown tool type: ${tool.type}`);
  }

  listRegisteredToolNames(): string[] {
    return Array.from(this.registry.keys());
  }

  /**
   * Lookup a registered tool by name. Returns the full registered record
   * (used by ToolExecutor to validate and execute built-in / SAV tools that
   * don't have a row in the `tools` table).
   */
  getRegistered(name: string) {
    return this.registry.get(name);
  }

  private register(tool: RegisteredTool) {
    this.registry.set(tool.name, tool);
  }

  private registerBuiltInTools() {
    this.register({
      name: 'create_task',
      description: 'Create a new task',
      isBuiltIn: true,
      source: 'BUILT_IN',
      riskLevel: 'LOW',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
          dueDate: { type: 'string', format: 'date-time' },
        },
        required: ['title'],
      },
      handler: async (args, ctx) => {
        const task = await this.prisma.task.create({
          data: {
            id: uuidv4(),
            organizationId: ctx.organizationId,
            agentId: ctx.agentId,
            title: args.title,
            description: args.description,
            priority: args.priority || 'MEDIUM',
            dueDate: args.dueDate ? new Date(args.dueDate) : null,
            source: 'agent',
            sourceId: ctx.conversationId,
          },
        });
        return { task, message: 'Task created successfully' };
      },
    });

    this.register({
      name: 'http_request',
      description: 'Make an HTTP request to an external API (allowlisted hosts only).',
      isBuiltIn: true,
      source: 'BUILT_IN',
      riskLevel: 'MEDIUM',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL. Host must be allowlisted.' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
          headers: { type: 'object' },
          body: { type: 'object' },
        },
        required: ['url'],
      },
      handler: async (args) => {
        const check = assertSafeUrl(args.url);
        if (!check.ok) return { ok: false, error: check.reason, code: 'SSRF_BLOCKED' };
        // safeFetch re-validates every redirect target against the same
        // allowlist / private-IP rules. A 302 to 169.254.169.254 is
        // rejected without opening a connection.
        const result = await safeFetch(args.url, {
          method: (args.method as any) || 'GET',
          headers: { 'Content-Type': 'application/json', ...(args.headers || {}) },
          body: args.body ? JSON.stringify(args.body) : undefined,
        });
        return {
          ok: result.ok,
          status: result.status,
          data: result.data,
          redirects: result.hops,
          ...(result.code ? { error: result.error, code: result.code } : {}),
        };
      },
    });

    this.register({
      name: 'get_current_datetime',
      description: 'Get the current date and time',
      isBuiltIn: true,
      source: 'BUILT_IN',
      riskLevel: 'LOW',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => ({
        datetime: new Date().toISOString(),
        date: new Date().toISOString().split('T')[0],
      }),
    });
  }

  private registerSavTools() {
    const savTools = buildSavTools(this.prisma, this.ecommerce);
    for (const t of savTools) {
      this.register({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        riskLevel: t.riskLevel,
        isBuiltIn: false,
        source: 'SAV_ECOMMERCE',
        handler: t.handler,
      });
    }
  }

  private registerIntegrationTools() {
    // send_email — powered by the org's "email" integration (SMTP)
    this.register({
      name: 'send_email',
      description: 'Send an email via the organization\'s SMTP integration.',
      isBuiltIn: true,
      source: 'BUILT_IN',
      riskLevel: 'MEDIUM',
      inputSchema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string' },
          body: { type: 'string', description: 'Plain text body' },
          html: { type: 'string', description: 'Optional HTML body' },
          cc: { type: 'string' },
          bcc: { type: 'string' },
        },
        required: ['to', 'subject', 'body'],
      },
      handler: async (args, ctx) => {
        const intg = await this.findFirstIntegration(ctx.organizationId, 'email');
        if (!intg) throw new Error('No "email" integration configured for this organization');
        const connectorCtx = await this.integrations.resolve(ctx.organizationId, intg.id);
        return this.email.send(args, connectorCtx);
      },
    });

    // create_calendar_event
    this.register({
      name: 'create_calendar_event',
      description: 'Create a new event in the organization\'s primary Google Calendar.',
      isBuiltIn: true,
      source: 'BUILT_IN',
      riskLevel: 'MEDIUM',
      inputSchema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          description: { type: 'string' },
          start: { type: 'string', description: 'ISO 8601 datetime' },
          end: { type: 'string', description: 'ISO 8601 datetime' },
          timeZone: { type: 'string', description: 'IANA TZ, e.g. Europe/Paris' },
          attendees: { type: 'array', items: { type: 'string' } },
        },
        required: ['summary', 'start', 'end'],
      },
      handler: async (args, ctx) => {
        const intg = await this.findFirstIntegration(ctx.organizationId, 'google_calendar');
        if (!intg) throw new Error('No "google_calendar" integration configured for this organization');
        const connectorCtx = await this.integrations.resolve(ctx.organizationId, intg.id);
        return this.calendar.createEvent(args, connectorCtx);
      },
    });

    // list_calendar_events
    this.register({
      name: 'list_calendar_events',
      description: 'List upcoming events in the organization\'s primary Google Calendar.',
      isBuiltIn: true,
      source: 'BUILT_IN',
      riskLevel: 'LOW',
      inputSchema: {
        type: 'object',
        properties: {
          timeMin: { type: 'string', description: 'ISO 8601, e.g. 2026-09-03T00:00:00Z' },
          timeMax: { type: 'string' },
          maxResults: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
          q: { type: 'string', description: 'Free-text search' },
        },
      },
      handler: async (args, ctx) => {
        const intg = await this.findFirstIntegration(ctx.organizationId, 'google_calendar');
        if (!intg) throw new Error('No "google_calendar" integration configured for this organization');
        const connectorCtx = await this.integrations.resolve(ctx.organizationId, intg.id);
        return this.calendar.listEvents(args, connectorCtx);
      },
    });

    // create_crm_contact
    this.register({
      name: 'create_crm_contact',
      description: 'Create a contact in the organization\'s CRM (HubSpot-compatible).',
      isBuiltIn: true,
      source: 'BUILT_IN',
      riskLevel: 'MEDIUM',
      inputSchema: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          phone: { type: 'string' },
          company: { type: 'string' },
          properties: { type: 'object', additionalProperties: { type: 'string' } },
        },
        required: ['email'],
      },
      handler: async (args, ctx) => {
        const intg = await this.findFirstIntegration(ctx.organizationId, 'crm');
        if (!intg) throw new Error('No "crm" integration configured for this organization');
        const connectorCtx = await this.integrations.resolve(ctx.organizationId, intg.id);
        return this.crm.createContact(args, connectorCtx);
      },
    });

    // search_crm_contacts
    this.register({
      name: 'search_crm_contacts',
      description: 'Search contacts in the organization\'s CRM by free-text query.',
      isBuiltIn: true,
      source: 'BUILT_IN',
      riskLevel: 'LOW',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        },
        required: ['query'],
      },
      handler: async (args, ctx) => {
        const intg = await this.findFirstIntegration(ctx.organizationId, 'crm');
        if (!intg) throw new Error('No "crm" integration configured for this organization');
        const connectorCtx = await this.integrations.resolve(ctx.organizationId, intg.id);
        return this.crm.searchContacts(args, connectorCtx);
      },
    });
  }

  private async findFirstIntegration(orgId: string, provider: string) {
    return this.prisma.integration.findFirst({
      where: { organizationId: orgId, provider, status: 'ACTIVE' as any },
    });
  }

  private async executeWebhookTool(tool: any, args: any) {
    const config = tool.configuration as any;
    const url = config?.url;
    if (!url) throw new Error('Webhook URL not configured');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });

    return { status: response.status, data: await response.json().catch(() => null) };
  }

  private async executeCustomTool(tool: any, args: any, context: any) {
    const config = tool.configuration as any;
    if (config?.endpoint) {
      const response = await fetch(config.endpoint, {
        method: config.method || 'POST',
        headers: { 'Content-Type': 'application/json', ...config.headers },
        body: JSON.stringify({ args, context }),
      });
      return await response.json().catch(() => ({}));
    }
    return { message: 'Tool executed', args };
  }
}
