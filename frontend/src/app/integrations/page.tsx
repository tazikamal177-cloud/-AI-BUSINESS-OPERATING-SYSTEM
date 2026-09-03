'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft, Store, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import ClientLayout from '@/app/client-layout';

export default function IntegrationsPage() {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) router.push('/login');
    else setIsAuthenticated(true);
  }, [router]);

  const { data: status, refetch } = useQuery({
    queryKey: ['ecommerce-status'],
    queryFn: async () => {
      const res = await api.get('/integrations/ecommerce');
      return res.data;
    },
    enabled: isAuthenticated,
  });

  if (!isAuthenticated) return null;

  return (
    <ClientLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-gray-400 hover:text-gray-600"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Intégrations</h1>
            <p className="text-gray-600">
              Connecte ta boutique e-commerce pour permettre à l&apos;agent SAV
              d&apos;accéder aux commandes.
            </p>
          </div>
        </div>

        <ShopifyIntegration status={status} onUpdate={refetch} />
      </div>
    </ClientLayout>
  );
}

function ShopifyIntegration({ status, onUpdate }: any) {
  const [form, setForm] = useState({ shopDomain: '', accessToken: '' });
  const [error, setError] = useState('');

  const connect = useMutation({
    mutationFn: async (data: typeof form) =>
      api.post('/integrations/ecommerce/shopify', data),
    onSuccess: () => {
      setError('');
      setForm({ shopDomain: '', accessToken: '' });
      onUpdate();
    },
    onError: (err: any) => {
      setError(err.response?.data?.error?.message || 'Erreur de connexion');
    },
  });

  const disconnect = useMutation({
    mutationFn: async () => api.delete('/integrations/ecommerce'),
    onSuccess: () => onUpdate(),
  });

  if (status?.connected) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-green-100">
            <Store className="h-6 w-6 text-green-600" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-gray-900">Shopify</h3>
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                Connecté
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              Boutique : <span className="font-mono">{status.shopDomain}</span>
            </p>
            <p className="mt-1 text-xs text-gray-500">
              L&apos;agent SAV peut maintenant interroger les commandes.
            </p>
          </div>
          <button
            onClick={() => {
              if (confirm('Déconnecter Shopify ?')) disconnect.mutate();
            }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Déconnecter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-100">
          <Store className="h-6 w-6 text-primary-600" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900">Connecter Shopify</h3>
          <p className="mt-1 text-sm text-gray-600">
            Crée une Custom App dans ton admin Shopify avec les scopes{' '}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
              read_orders
            </code>{' '}
            et{' '}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
              read_fulfillments
            </code>{' '}
            (principe du moindre privilège).
            <a
              href="https://help.shopify.com/en/manual/your-account/admin-access/custom-apps"
              target="_blank"
              rel="noreferrer"
              className="ml-1 inline-flex items-center gap-0.5 text-primary-600 hover:text-primary-700"
            >
              Comment faire ?
              <ExternalLink className="h-3 w-3" />
            </a>
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError('');
              connect.mutate(form);
            }}
            className="mt-4 space-y-3"
          >
            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Domaine de la boutique
              </label>
              <input
                type="text"
                value={form.shopDomain}
                onChange={(e) =>
                  setForm({ ...form, shopDomain: e.target.value })
                }
                placeholder="ma-boutique.myshopify.com"
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Admin API access token
              </label>
              <input
                type="password"
                value={form.accessToken}
                onChange={(e) =>
                  setForm({ ...form, accessToken: e.target.value })
                }
                placeholder="shpat_xxxxxxxxxxxxx"
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                required
              />
            </div>

            <button
              type="submit"
              disabled={connect.isPending}
              className="w-full rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {connect.isPending ? 'Connexion...' : 'Connecter Shopify'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
