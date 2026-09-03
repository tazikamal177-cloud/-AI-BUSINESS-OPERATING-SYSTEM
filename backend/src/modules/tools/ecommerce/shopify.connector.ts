import {
  EcommerceConnector,
  Order,
  OrderItem,
  OrderStatus,
  TrackingInfo,
} from './ecommerce.types';

export interface ShopifyConfig {
  shopDomain: string;
  accessToken: string;
  apiVersion?: string;
}

interface ShopifyOrder {
  id: number;
  name: string;
  email: string;
  created_at: string;
  updated_at: string;
  cancelled_at?: string | null;
  financial_status: string;
  fulfillment_status: string | null;
  total_price: string;
  currency: string;
  line_items: Array<{
    id: number;
    title: string;
    quantity: number;
    price: string;
    sku: string;
  }>;
  shipping_address?: {
    first_name: string;
    last_name: string;
    company?: string;
    address1: string;
    address2?: string;
    city: string;
    province: string;
    country: string;
    zip: string;
  };
  fulfillments?: Array<{
    tracking_number: string | null;
    tracking_url: string | null;
    tracking_company: string | null;
    estimated_delivery_at?: string | null;
    updated_at: string;
    status: string;
  }>;
}

export class ShopifyConnector implements EcommerceConnector {
  readonly provider = 'shopify';

  constructor(private readonly config: ShopifyConfig) {}

  private get apiBase(): string {
    const version = this.config.apiVersion || '2024-10';
    return `https://${this.config.shopDomain}/admin/api/${version}`;
  }

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': this.config.accessToken,
    };
  }

  async getOrderByNumber(orderNumber: string): Promise<Order | null> {
    const cleanNumber = orderNumber.replace(/^#/, '').trim();
    const url = `${this.apiBase}/orders.json?name=${encodeURIComponent(cleanNumber)}&status=any`;

    const res = await fetch(url, { headers: this.headers });

    if (!res.ok) {
      throw new Error(`Shopify API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as { orders: ShopifyOrder[] };
    const order = data.orders?.[0];

    return order ? this.mapOrder(order) : null;
  }

  async getOrdersByCustomerEmail(
    email: string,
    limit = 5,
  ): Promise<Order[]> {
    const url = `${this.apiBase}/orders.json?email=${encodeURIComponent(email)}&status=any&limit=${limit}`;

    const res = await fetch(url, { headers: this.headers });

    if (!res.ok) {
      throw new Error(`Shopify API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as { orders: ShopifyOrder[] };

    return (data.orders || []).map((o) => this.mapOrder(o));
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    const res = await fetch(
      `${this.apiBase}/orders/${encodeURIComponent(orderId)}.json`,
      { headers: this.headers },
    );

    if (!res.ok) {
      throw new Error(`Shopify API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as { order: ShopifyOrder };
    return this.mapStatus(data.order);
  }

  async getTrackingInfo(orderId: string): Promise<TrackingInfo | null> {
    const res = await fetch(
      `${this.apiBase}/orders/${encodeURIComponent(orderId)}/fulfillments.json`,
      { headers: this.headers },
    );

    if (!res.ok) {
      throw new Error(`Shopify API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as { fulfillments: ShopifyOrder['fulfillments'] };
    const fulfillments = data.fulfillments || [];

    if (fulfillments.length === 0) {
      return null;
    }

    const latest = fulfillments[fulfillments.length - 1];

    return {
      carrier: latest.tracking_company || null,
      trackingNumber: latest.tracking_number || null,
      trackingUrl: latest.tracking_url || null,
      estimatedDelivery: latest.estimated_delivery_at || null,
      lastUpdate: latest.updated_at || null,
      status: latest.status || null,
    };
  }

  private mapOrder(order: ShopifyOrder): Order {
    const fulfillment = order.fulfillments?.[order.fulfillments.length - 1];
    const status = this.mapStatus(order);

    const items: OrderItem[] = (order.line_items || []).map((li) => ({
      id: String(li.id),
      title: li.title,
      quantity: li.quantity,
      price: li.price,
      sku: li.sku || undefined,
    }));

    return {
      id: String(order.id),
      orderNumber: order.name,
      customerEmail: order.email,
      customerName: order.shipping_address
        ? `${order.shipping_address.first_name} ${order.shipping_address.last_name}`.trim()
        : undefined,
      status,
      financialStatus: order.financial_status,
      fulfillmentStatus: order.fulfillment_status || undefined,
      totalPrice: order.total_price,
      currency: order.currency,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      items,
      shippingAddress: order.shipping_address
        ? {
            firstName: order.shipping_address.first_name,
            lastName: order.shipping_address.last_name,
            company: order.shipping_address.company,
            address1: order.shipping_address.address1,
            address2: order.shipping_address.address2,
            city: order.shipping_address.city,
            province: order.shipping_address.province,
            country: order.shipping_address.country,
            zip: order.shipping_address.zip,
          }
        : undefined,
      trackingNumber: fulfillment?.tracking_number || null,
      trackingUrl: fulfillment?.tracking_url || null,
      carrier: fulfillment?.tracking_company || null,
      estimatedDelivery: fulfillment?.estimated_delivery_at || null,
    };
  }

  private mapStatus(order: ShopifyOrder): OrderStatus {
    if (order.cancelled_at) return 'cancelled';

    const fulfillment = order.fulfillments?.length
      ? order.fulfillments[order.fulfillments.length - 1].status
      : null;

    if (fulfillment === 'success') return 'delivered';
    if (fulfillment === 'partial') return 'shipped';
    if (order.fulfillments && order.fulfillments.length > 0) return 'shipped';

    switch (order.financial_status) {
      case 'refunded':
        return 'refunded';
      case 'voided':
        return 'cancelled';
    }

    if (order.fulfillment_status === 'fulfilled') return 'delivered';

    return 'processing';
  }
}
