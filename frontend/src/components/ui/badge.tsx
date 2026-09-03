import * as React from 'react';
import { cn } from '@/lib/utils';

type Variant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const styles: Record<Variant, string> = {
  default: 'bg-gray-100 text-gray-700',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-yellow-100 text-yellow-700',
  danger: 'bg-red-100 text-red-700',
  info: 'bg-blue-100 text-blue-700',
  neutral: 'bg-gray-100 text-gray-600',
};

export function Badge({
  variant = 'default',
  className,
  children,
  ...props
}: { variant?: Variant; children: React.ReactNode } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', styles[variant], className)}
      {...props}
    >
      {children}
    </span>
  );
}

export function statusToBadge(status: string): Variant {
  switch (status?.toUpperCase()) {
    case 'ACTIVE':
    case 'COMPLETED':
    case 'SUCCESS':
    case 'OK':
      return 'success';
    case 'DRAFT':
    case 'PENDING':
    case 'RUNNING':
      return 'info';
    case 'PAUSED':
    case 'ARCHIVED':
      return 'neutral';
    case 'FAILED':
    case 'ERROR':
    case 'CANCELLED':
      return 'danger';
    case 'REQUIRES_APPROVAL':
      return 'warning';
    default:
      return 'default';
  }
}
