'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare, Send, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import ClientLayout from '../client-layout';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/utils';

interface Agent { id: string; name: string; status: string; }
interface Conversation { id: string; agentId: string; agentName?: string; title?: string; updatedAt: string; }
interface ChatMessage { id?: string; role: 'user' | 'assistant' | 'system'; content: string; createdAt?: string; }

export default function ConversationsPage() {
  const [selectedConv, setSelectedConv] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: agents } = useQuery<Agent[]>({
    queryKey: ['agents-active'],
    queryFn: async () => (await api.get('/agents?status=ACTIVE')).data,
  });
  useEffect(() => { if (!agentId && agents?.[0]) setAgentId(agents[0].id); }, [agents, agentId]);

  const { data: conversations } = useQuery<Conversation[]>({
    queryKey: ['conversations', agentId],
    queryFn: async () => (await api.get(`/conversations?agentId=${agentId}`)).data,
    enabled: !!agentId,
  });

  const send = async () => {
    if (!input.trim() || !agentId || streaming) return;
    const userMsg: ChatMessage = { role: 'user', content: input, createdAt: new Date().toISOString() };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setStreaming(true);

    // The /test endpoint is non-streaming; for SSE streaming we'd use /chat.
    // We use /test here for simplicity, then show the result.
    try {
      const res = await api.post(`/agents/${agentId}/test`, { message: userMsg.content });
      setMessages((m) => [...m, { role: 'assistant', content: res.data.content ?? res.data.message ?? '(no reply)', createdAt: new Date().toISOString() }]);
    } catch (e: any) {
      setMessages((m) => [...m, { role: 'system', content: 'Error: ' + (e?.response?.data?.error?.message ?? e?.message), createdAt: new Date().toISOString() }]);
    } finally {
      setStreaming(false);
    }
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streaming]);

  return (
    <ClientLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Conversations</h1>
          <p className="text-gray-600">Test your agents in a chat UI. Replies use the deployed version.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          <div className="space-y-2">
            <Select value={agentId} onChange={(e) => { setAgentId(e.target.value); setSelectedConv(null); setMessages([]); }}>
              <option value="">Select agent…</option>
              {agents?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
            <Card>
              <CardContent className="p-2">
                {conversations?.length === 0 && <p className="p-3 text-center text-xs text-gray-500">No history yet.</p>}
                {conversations?.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedConv(c.id)}
                    className="block w-full rounded px-2 py-2 text-left text-sm hover:bg-gray-50"
                  >
                    <p className="truncate font-medium text-gray-900">{c.title ?? 'Untitled'}</p>
                    <p className="text-xs text-gray-500">{formatRelative(c.updatedAt)}</p>
                  </button>
                ))}
              </CardContent>
            </Card>
            <Button variant="outline" size="sm" className="w-full" onClick={() => { setSelectedConv(null); setMessages([]); }}>
              <Plus className="h-4 w-4" /> New conversation
            </Button>
          </div>

          <Card className="lg:col-span-3">
            <CardContent className="flex h-[70vh] flex-col p-0">
              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
                {messages.length === 0 && (
                  <EmptyState
                    icon={<MessageSquare className="h-6 w-6" />}
                    title="Start chatting"
                    description={agentId ? 'Send a message to your agent.' : 'Pick an agent on the left to begin.'}
                  />
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-2xl whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
                      m.role === 'user'
                        ? 'rounded-br-sm bg-primary-600 text-white'
                        : m.role === 'system'
                        ? 'rounded-bl-sm bg-red-50 text-red-700'
                        : 'rounded-bl-sm bg-gray-100 text-gray-900'
                    }`}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {streaming && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl rounded-bl-sm bg-gray-100 px-4 py-2 text-sm text-gray-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-2 border-t border-gray-200 p-3">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send()}
                  placeholder={agentId ? 'Ask anything…' : 'Pick an agent first'}
                  disabled={!agentId || streaming}
                />
                <Button onClick={send} disabled={!agentId || streaming || !input.trim()}>
                  {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </ClientLayout>
  );
}
