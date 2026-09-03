'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Plus, Search, Trash2, Upload, FileText, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Textarea, Select } from '@/components/ui/input';
import { Badge, statusToBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import ClientLayout from '../client-layout';
import { api } from '@/lib/api';
import { formatRelative, formatDate, cn } from '@/lib/utils';

interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  embeddingModel: string;
  chunkSize: number;
  chunkOverlap: number;
  status: string;
  createdAt: string;
  _count?: { documents: number; chunks?: number };
}

interface Document {
  id: string;
  filename: string;
  originalName: string;
  fileType: string;
  fileSize: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  error?: string;
  processedAt?: string;
  createdAt: string;
}

export default function KnowledgePage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[] | null>(null);

  const { data: bases, isLoading } = useQuery<KnowledgeBase[]>({
    queryKey: ['knowledge-bases'],
    queryFn: async () => (await api.get('/knowledge-bases')).data,
  });

  const { data: detail } = useQuery<KnowledgeBase & { documents: Document[] }>({
    queryKey: ['knowledge-base', selectedId],
    queryFn: async () => (await api.get(`/knowledge-bases/${selectedId}`)).data,
    enabled: !!selectedId,
  });

  const create = useMutation({
    mutationFn: (data: { name: string; description?: string }) => api.post('/knowledge-bases', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge-bases'] });
      setShowCreate(false);
    },
  });

  const removeBase = useMutation({
    mutationFn: (id: string) => api.delete(`/knowledge-bases/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge-bases'] });
      setSelectedId(null);
    },
  });

  const removeDoc = useMutation({
    mutationFn: (docId: string) => api.delete(`/knowledge-bases/${selectedId}/documents/${docId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge-base', selectedId] }),
  });

  const reindex = useMutation({
    mutationFn: (docId: string) => api.post(`/knowledge-bases/${selectedId}/documents/${docId}/reindex`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge-base', selectedId] }),
  });

  const onSearch = async () => {
    if (!selectedId || !searchQuery.trim()) return;
    const res = await api.post(`/knowledge-bases/${selectedId}/search`, { query: searchQuery, topK: 5 });
    setSearchResults(res.data.chunks);
  };

  return (
    <ClientLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Knowledge Bases</h1>
            <p className="text-gray-600">Upload documents so your agents can ground their answers.</p>
          </div>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> New knowledge base
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* List */}
          <div className="space-y-2">
            {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
            {bases?.length === 0 && (
              <EmptyState
                icon={<BookOpen className="h-6 w-6" />}
                title="No knowledge bases yet"
                description="Create your first one to upload documents."
                action={<Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> Create</Button>}
              />
            )}
            {bases?.map((kb) => (
              <Card
                key={kb.id}
                className={cn('cursor-pointer transition-colors hover:border-primary-300', selectedId === kb.id && 'border-primary-500 ring-2 ring-primary-100')}
                onClick={() => { setSelectedId(kb.id); setSearchResults(null); setSearchQuery(''); }}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{kb.name}</p>
                      <p className="text-xs text-gray-500">{kb._count?.documents ?? 0} documents · {kb._count?.chunks ?? 0} chunks</p>
                    </div>
                    <Badge variant={statusToBadge(kb.status)}>{kb.status}</Badge>
                  </div>
                  {kb.description && <p className="mt-2 line-clamp-2 text-xs text-gray-600">{kb.description}</p>}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Detail */}
          <div className="lg:col-span-2">
            {selectedId && detail ? (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>{detail.name}</CardTitle>
                    <p className="mt-1 text-xs text-gray-500">
                      {detail.embeddingModel} · {detail.chunkSize} tokens / {detail.chunkOverlap} overlap
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowUpload(true)}>
                      <Upload className="h-4 w-4" /> Upload
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => removeBase.mutate(selectedId)}>
                      <Trash2 className="h-4 w-4" /> Archive
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Search */}
                  <div className="flex gap-2">
                    <Input
                      placeholder="Search the knowledge base (debug)…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && onSearch()}
                    />
                    <Button variant="outline" onClick={onSearch}>
                      <Search className="h-4 w-4" /> Search
                    </Button>
                  </div>
                  {searchResults && (
                    <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
                      <p className="text-xs font-semibold text-blue-900">Top {searchResults.length} chunks</p>
                      {searchResults.length === 0 && <p className="text-xs text-blue-800">No matches.</p>}
                      {searchResults.map((c: any) => (
                        <div key={c.id} className="rounded border border-blue-200 bg-white p-2 text-xs">
                          <p className="text-gray-700">{c.content}</p>
                          <p className="mt-1 text-gray-400">distance: {c.distance?.toFixed?.(4) ?? c.distance}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Documents */}
                  <div>
                    <p className="mb-2 text-sm font-medium text-gray-700">Documents</p>
                    {detail.documents?.length === 0 && (
                      <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                        No documents yet. Click Upload to add one.
                      </p>
                    )}
                    <div className="divide-y divide-gray-100">
                      {detail.documents?.map((d) => (
                        <div key={d.id} className="flex items-center justify-between py-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <FileText className="h-5 w-5 text-gray-400" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-gray-900">{d.originalName}</p>
                              <p className="text-xs text-gray-500">
                                {Math.round(d.fileSize / 1024)} KB · {formatRelative(d.createdAt)}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusPill status={d.status} error={d.error} />
                            {d.status === 'FAILED' && (
                              <Button size="sm" variant="outline" onClick={() => reindex.mutate(d.id)}>
                                Retry
                              </Button>
                            )}
                            <Button size="icon" variant="ghost" onClick={() => removeDoc.mutate(d.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <EmptyState
                icon={<BookOpen className="h-6 w-6" />}
                title="Select a knowledge base"
                description="Pick one on the left to manage its documents and run debug searches."
              />
            )}
          </div>
        </div>
      </div>

      {showCreate && <CreateKBDialog onClose={() => setShowCreate(false)} onSubmit={(d: { name: string; description?: string }) => create.mutate(d)} loading={create.isPending} />}
      {showUpload && selectedId && <UploadDialog kbId={selectedId} onClose={() => setShowUpload(false)} onDone={() => { qc.invalidateQueries({ queryKey: ['knowledge-base', selectedId] }); setShowUpload(false); }} />}
    </ClientLayout>
  );
}

function StatusPill({ status, error }: { status: string; error?: string }) {
  if (status === 'PROCESSING' || status === 'PENDING') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
        <Loader2 className="h-3 w-3 animate-spin" /> {status}
      </span>
    );
  }
  if (status === 'FAILED') {
    return (
      <span title={error} className="inline-flex cursor-help items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
        <AlertCircle className="h-3 w-3" /> FAILED
      </span>
    );
  }
  if (status === 'COMPLETED') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
        <CheckCircle2 className="h-3 w-3" /> Ready
      </span>
    );
  }
  return <Badge>{status}</Badge>;
}

function CreateKBDialog({ onClose, onSubmit, loading }: any) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>New knowledge base</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Product docs" />
          </div>
          <div>
            <Label>Description (optional)</Label>
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </CardContent>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSubmit({ name, description })} loading={loading} disabled={!name.trim()}>
            Create
          </Button>
        </div>
      </Card>
    </div>
  );
}

function UploadDialog({ kbId, onClose, onDone }: any) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!file && !url.trim()) return;
    setLoading(true);
    try {
      const form = new FormData();
      if (file) form.append('file', file);
      if (url) form.append('url', url);
      await api.post(`/knowledge-bases/${kbId}/documents`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onDone();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Upload document</CardTitle>
          <p className="mt-1 text-xs text-gray-500">PDF, DOCX, TXT, CSV, MD or HTML. Max 50 MB.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>File</Label>
            <input
              ref={fileRef}
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-700"
            />
          </div>
          <div className="text-center text-xs text-gray-400">— or —</div>
          <div>
            <Label>URL (webpage)</Label>
            <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/article" />
          </div>
        </CardContent>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={loading} disabled={!file && !url.trim()}>
            Upload
          </Button>
        </div>
      </Card>
    </div>
  );
}
