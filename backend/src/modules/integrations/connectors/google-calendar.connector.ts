import { Injectable, Logger } from '@nestjs/common';
import { Connector, ConnectorContext, ConnectorResult } from './connector.types';

interface CalendarCredentials {
  /** OAuth2 access token (long-lived) for Google Calendar API. */
  accessToken: string;
  /** Optional refresh token; if present we'll attempt a refresh on 401. */
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
}

interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  htmlLink?: string;
  status?: string;
}

/**
 * Google Calendar connector (uses REST API; no SDK dep).
 * Auth: OAuth2 access token (passed per request via the integration's
 * encrypted credentials). If a refresh token + client credentials are
 * configured, expired access tokens are refreshed automatically.
 */
@Injectable()
export class GoogleCalendarConnector implements Connector {
  readonly id = 'google_calendar';
  readonly name = 'Google Calendar';
  private readonly logger = new Logger(GoogleCalendarConnector.name);
  private readonly API = 'https://www.googleapis.com/calendar/v3';

  async ping(ctx: ConnectorContext): Promise<ConnectorResult> {
    const r = await this.request<{ calendars?: unknown[] }>(
      ctx,
      '/users/me/calendarList?maxResults=1',
    );
    return r.ok ? { ok: true } : r;
  }

  async listEvents(
    args: {
      timeMin?: string;
      timeMax?: string;
      maxResults?: number;
      q?: string;
    },
    ctx: ConnectorContext,
  ): Promise<ConnectorResult<{ events: CalendarEvent[] }>> {
    const params = new URLSearchParams();
    params.set('singleEvents', 'true');
    params.set('orderBy', 'startTime');
    if (args.timeMin) params.set('timeMin', args.timeMin);
    if (args.timeMax) params.set('timeMax', args.timeMax);
    if (args.maxResults) params.set('maxResults', String(args.maxResults));
    if (args.q) params.set('q', args.q);
    const r = await this.request<{ items: CalendarEvent[] }>(ctx, `/calendars/primary/events?${params}`);
    if (!r.ok) return { ok: false, error: r.error, code: r.code };
    return { ok: true, data: { events: r.data?.items ?? [] } };
  }

  async createEvent(
    args: {
      summary: string;
      description?: string;
      start: string;
      end: string;
      timeZone?: string;
      attendees?: string[];
    },
    ctx: ConnectorContext,
  ): Promise<ConnectorResult<CalendarEvent>> {
    const body = {
      summary: args.summary,
      description: args.description,
      start: { dateTime: args.start, timeZone: args.timeZone ?? 'UTC' },
      end: { dateTime: args.end, timeZone: args.timeZone ?? 'UTC' },
      attendees: (args.attendees ?? []).map((email) => ({ email })),
    };
    return this.request<CalendarEvent>(ctx, '/calendars/primary/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  // ─────────────── internals ───────────────

  private async request<T = unknown>(
    ctx: ConnectorContext,
    path: string,
    init: RequestInit = {},
  ): Promise<ConnectorResult<T>> {
    const creds = ctx.credentials as unknown as CalendarCredentials;
    if (!creds.accessToken) {
      return { ok: false, error: 'Missing access_token', code: 'auth_missing' };
    }
    const url = `${this.API}${path}`;
    const doFetch = (token: string) =>
      fetch(url, {
        ...init,
        headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
      });

    let res = await doFetch(creds.accessToken);
    if (res.status === 401 && creds.refreshToken && creds.clientId && creds.clientSecret) {
      const refreshed = await this.refresh(creds);
      if (refreshed) {
        creds.accessToken = refreshed;
        res = await doFetch(refreshed);
      }
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `Calendar API ${res.status}: ${text.slice(0, 200)}`, code: `http_${res.status}` };
    }
    const data = (await res.json().catch(() => ({}))) as T;
    return { ok: true, data };
  }

  private async refresh(creds: CalendarCredentials): Promise<string | null> {
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: creds.clientId!,
          client_secret: creds.clientSecret!,
          refresh_token: creds.refreshToken!,
          grant_type: 'refresh_token',
        }).toString(),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { access_token?: string };
      return data.access_token ?? null;
    } catch (e: any) {
      this.logger.warn(`Token refresh failed: ${e?.message}`);
      return null;
    }
  }
}
