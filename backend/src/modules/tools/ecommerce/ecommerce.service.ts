import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  EcommerceConnector,
  Order,
  OrderStatus,
  TrackingInfo,
} from './ecommerce.types';
import { ShopifyConnector, ShopifyConfig } from './shopify.connector';

type Provider = 'shopify' | 'woocommerce';

@Injectable()
export class EcommerceService {
  private readonly logger = new Logger(EcommerceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getConnector(organizationId: string): Promise<EcommerceConnector> {
    const integration = await this.prisma.integration.findUnique({
      where: {
        organizationId_provider: {
          organizationId,
          provider: 'ecommerce',
        },
      },
    });

    if (!integration || integration.status !== 'ACTIVE') {
      throw new NotFoundException(
        'Aucune intégration e-commerce active pour cette organisation. Connecte Shopify ou WooCommerce dans Settings → Integrations.',
      );
    }

    const config = (integration.configuration || {}) as {
      provider?: Provider;
    };

    const credentials = await this.prisma.integrationCredential.findMany({
      where: { integrationId: integration.id },
    });

    if (!config.provider) {
      throw new NotFoundException('Provider e-commerce non configuré.');
    }

    switch (config.provider) {
      case 'shopify':
        return this.buildShopifyConnector(credentials);
      case 'woocommerce':
        throw new NotFoundException(
          'Le connecteur WooCommerce sera ajouté en v2.',
        );
      default:
        throw new NotFoundException(
          `Provider e-commerce inconnu: ${config.provider}`,
        );
    }
  }

  async getOrderByNumber(
    organizationId: string,
    orderNumber: string,
  ): Promise<Order | null> {
    const connector = await this.getConnector(organizationId);
    return connector.getOrderByNumber(orderNumber);
  }

  async getOrdersByEmail(
    organizationId: string,
    email: string,
    limit = 5,
  ): Promise<Order[]> {
    const connector = await this.getConnector(organizationId);
    return connector.getOrdersByCustomerEmail(email, limit);
  }

  async getOrderStatus(
    organizationId: string,
    orderId: string,
  ): Promise<OrderStatus> {
    const connector = await this.getConnector(organizationId);
    return connector.getOrderStatus(orderId);
  }

  async getTracking(
    organizationId: string,
    orderId: string,
  ): Promise<TrackingInfo | null> {
    const connector = await this.getConnector(organizationId);
    return connector.getTrackingInfo(orderId);
  }

  private buildShopifyConnector(
    credentials: Array<{ credentialType: string; encryptedValue: string }>,
  ): ShopifyConnector {
    const map: Record<string, string> = {};
    for (const c of credentials) {
      map[c.credentialType] = c.encryptedValue;
    }

    const shopDomain = map.shop_domain;
    const accessToken = map.access_token;

    if (!shopDomain || !accessToken) {
      throw new NotFoundException(
        'Identifiants Shopify manquants (shop_domain ou access_token).',
      );
    }

    const config: ShopifyConfig = {
      shopDomain,
      accessToken,
    };

    return new ShopifyConnector(config);
  }
}
