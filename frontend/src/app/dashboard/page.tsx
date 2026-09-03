'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Bot,
  MessageSquare,
  CheckSquare,
  Zap,
  TrendingUp,
  Clock,
} from 'lucide-react';
import { api } from '@/lib/api';
import ClientLayout from '../client-layout';

export default function DashboardPage() {
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

  const { data: overview, isLoading } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: async () => {
      const response = await api.get('/analytics/overview');
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
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600">Welcome back! Here&apos;s your AI business overview.</p>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<Bot className="h-5 w-5" />}
            label="Active Agents"
            value={overview?.activeAgents || 0}
            trend="+2 this week"
            color="blue"
          />
          <StatCard
            icon={<MessageSquare className="h-5 w-5" />}
            label="Conversations"
            value={overview?.totalConversations || 0}
            trend="+12% vs last month"
            color="green"
          />
          <StatCard
            icon={<CheckSquare className="h-5 w-5" />}
            label="Tasks Completed"
            value={overview?.completedTasks || 0}
            trend={`${overview?.totalTasks || 0} total`}
            color="purple"
          />
          <StatCard
            icon={<Zap className="h-5 w-5" />}
            label="AI Cost"
            value={`€${Number(overview?.totalCost || 0).toFixed(2)}`}
            trend="This month"
            color="orange"
          />
        </div>

        {/* Quick Actions */}
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Quick Actions</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <QuickAction
              icon={<Bot className="h-5 w-5" />}
              label="Create Agent"
              description="Build a new AI agent"
              onClick={() => router.push('/agents/create')}
            />
            <QuickAction
              icon={<MessageSquare className="h-5 w-5" />}
              label="Start Chat"
              description="Talk to an agent"
              onClick={() => router.push('/conversations')}
            />
            <QuickAction
              icon={<Zap className="h-5 w-5" />}
              label="New Workflow"
              description="Automate a process"
              onClick={() => router.push('/workflows/create')}
            />
            <QuickAction
              icon={<TrendingUp className="h-5 w-5" />}
              label="View Analytics"
              description="Check performance"
              onClick={() => router.push('/analytics')}
            />
          </div>
        </div>

        {/* Recent Activity */}
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Recent Activity</h2>
          <div className="space-y-3">
            <ActivityItem
              icon={<Bot className="h-4 w-4" />}
              title="Sales Agent deployed"
              time="2 hours ago"
            />
            <ActivityItem
              icon={<MessageSquare className="h-4 w-4" />}
              title="New conversation started"
              time="3 hours ago"
            />
            <ActivityItem
              icon={<CheckSquare className="h-4 w-4" />}
              title="Task completed: Lead qualification"
              time="5 hours ago"
            />
          </div>
        </div>
      </div>
    </ClientLayout>
  );
}

function StatCard({
  icon,
  label,
  value,
  trend,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  trend: string;
  color: 'blue' | 'green' | 'purple' | 'orange';
}) {
  const colors = {
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    purple: 'bg-purple-100 text-purple-600',
    orange: 'bg-orange-100 text-orange-600',
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="flex items-center gap-3">
        <div className={`rounded-lg p-2 ${colors[color]}`}>{icon}</div>
        <div>
          <p className="text-sm text-gray-600">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          <p className="text-xs text-gray-500">{trend}</p>
        </div>
      </div>
    </div>
  );
}

function QuickAction({
  icon,
  label,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg border border-gray-200 p-4 text-left transition-colors hover:bg-gray-50"
    >
      <div className="rounded-lg bg-primary-100 p-2 text-primary-600">{icon}</div>
      <div>
        <p className="font-medium text-gray-900">{label}</p>
        <p className="text-sm text-gray-500">{description}</p>
      </div>
    </button>
  );
}

function ActivityItem({
  icon,
  title,
  time,
}: {
  icon: React.ReactNode;
  title: string;
  time: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="rounded-full bg-gray-100 p-2 text-gray-600">{icon}</div>
      <div className="flex-1">
        <p className="text-sm font-medium text-gray-900">{title}</p>
        <p className="text-xs text-gray-500">{time}</p>
      </div>
    </div>
  );
}
