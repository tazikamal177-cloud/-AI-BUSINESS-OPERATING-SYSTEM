/**
 * AIBOS — Database seed
 *
 * Goals:
 *   1. Insert 3 plans (Free / Starter / Pro) — Business & Enterprise are CSM-only.
 *   2. Insert the **global tool registry** (built-in tools). No organization_id.
 *   3. Create a demo organization with 1 Owner, 1 Manager, 1 Operator.
 *   4. Create 3 default agent templates (Sales, Support, Marketing) — global,
 *      isTemplate=true, organization_id=NULL.
 *   5. Create a free Subscription for the demo org.
 *
 * Idempotent: re-running upserts the same rows by stable keys (slug/email).
 */
import { PrismaClient, MemberRole, AgentStatus, SubscriptionStatus, ToolType, RiskLevel } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const PLANS = [
  {
    slug: 'free',
    name: 'Free',
    description: 'Pour découvrir AIBOS',
    priceMonthly: 0,
    priceYearly: 0,
    currency: 'EUR',
    features: [
      '1 agent',
      '10 000 tokens / mois',
      '1 base de connaissances',
      'Support communauté',
    ],
    limits: {
      agents: 1,
      monthlyTokens: 10000,
      knowledgeBases: 1,
      documentsPerKb: 10,
      storageMb: 100,
      members: 2,
    },
  },
  {
    slug: 'starter',
    name: 'Starter',
    description: 'Pour les petites entreprises',
    priceMonthly: 29,
    priceYearly: 290,
    currency: 'EUR',
    features: [
      '5 agents',
      '500 000 tokens / mois',
      '5 bases de connaissances',
      'Outils Email + Webhook + Calendar',
      'Support email',
    ],
    limits: {
      agents: 5,
      monthlyTokens: 500000,
      knowledgeBases: 5,
      documentsPerKb: 50,
      storageMb: 1024,
      members: 5,
    },
  },
  {
    slug: 'pro',
    name: 'Pro',
    description: 'Pour les PME en croissance',
    priceMonthly: 99,
    priceYearly: 990,
    currency: 'EUR',
    features: [
      '20 agents',
      '3 000 000 tokens / mois',
      'Knowledge bases illimitées',
      'Workflows avancés',
      'Multi-agent orchestration',
      'Analytics & ROI',
      'Support prioritaire',
    ],
    limits: {
      agents: 20,
      monthlyTokens: 3000000,
      knowledgeBases: 9999,
      documentsPerKb: 500,
      storageMb: 10240,
      members: 25,
    },
  },
];

const BUILTIN_TOOLS = [
  {
    slug: 'send_email',
    name: 'Send Email',
    description: 'Envoie un email transactionnel via le SMTP/SendGrid de l\'organisation.',
    type: ToolType.INTEGRATION,
    provider: 'email',
    inputSchema: {
      type: 'object',
      required: ['to', 'subject', 'body'],
      properties: {
        to: { type: 'string', format: 'email' },
        subject: { type: 'string' },
        body: { type: 'string' },
        from: { type: 'string' },
        cc: { type: 'array', items: { type: 'string' } },
      },
    },
    riskLevel: RiskLevel.MEDIUM,
  },
  {
    slug: 'http_webhook',
    name: 'HTTP Webhook',
    description: 'Envoie une requête HTTP (POST/GET/PUT) vers une URL externe.',
    type: ToolType.WEBHOOK,
    provider: 'webhook',
    inputSchema: {
      type: 'object',
      required: ['url', 'method'],
      properties: {
        url: { type: 'string', format: 'uri' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
        headers: { type: 'object' },
        body: {},
      },
    },
    riskLevel: RiskLevel.MEDIUM,
  },
  {
    slug: 'create_calendar_event',
    name: 'Create Calendar Event',
    description: 'Crée un événement dans Google Calendar de l\'organisation.',
    type: ToolType.INTEGRATION,
    provider: 'google_calendar',
    inputSchema: {
      type: 'object',
      required: ['summary', 'start', 'end'],
      properties: {
        summary: { type: 'string' },
        description: { type: 'string' },
        start: { type: 'string', format: 'date-time' },
        end: { type: 'string', format: 'date-time' },
        attendees: { type: 'array', items: { type: 'string', format: 'email' } },
        location: { type: 'string' },
      },
    },
    riskLevel: RiskLevel.MEDIUM,
  },
  {
    slug: 'search_web',
    name: 'Search Web',
    description: 'Effectue une recherche web (read-only) via un fournisseur configuré.',
    type: ToolType.BUILT_IN,
    provider: 'web_search',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: { query: { type: 'string' }, maxResults: { type: 'integer', default: 5 } },
    },
    riskLevel: RiskLevel.LOW,
  },
  {
    slug: 'create_task',
    name: 'Create Task',
    description: 'Crée une tâche interne dans l\'organisation (souvent utilisée pour HITL).',
    type: ToolType.BUILT_IN,
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        assignedTo: { type: 'string', format: 'uuid' },
        dueDate: { type: 'string', format: 'date-time' },
        priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
      },
    },
    riskLevel: RiskLevel.LOW,
  },
];

