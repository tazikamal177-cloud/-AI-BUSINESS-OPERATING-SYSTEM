'use client';

import { useEffect, useState } from 'react';
import DashboardLayout from './dashboard-layout';

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return <DashboardLayout>{children}</DashboardLayout>;
}
