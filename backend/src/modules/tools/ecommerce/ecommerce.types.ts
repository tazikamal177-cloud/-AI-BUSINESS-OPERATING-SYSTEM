export type OrderStatus =
  | 'pending'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'on_hold'
  | 'refunded';

export interface OrderItem {
  id: string;
  title: string;
  quantity: number;
  price: string;
  sku?: string;
}

export interface Address {
  firstName?: string;
  lastName?: string;
  company?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  country?: string;
  zip?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerEmail: string;
  customerName?: string;
  status: OrderStatus;
  financialStatus?: string;
  fulfillmentStatus?: string;
  totalPrice: string;
  currency: string;
  createdAt: string;
  updatedAt?: string;
  items: OrderItem[];
  shippingAddress?: Address;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  carrier?: string | null;
  estimatedDelivery?: string | null;
}

export interface TrackingInfo {
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  estimatedDelivery: string | null;
  lastUpdate: string | null;
  status: string | null;
}

export interface EcommerceConnector {
  readonly provider: string;

  getOrderByNumber(orderNumber: string): Promise<Order | null>;

  getOrdersByCustomerEmail(email: string, limit?: number): Promise<Order[]>;

  getOrderStatus(orderId: string): Promise<OrderStatus>;

  getTrackingInfo(orderId: string): Promise<TrackingInfo | null>;
}
