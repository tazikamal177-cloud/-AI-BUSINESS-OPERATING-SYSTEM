'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Workflow, Plus, Play, Pause, Trash2, AlertCircle, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Badge, statusToBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import ClientLayout from '../client-layout';
import { api } from '@/lib/api';
import { formatRelative, cn } from '@/lib/utils';

interface WorkflowItem {
  id: string;
  name: string;
  description?: string;
  trigger: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
  version: number;
  createdAt: string;
  _count?: { nodes: number; runs: number };
}

interface WorkflowRun {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export default function WorkflowsPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [triggerData, setTriggerData] = useState('{\n  "email": "[email protected]"\n}');

  const { data: workflows, isLoading } = useQuery<WorkflowItem[]>({
    queryKey: ['workflows'],
    queryFn: async () => (await api.get('/workflows')).data,
  });

  const { data: runs } = useQuery<WorkflowRun[]>({
    queryKey: ['workflow-runs', selectedId],
    queryFn: async () => (await api.get(`/workflows/${selectedId}/runs`)).data,
    enabled: !!selectedId,
  });

  const create = useMutation({
    mutationFn: (data: any) => api.post('/workflows', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] });
      setShowCreate(false);
    },
  });

  const activate = useMutation({
    mutationFn: (id: string) => api.post(`/workflows/${id}/activate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows'] }),
  });
  const pause = useMutation({
    mutationFn: (id: string) => api.post(`/workflows/${id}/pause`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows'] }),
  });
  const archive = useMutation({
    mutationFn: (id: string) => api.delete(`/workflows/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows'] }),
  });
  const runNow = useMutation({
    mutationFn: ({ id, trigger }: { id: string; trigger: any }) =>
      api.post(`/workflows/${id}/run`, { trigger }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflow-runs', selectedId] }),
  });
  const cancelRun = useMutation({
    mutationFn: (runId: string) => api.post(`/workflows/${selectedId}/runs/${runId}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflow-runs', selectedId] }),
  });

  const selected = workflows?.find((w) => w.id === selectedId);

  return (
    <ClientLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Workflows</h1>
            <p className="text-gray-600">Chain agents, tools, conditions and delays into automated processes.</p>
          </div>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> New workflow
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-2">
            {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
            {workflows?.length === 0 && (
              <EmptyState
                icon={<Workflow className="h-6 w-6" />}
                title="No workflows yet"
                description="Build one to automate a multi-step process."
                action={<Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> Create</Button>}
              />
            )}
            {workflows?.map((w) => (
              <Card
                key={w.id}
                className={cn('cursor-pointer transition-colors hover:border-primary-300', selectedId === w.id && 'border-primary-500 ring-2 ring-primary-100')}
                onClick={() => setSelectedId(w.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{w.name}</p>
                      <p className="text-xs text-gray-500">
                        {w.trigger} · v{w.version} · {w._count?.runs ?? 0} runs
                      </p>
                    </div>
                    <Badge variant={statusToBadge(w.status)}>{w.status}</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="lg:col-span-2">
            {selected ? (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>{selected.name}</CardTitle>
                    {selected.description && <p className="mt-1 text-sm text-gray-600">{selected.description}</p>}
                  </div>
                  <div className="flex gap-2">
                    {selected.status !== 'ACTIVE' && (
                      <Button size="sm" onClick={() => activate.mutate(selected.id)}>
                        <Play className="h-4 w-4" /> Activate
                      </Button>
                    )}
                    {selected.status === 'ACTIVE' && (
                      <Button size="sm" variant="outline" onClick={() => pause.mutate(selected.id)}>
                        <Pause className="h-4 w-4" /> Pause
                      </Button>
                    )}
                    <Button size="sm" variant="danger" onClick={() => archive.mutate(selected.id)}>
                      <Trash2 className="h-4 w-4" /> Archive
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {selected.status === 'ACTIVE' && (
                    <div className="space-y-2 rounded-lg border border-gray-200 p-3">
                      <p className="text-sm font-medium text-gray-700">Manual run</p>
                      <Textarea
                        rows={5}
                        value={triggerData}
                        onChange={(e) => setTriggerData(e.target.value)}
                        className="font-mono text-xs"
                      />
                      <Button
                        size="sm"
                        onClick={() => {
                          try {
                            const trigger = JSON.parse(triggerData);
                            runNow.mutate({ id: selected.id, trigger });
                          } catch {
                            alert('Invalid JSON');
                          }
                        }}
                        loading={runNow.isPending}
                      >
                        <Play className="h-4 w-4" /> Run now
                      </Button>
                    </div>
                  )}

                  <div>
                    <p className="mb-2 text-sm font-medium text-gray-700">Recent runs</p>
                    {runs?.length === 0 && (
                      <p className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-sm text-gray-500">
                        No runs yet.
                      </p>
                    )}
                    <div className="divide-y divide-gray-100">
                      {runs?.map((r) => (
                        <div key={r.id} className="flex items-center justify-between py-3">
                          <div className="flex items-center gap-2">
                            <RunStatusIcon status={r.status} />
                            <div>
                              <p className="text-sm font-mono text-gray-700">{r.id.slice(0, 8)}</p>
                              <p className="text-xs text-gray-500">
                                Started {formatRelative(r.startedAt)}
                                {r.completedAt && ` · finished ${formatRelative(r.completedAt)}`}
                              </p>
                              {r.error && <p className="text-xs text-red-600">{r.error}</p>}
                            </div>
                          </div>
                          {(r.status === 'PENDING' || r.status === 'RUNNING') && (
                            <Button size="sm" variant="outline" onClick={() => cancelRun.mutate(r.id)}>
                              Cancel
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <EmptyState
                icon={<Workflow className="h-6 w-6" />}
                title="Select a workflow"
                description="Pick one on the left to see runs and trigger a manual execution."
              />
            )}
          </div>
        </div>
      </div>

      {showCreate && <CreateDialog onClose={() => setShowCreate(false)} onSubmit={(d: any) => create.mutate(d)} loading={create.isPending} />}
    </ClientLayout>
  );
}

function RunStatusIcon({ status }: { status: string }) {
  if (status === 'COMPLETED') return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (status === 'FAILED') return <XCircle className="h-4 w-4 text-red-600" />;
  if (status === 'CANCELLED') return <XCircle className="h-4 w-4 text-gray-400" />;
  return <Loader2 className="h-4 w-4 animate-spin text-blue-600" />;
}

function CreateDialog({ onClose, onSubmit, loading }: any) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [trigger, setTrigger] = useState('MANUAL');
  const secret = crypto.randomUUID();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>New workflow</CardTitle>
          <p className="mt-1 text-xs text-gray-500">
            Creates a starter workflow (TRIGGER → END). You can edit the graph from the detail page.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lead qualification" />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <Label>Trigger</Label>
            <Select value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              <option value="MANUAL">Manual</option>
              <option value="WEBHOOK">Webhook</option>
              <option value="SCHEDULE">Schedule</option>
              <option value="NEW_LEAD">New lead</option>
              <option value="NEW_EMAIL">New email</option>
              <option value="FORM_SUBMISSION">Form submission</option>
            </Select>
          </div>
        </CardContent>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() =>
              onSubmit({
                name,
                description,
                trigger,
                triggerConfig: trigger === 'WEBHOOK' ? { secret } : {},
                definition: {
                  nodes: [
                    { id: 't', type: 'TRIGGER', name: 'Trigger' },
                    { id: 'e', type: 'END', name: 'End' },
                  ],
                  edges: [{ id: 'e1', sourceNodeId: 't', targetNodeId: 'e' }],
                },
              })
            }
            loading={loading}
            disabled={!name.trim()}
          >
            Create
          </Button>
        </div>
      </Card>
    </div>
  );
}
