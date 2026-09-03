# Frontend — Phase 9

## Stack

- **Next.js 14** (App Router, RSC opt-in via `'use client'`)
- **React 18** + **TypeScript 5** (strict)
- **Tailwind CSS 3** (utilities-first, no shadcn CLI — primitives are
  hand-rolled in `src/components/ui/`)
- **TanStack Query 5** for server state, axios for HTTP
- **react-hook-form** + **zod** ready (form infra in `src/hooks/`)
- **lucide-react** icons, **recharts** (wired but unused in MVP), **date-fns** available via `lib/utils.ts`

## Project layout

```
src/
├── app/
│   ├── layout.tsx                  root <html> + Providers
│   ├── providers.tsx               QueryClient + auth listeners
│   ├── page.tsx                    landing (redirects to /dashboard if logged in)
│   ├── client-layout.tsx           gates mounted state → wraps in DashboardLayout
│   ├── dashboard-layout.tsx        sidebar + nav
│   ├── globals.css                 Tailwind base + design tokens
│   ├── login/                      sign-in form
│   ├── register/                   registration
│   ├── forgot-password/            reset request
│   ├── dashboard/                  overview
│   ├── agents/                     list + [agentId]/chat
│   ├── knowledge/                  KBs + documents + search debug
│   ├── workflows/                  list + run + log
│   ├── tasks/                      pending / approvals
│   ├── conversations/              chat playground (multi-agent)
│   └── integrations/               list providers + CRUD
├── components/
│   └── ui/                         Button, Card, Input, Select, Textarea, Label, Badge, EmptyState
├── hooks/
│   └── use-auth.ts                 useAuth(), useRequireAuth()
└── lib/
    ├── api.ts                      axios instance + refresh-token interceptor
    └── utils.ts                    cn, formatDate, formatRelative, formatCurrency, slugify
```

## Auth flow

- `localStorage` holds `accessToken`, `refreshToken`, `user`, `organization`.
- `src/lib/api.ts` adds the `Authorization` + `X-Organization-Id` headers
  on every request and transparently refreshes on 401.
- `src/hooks/use-auth.ts` exposes `useAuth()` for components and
  `useRequireAuth()` for pages that should redirect to `/login`.
- Mutations in TanStack Query automatically pick up new tokens because
  the axios instance persists them.

## UI primitives (`components/ui/`)

- `Button` — variants: `primary | secondary | outline | ghost | danger`,
  sizes: `sm | md | lg | icon`, with a built-in spinner.
- `Card` (+ `CardHeader`, `CardTitle`, `CardContent`, `CardFooter`).
- `Input`, `Textarea`, `Select`, `Label` — Tailwind-based, focus rings.
- `Badge` — with `statusToBadge()` mapper for workflow / run states.
- `EmptyState` — empty list placeholder with optional CTA.

## Pages

### `/dashboard`
- 4 stat cards (active agents, conversations, tasks, cost) + 4 quick
  actions + recent activity list.

### `/agents`
- List of agents with status badge, attached tools / KB counts.
- Click an agent to open its detail (`/agents/[agentId]/chat`).
- CTA "New agent" (placeholder — full builder is part of the agent
  detail page).

### `/agents/[agentId]/chat`
- Chat playground against the agent (uses `/agents/:id/test` non-streaming).

### `/knowledge`
- Master/detail layout.
- Master: list of KBs with document / chunk counts.
- Detail: documents list, file picker / URL ingestion, **debug search**
  form that shows the top-K chunks returned by `/search`.

### `/workflows`
- Master/detail layout.
- Master: list of workflows with version, run count, status.
- Detail: activate / pause / archive buttons + manual run form (raw JSON
  trigger payload) + recent runs list with cancel.

### `/tasks`
- Filterable list of tasks (PENDING / REQUIRES_APPROVAL / IN_PROGRESS /
  COMPLETED / FAILED).
- Inline actions: approve / reject / complete.

### `/conversations`
- Chat playground that lets you switch between active agents.
- Uses `/agents/:id/test` for now (Phase 10 = SSE streaming).

### `/integrations`
- Lists supported providers + per-org integrations + test button.

### `/login`, `/register`, `/forgot-password`
- Token-based forms, redirect to `/dashboard` on success.

## Build

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
npm run build      # production build (14 routes)
npx tsc --noEmit   # 0 errors
```

## Known limitations & next steps

- The `/agents/[agentId]` page only exposes the chat tab; the
  versionning, deploy, attach-tool and stats screens are wired in the
  backend but not yet in the UI (Phase 9.5).
- The webhooks editor for workflows is not exposed in the UI (the
  backend route accepts HMAC-signed requests directly).
- No mobile-optimised navigation drawer beyond what `dashboard-layout.tsx`
  already provides.
- The landing `/` page just redirects — a marketing page is out of scope.
- Audit log viewer is not exposed (it lives in `audit_logs` and is
  accessible via the `Analytics` future page).
