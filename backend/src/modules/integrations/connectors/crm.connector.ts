import { Injectable, Logger } from '@nestjs/common';
import { Connector, ConnectorContext, ConnectorResult } from './connector.types';

interface CrmCredentials {
  /** Provider-specific API key (HubSpot, Pipedrive, etc.). */
  apiKey: string;
  /**
   * Optional base URL — leave empty for HubSpot defaults. Useful for
   * self-hosted CRMs (EspoCRM, Bitrix24 on-prem).
   */
  baseUrl?: string;
}

interface CrmContact {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  company?: string;
  properties?: Record<string, unknown>;
}

/**
 * Generic CRM connector.
 * - Default base URL: HubSpot v3 (`https://api.hubapi.com`).
 * - For other CRMs (Pipedrive, EspoCRM, Bitrix24, Salesforce REST), set
 *   `baseUrl` to their REST endpoint and adjust path mapping.
 */
@Injectable()
export class CrmConnector implements Connector {
  readonly id = 'crm';
  readonly name = 'CRM (HubSpot-compatible)';
  private readonly logger = new Logger(CrmConnector.name);
  private readonly DEFAULT_BASE = 'https://api.hubapi.com';

  async ping(ctx: ConnectorContext): Promise<ConnectorResult> {
    const r = await this.request<{ results?: unknown[] }>(
      ctx,
      '/crm/v3/objects/contacts?limit=1',
    );
    return r.ok ? { ok: true } : r;
  }

  async createContact(
    args: { email: string; firstName?: string; lastName?: string; phone?: string; company?: string; properties?: Record<string, string> },
    ctx: ConnectorContext,
  ): Promise<ConnectorResult<CrmContact>> {
    const properties: Record<string, string> = {
      email: args.email,
      ...(args.firstName ? { firstname: args.firstName } : {}),
      ...(args.lastName ? { lastname: args.lastName } : {}),
      ...(args.phone ? { phone: args.phone } : {}),
      ...(args.company ? { company: args.company } : {}),
      ...(args.properties ?? {}),
    };
    return this.request<CrmContact>(ctx, '/crm/v3/objects/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties }),
    });
  }

  async searchContacts(
    args: { query: string; limit?: number },
    ctx: ConnectorContext,
  ): Promise<ConnectorResult<{ contacts: CrmContact[] }>> {
    const params = new URLSearchParams({
      q: args.query,
      limit: String(args.limit ?? 10),
    });
    const r = await this.request<{ results: CrmContact[] }>(
      ctx,
      `/crm/v3/objects/contacts/search?${params}`,
    );
    if (!r.ok) return { ok: false, error: r.error, code: r.code };
    return { ok: true, data: { contacts: r.data?.results ?? [] } };
  }

  // ─────────────── internals ───────────────

  private baseUrl(creds: CrmCredentials): string {
    return (creds.baseUrl ?? this.DEFAULT_BASE).replace(/\/$/, '');
  }

  private async request<T = unknown>(
    ctx: ConnectorContext,
    path: string,
    init: RequestInit = {},
  ): Promise<ConnectorResult<T>> {
    const creds = ctx.credentials as unknown as CrmCredentials;
    if (!creds.apiKey) {
      return { ok: false, error: 'Missing api_key', code: 'auth_missing' };
    }
    const url = `${this.baseUrl(creds)}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${creds.apiKey}`,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `CRM API ${res.status}: ${text.slice(0, 200)}`, code: `http_${res.status}` };
    }
    const data = (await res.json().catch(() => ({}))) as T;
    return { ok: true, data };
  }
}
