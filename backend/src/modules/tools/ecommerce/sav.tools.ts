import { Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EcommerceService } from './ecommerce.service';
import { SavToolContext } from './sav-context';

const logger = new Logger('SavTools');

export interface SavToolDefinition {
  name: string;
  description: string;
  inputSchema: any;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  handler: (args: any, ctx: SavToolContext) => Promise<any>;
}

function compact<T extends Record<string, any>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined && v !== '') out[k as keyof T] = v;
  }
  return out;
}

export function buildSavTools(
  prisma: PrismaService,
  ecommerce: EcommerceService,
): SavToolDefinition[] {
  return [
    {
      name: 'getOrderByNumber',
      description:
        "Récupère une commande par son numéro (ex: #1001 ou 1001). À utiliser quand le client donne un numéro de commande. Retourne null si introuvable.",
      riskLevel: 'LOW',
      inputSchema: {
        type: 'object',
        properties: {
          orderNumber: {
            type: 'string',
            description: 'Numéro de commande, avec ou sans le #',
          },
        },
        required: ['orderNumber'],
      },
      handler: async (args, ctx) => {
        const order = await ecommerce.getOrderByNumber(
          ctx.organizationId,
          args.orderNumber,
        );

        if (!order) {
          return {
            found: false,
            message: 'Aucune commande trouvée avec ce numéro.',
          };
        }

        return { found: true, order: compact(order) };
      },
    },

    {
      name: 'getOrdersByCustomerEmail',
      description:
        "Récupère les dernières commandes d'un client à partir de son email. À utiliser en premier quand le client n'a pas de numéro de commande.",
      riskLevel: 'LOW',
      inputSchema: {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            description: 'Email du client',
          },
          limit: {
            type: 'number',
            description: 'Nombre max de commandes (défaut 5)',
          },
        },
        required: ['email'],
      },
      handler: async (args, ctx) => {
        const orders = await ecommerce.getOrdersByEmail(
          ctx.organizationId,
          args.email,
          args.limit || 5,
        );

        return {
          count: orders.length,
          orders: orders.map((o) => compact(o)),
        };
      },
    },

    {
      name: 'getOrderStatus',
      description:
        "Récupère uniquement le statut actuel d'une commande (pending, processing, shipped, delivered, cancelled, refunded). Utilise l'ID de commande interne (champ `id` retourné par getOrderByNumber).",
      riskLevel: 'LOW',
      inputSchema: {
        type: 'object',
        properties: {
          orderId: {
            type: 'string',
            description: 'ID interne de la commande',
          },
        },
        required: ['orderId'],
      },
      handler: async (args, ctx) => {
        const status = await ecommerce.getOrderStatus(
          ctx.organizationId,
          args.orderId,
        );
        return { orderId: args.orderId, status };
      },
    },

    {
      name: 'getTrackingInfo',
      description:
        "Récupère les informations de suivi/livraison d'une commande : transporteur, numéro de tracking, URL de suivi, date estimée de livraison. Retourne null si la commande n'a pas encore été expédiée.",
      riskLevel: 'LOW',
      inputSchema: {
        type: 'object',
        properties: {
          orderId: {
            type: 'string',
            description: 'ID interne de la commande',
          },
        },
        required: ['orderId'],
      },
      handler: async (args, ctx) => {
        const tracking = await ecommerce.getTracking(
          ctx.organizationId,
          args.orderId,
        );

        if (!tracking) {
          return {
            shipped: false,
            message:
              "Cette commande n'a pas encore été expédiée — aucun tracking disponible.",
          };
        }

        return { shipped: true, tracking: compact(tracking) };
      },
    },

    {
      name: 'escalateToHuman',
      description:
        "Transfère la conversation à un agent humain. À utiliser OBLIGATOIREMENT si : la commande est introuvable après vérification, le client exprime une frustration forte, demande un remboursement/modification/annulation, ou sa question sort du suivi de commande. Ne jamais tenter de résoudre ces cas soi-même.",
      riskLevel: 'LOW',
      inputSchema: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description:
              'Raison courte du transfert (ex: "client demande remboursement", "commande introuvable", "frustration client")',
          },
        },
        required: ['reason'],
      },
      handler: async (args, ctx) => {
        logger.log(
          `Escalation requested for conversation ${ctx.conversationId}: ${args.reason}`,
        );

        await prisma.conversation.update({
          where: { id: ctx.conversationId },
          data: {
            status: 'ACTIVE',
            metadata: {
              needsHumanReview: true,
              escalationReason: args.reason,
              escalatedAt: new Date().toISOString(),
            },
          },
        });

        return {
          escalated: true,
          reason: args.reason,
          message:
            "La conversation a été marquée pour transfert à un agent humain. Informe le client qu'un conseiller va le reprendre.",
        };
      },
    },
  ];
}
