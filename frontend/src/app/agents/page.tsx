'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Plus, Bot, MessageSquare, Wrench, BookOpen } from 'lucide-react';
import { api } from '@/lib/api';
import ClientLayout from '../client-layout';

export default function AgentsPage() {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      router.push('/login');
    } else {
      setIsAuthenticated(true);
    }
  }, [router]);

  const { data: agents, isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: async () => {
      const response = await api.get('/agents');
      return response.data;
    },
    enabled: isAuthenticated,
  });

  if (!isAuthenticated) {
    return null;
  }

  return (
    <ClientLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">AI Agents</h1>
            <p className="text-gray-600">Manage your AI agents and templates.</p>
          </div>
          <Link
            href="/agents/create"
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" />
            Create Agent
          </Link>
        </div>

        {/* Agents Grid */}
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-48 animate-pulse rounded-xl bg-gray-200" />
            ))}
          </div>
        ) : agents && agents.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent: any) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
            <Bot className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-4 text-lg font-medium text-gray-900">No agents yet</h3>
            <p className="mt-2 text-sm text-gray-500">
              Get started by creating your first AI agent.
            </p>
            <Link
              href="/agents/create"
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              <Plus className="h-4 w-4" />
              Create Agent
            </Link>
          </div>
        )}
      </div>
    </ClientLayout>
  );
}

function AgentCard({ agent }: { agent: any }) {
  const statusColors: Record<string, string> = {
    ACTIVE: 'bg-green-100 text-green-700',
    DRAFT: 'bg-gray-100 text-gray-700',
    PAUSED: 'bg-yellow-100 text-yellow-700',
    ARCHIVED: 'bg-red-100 text-red-700',
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100">
            <Bot className="h-5 w-5 text-primary-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{agent.name}</h3>
            <p className="text-sm text-gray-500">{agent.role}</p>
          </div>
        </div>
        <span
          className={`rounded-full px-2 py-1 text-xs font-medium ${
            statusColors[agent.status] || statusColors.DRAFT
          }`}
        >
          {agent.status}
        </span>
      </div>

      {agent.description && (
        <p className="mt-3 text-sm text-gray-600 line-clamp-2">{agent.description}</p>
      )}

      <div className="mt-4 flex items-center gap-4 text-sm text-gray-500">
        <div className="flex items-center gap-1">
          <MessageSquare className="h-4 w-4" />
          {agent._count?.conversations || 0}
        </div>
        <div className="flex items-center gap-1">
          <Wrench className="h-4 w-4" />
          {agent._count?.agentTools || 0}
        </div>
        <div className="flex items-center gap-1">
          <BookOpen className="h-4 w-4" />
          {agent._count?.agentKnowledge || 0}
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <Link
          href={`/agents/${agent.id}`}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-center text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          View
        </Link>
        <Link
          href={`/agents/${agent.id}/chat`}
          className="flex-1 rounded-lg bg-primary-600 px-3 py-2 text-center text-sm font-medium text-white hover:bg-primary-700"
        >
          Chat
        </Link>
      </div>
    </div>
  );
}