const TEMPLATES = [
  {
    slug: 'sales-agent',
    name: 'AI Sales Agent',
    description: 'Qualifie les leads, score leur potentiel et propose des rendez-vous.',
    role: 'Sales Development Representative',
    objective: 'Qualifier chaque prospect, identifier son besoin, son budget et sa timeline, puis soit booker un RDV soit le nurturer.',
    systemInstructions: `Tu es un AI Sales Agent B2B. Ton rôle : accueillir chaque prospect avec empathie, poser des questions de qualification (BANT : Budget, Authority, Need, Timeline), utiliser la knowledge base pour répondre aux objections sur le produit, et proposer un créneau de rendez-vous via l'outil calendar lorsque le prospect est qualifié.

Règles :
- Ne jamais inventer de prix ou de fonctionnalités.
- Toujours citer la source (knowledge base) si tu t'appuies dessus.
- Si l'action est risquée (envoyer un email hors-template, supprimer une donnée), demande confirmation.`,
    personality: 'Consultatif, professionnel, orienté valeur',
    tone: 'professional',
    templateCategory: 'sales',
    guardrails: {
      noHallucinatedPrices: true,
      requireCitation: true,
      maxEmailsPerConversation: 3,
    },
  },
  {
    slug: 'support-agent',
    name: 'AI Support Agent',
    description: 'Répond aux questions de support client en s\'appuyant sur la documentation.',
    role: 'Customer Support Specialist',
    objective: 'Résoudre les demandes de support de niveau 1 et 2 via la knowledge base, escalader si nécessaire.',
    systemInstructions: `Tu es un AI Support Agent. Accueille l'utilisateur, identifie son problème, consulte la knowledge base, propose une solution pas-à-pas. Si tu ne trouves pas la réponse ou si le client est en colère, ouvre un ticket via l'outil create_task.`,
    personality: 'Empathique, patient, technique',
    tone: 'friendly',
    templateCategory: 'support',
    guardrails: { noHallucinatedPrices: true, requireCitation: true },
  },
  {
    slug: 'marketing-agent',
    name: 'AI Marketing Agent',
    description: 'Génère des contenus marketing (emails, posts, scripts) alignés avec la marque.',
    role: 'Marketing Copywriter',
    objective: 'Produire des contenus cohérents avec la voix de la marque pour les canaux email, blog, social.',
    systemInstructions: `Tu es un AI Marketing Agent. Tu génères du contenu aligné avec la voix, le ton et la charte éditoriale stockés dans la knowledge base. Tu proposes 3 variantes par défaut.`,
    personality: 'Créatif, concis, orienté conversion',
    tone: 'engaging',
    templateCategory: 'marketing',
    guardrails: { maxWordsPerOutput: 500 },
  },
];

async function main() {
  console.log('🌱 Seeding AIBOS…');

  // 1. Plans
  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { slug: plan.slug },
      update: plan,
      create: plan,
    });
  }
  console.log(`  ✓ ${PLANS.length} plans`);

  // 2. Built-in tools (registry global — organization_id NULL)
  for (const tool of BUILTIN_TOOLS) {
    await prisma.tool.upsert({
      where: { organizationId_slug: { organizationId: null as any, slug: tool.slug } } as any,
      update: { ...tool, organizationId: null, isBuiltIn: true },
      create: { ...tool, organizationId: null, isBuiltIn: true } as any,
    });
  }
  console.log(`  ✓ ${BUILTIN_TOOLS.length} built-in tools`);

  // 3. Templates (global agents — organization_id NULL, isTemplate=true)
  for (const tpl of TEMPLATES) {
    await prisma.agent.upsert({
      where: { organizationId_slug: { organizationId: null as any, slug: tpl.slug } } as any,
      update: { ...tpl, organizationId: null, isTemplate: true, status: AgentStatus.ACTIVE } as any,
      create: { ...tpl, organizationId: null, isTemplate: true, status: AgentStatus.ACTIVE, createdBy: '00000000-0000-0000-0000-000000000000' } as any,
    });
  }
  console.log(`  ✓ ${TEMPLATES.length} agent templates`);

  // 4. Demo organization
  const passwordHash = await bcrypt.hash('Demo1234!', 12);
  const owner = await prisma.user.upsert({
    where: { email: '[email protected]' },
    update: {},
    create: {
      email: '[email protected]',
      passwordHash,
      firstName: 'Demo',
      lastName: 'Owner',
      isEmailVerified: true,
      emailVerifiedAt: new Date(),
    },
  });

  const org = await prisma.organization.upsert({
    where: { slug: 'demo-org' },
    update: {},
    create: {
      name: 'Demo Organization',
      slug: 'demo-org',
      industry: 'SaaS',
      country: 'FR',
      language: 'fr',
      timezone: 'Europe/Paris',
    },
  });

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: owner.id } },
    update: {},
    create: {
      organizationId: org.id,
      userId: owner.id,
      role: MemberRole.OWNER,
    },
  });

  // Free subscription
  const freePlan = await prisma.plan.findUnique({ where: { slug: 'free' } });
  if (freePlan) {
    const now = new Date();
    const end = new Date(now);
    end.setMonth(end.getMonth() + 1);
    await prisma.subscription.upsert({
      where: { organizationId: org.id },
      update: {},
      create: {
        organizationId: org.id,
        planId: freePlan.id,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: now,
        currentPeriodEnd: end,
      },
    });
  }
  console.log(`  ✓ Demo org "${org.slug}" + Owner ${owner.email} (password: Demo1234!)`);

  console.log('✅ Seed complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
