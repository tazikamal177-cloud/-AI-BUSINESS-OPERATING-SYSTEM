'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckSquare, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, statusToBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import ClientLayout from '../client-layout';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/utils';

interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  type: string;
  dueDate?: string;
  createdAt: string;
}

export default function TasksPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>('PENDING');

  const { data: tasks, isLoading } = useQuery<Task[]>({
    queryKey: ['tasks', filter],
    queryFn: async () => (await api.get(`/tasks?status=${filter}`)).data,
  });

  const approve = useMutation({
    mutationFn: (id: string) => api.post(`/tasks/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
  const reject = useMutation({
    mutationFn: (id: string) => api.post(`/tasks/${id}/reject`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
  const complete = useMutation({
    mutationFn: (id: string) => api.post(`/tasks/${id}/complete`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  return (
    <ClientLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tasks</h1>
          <p className="text-gray-600">Tasks created by your agents and humans. Approvals gate high-risk tool calls.</p>
        </div>

        <div className="flex gap-2">
          {['PENDING', 'REQUIRES_APPROVAL', 'IN_PROGRESS', 'COMPLETED', 'FAILED'].map((s) => (
            <Button
              key={s}
              size="sm"
              variant={filter === s ? 'primary' : 'outline'}
              onClick={() => setFilter(s)}
            >
              {s.replace('_', ' ')}
            </Button>
          ))}
        </div>

        {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
        {tasks?.length === 0 && (
          <EmptyState
            icon={<CheckSquare className="h-6 w-6" />}
            title="No tasks in this view"
            description="Try another filter, or wait for an agent to surface something."
          />
        )}

        <div className="space-y-2">
          {tasks?.map((t) => (
            <Card key={t.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-gray-900">{t.title}</p>
                      <Badge variant={statusToBadge(t.status)}>{t.status}</Badge>
                      <Badge variant="neutral">{t.priority}</Badge>
                    </div>
                    {t.description && (
                      <pre className="mt-2 max-w-2xl overflow-x-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
                        {t.description}
                      </pre>
                    )}
                    <p className="mt-2 text-xs text-gray-500">
                      Created {formatRelative(t.createdAt)}
                      {t.dueDate && ` · due ${formatRelative(t.dueDate)}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {t.status === 'REQUIRES_APPROVAL' && (
                      <>
                        <Button size="sm" onClick={() => approve.mutate(t.id)} loading={approve.isPending}>
                          <Check className="h-4 w-4" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => reject.mutate(t.id)}>
                          <X className="h-4 w-4" /> Reject
                        </Button>
                      </>
                    )}
                    {t.status === 'PENDING' && (
                      <Button size="sm" variant="outline" onClick={() => complete.mutate(t.id)}>
                        Complete
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </ClientLayout>
  );
}
