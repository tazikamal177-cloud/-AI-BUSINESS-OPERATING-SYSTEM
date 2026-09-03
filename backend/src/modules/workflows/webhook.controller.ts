import { Controller, Post, Param, Headers, BadRequestException, Body, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { WorkflowsService } from './workflows.service';

/**
 * Public webhook endpoint — no JWT, no RLS binding. HMAC signature
 * verification is the only access control.
 *
 * The signature header is `X-AIBOS-Signature: sha256=<hex>` and the secret
 * is read from the workflow's `triggerConfig.secret` (per-workflow).
 *
 * Body is forwarded as the run's `triggerData` payload.
 */
@Controller('webhooks/workflows')
export class WebhookController {
  constructor(
    private readonly workflows: WorkflowsService,
    private readonly config: ConfigService,
  ) {}

  @Post(':workflowId')
  async handle(
    @Param('workflowId') workflowId: string,
    @Headers('x-aibos-signature') signature: string | undefined,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    if (!signature) throw new BadRequestException('Missing X-AIBOS-Signature');
    // We need the workflow's secret. The workflowId is in the URL, but the
    // org binding is implicit (look up by id, verify secret). For multi-tenant
    // safety we ALSO check that the secret is non-empty.
    const w = await this.workflows['prisma'].workflow.findFirst({ where: { id: workflowId, deletedAt: null } });
    if (!w) throw new BadRequestException('Unknown workflow');
    const secret = (w.triggerConfig as any)?.secret;
    if (!secret) throw new BadRequestException('Workflow has no webhook secret configured');

    const raw = (req as any).rawBody as Buffer | undefined;
    if (!raw) throw new BadRequestException('Raw body missing — webhook cannot be verified');
    const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
    const sigOk = signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!sigOk) throw new BadRequestException('Invalid signature');

    return this.workflows.runWorkflow(w.organizationId, undefined, workflowId, body as Record<string, unknown>);
  }
}
