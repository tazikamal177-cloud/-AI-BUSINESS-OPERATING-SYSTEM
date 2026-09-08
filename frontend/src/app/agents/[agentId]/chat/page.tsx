'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Send, AlertCircle, CheckCircle2, Bot, User, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import ClientLayout from '@/app/client-layout';

interface Message {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'TOOL';
  content: string;
  toolCalls?: any[] | null;
  createdAt: string;
}

interface Conversation {
  id: string;
  title: string | null;
  status: string;
  metadata: any;
  agent: { id: string; name: string; avatarUrl: string | null };
  messages: Message[];
}

export default function AgentChatPage() {
  const params = useParams();
  const router = useRouter();
  const agentId = params.agentId as string;

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedContent, setStreamedContent] = useState('');
  const [activeToolCalls, setActiveToolCalls] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      router.push('/login');
    } else {
      setIsAuthenticated(true);
    }
  }, [router]);

  const { data: agent } = useQuery({
    queryKey: ['agent', agentId],
    queryFn: async () => {
      const res = await api.get(`/agents/${agentId}`);
      return res.data;
    },
    enabled: isAuthenticated && !!agentId,
  });

  const { data: conversation } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: async () => {
      const res = await api.get(`/conversations/${conversationId}`);
      return res.data;
    },
    enabled: !!conversationId,
    refetchInterval: false,
  });

  useEffect(() => {
    if (conversation?.messages) {
      setMessages(conversation.messages);
    }
  }, [conversation]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamedContent]);

  const createConversation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/conversations', { agentId });
      return res.data;
    },
    onSuccess: (data) => {
      setConversationId(data.id);
    },
    onError: (err: any) => {
      setError(err.response?.data?.error?.message || 'Erreur de création');
    },
  });

  useEffect(() => {
    if (isAuthenticated && agentId && !conversationId) {
      createConversation.mutate();
    }
  }, [isAuthenticated, agentId]);

  const sendMessage = async () => {
    if (!input.trim() || !conversationId || isStreaming) return;

    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      role: 'USER',
      content: input,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    const userInput = input;
    setInput('');
    setIsStreaming(true);
    setStreamedContent('');
    setActiveToolCalls([]);
    setError(null);

    try {
      const baseURL = '/api';
      const token = localStorage.getItem('accessToken');
      const org = JSON.parse(localStorage.getItem('organization') || '{}');

      const response = await fetch(
        `${baseURL}/conversations/${conversationId}/messages/stream`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'X-Organization-Id': org.id,
          },
          body: JSON.stringify({ message: userInput }),
        },
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error('No reader');

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.chunk) {
                setStreamedContent((prev) => prev + data.chunk);
              }
              if (data.toolCall) {
                setActiveToolCalls((prev) => [...prev, data.toolCall]);
              }
              if (data.done) {
                // Reload conversation to get persisted messages
                queryClient.invalidateQueries({
                  queryKey: ['conversation', conversationId],
                });
              }
            } catch (e) {
              // ignore parse errors
            }
          }
        }
      }

      setStreamedContent('');
      setActiveToolCalls([]);
    } catch (err: any) {
      setError(err.message || 'Erreur de streaming');
    } finally {
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const refresh = () => {
    if (conversationId) {
      queryClient.invalidateQueries({
        queryKey: ['conversation', conversationId],
      });
    }
  };

  const needsHumanReview =
    (conversation?.metadata as any)?.needsHumanReview === true;

  if (!isAuthenticated) return null;

  return (
    <ClientLayout>
      <div className="flex h-[calc(100vh-3.5rem)] flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
          <div className="flex items-center gap-3">
            <Link
              href="/agents"
              className="text-gray-400 hover:text-gray-600"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100">
              <Bot className="h-5 w-5 text-primary-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">
                {agent?.name || 'Chargement...'}
              </h2>
              <p className="text-xs text-gray-500">
                {needsHumanReview ? 'Escaladé vers humain' : 'Conversation active'}
              </p>
            </div>
          </div>
          <button
            onClick={refresh}
            className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            title="Rafraîchir"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {/* Human review banner */}
        {needsHumanReview && (
          <div className="border-b border-orange-200 bg-orange-50 px-4 py-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-orange-600" />
              <div className="flex-1">
                <p className="text-sm font-medium text-orange-900">
                  Cette conversation nécessite une intervention humaine
                </p>
                <p className="mt-0.5 text-xs text-orange-700">
                  Raison : {(conversation?.metadata as any)?.escalationReason || '—'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto bg-gray-50 px-4 py-6">
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.length === 0 && !isStreaming && (
              <div className="py-12 text-center">
                <Bot className="mx-auto h-12 w-12 text-gray-300" />
                <p className="mt-4 text-gray-500">
                  Démarre la conversation en posant une question.
                </p>
                <div className="mt-6 space-y-2">
                  <p className="text-xs text-gray-400">Exemples :</p>
                  <div className="flex flex-col items-center gap-2">
                    {[
                      'Bonjour, je voudrais savoir où en est ma commande #1001',
                      "What's the status of order #1042?",
                      "Je n'ai toujours pas reçu mon colis, c'est urgent",
                    ].map((q) => (
                      <button
                        key={q}
                        onClick={() => setInput(q)}
                        className="rounded-full border border-gray-200 bg-white px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}

            {/* Streaming assistant message */}
            {isStreaming && (
              <>
                {activeToolCalls.length > 0 && (
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100">
                      <Bot className="h-4 w-4 text-primary-600" />
                    </div>
                    <div className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-3">
                      <div className="space-y-1.5">
                        {activeToolCalls.map((tc, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 text-xs text-gray-600"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                            <span>
                              {tc.function?.name || tc.name}
                              {tc.function?.arguments && (
                                <code className="ml-1 text-gray-400">
                                  {tc.function.arguments.slice(0, 60)}
                                </code>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {(streamedContent || activeToolCalls.length === 0) && (
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100">
                      <Bot className="h-4 w-4 text-primary-600" />
                    </div>
                    <div className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900">
                      {streamedContent || (
                        <span className="text-gray-400">L&apos;agent réfléchit...</span>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-gray-200 bg-white px-4 py-4">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder="Écris ton message..."
                className="flex-1 resize-none rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                disabled={isStreaming}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || isStreaming}
                className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </ClientLayout>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'USER';
  const isTool = message.role === 'TOOL';

  if (isTool) {
    return (
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
        </div>
        <div className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-600">
          <pre className="whitespace-pre-wrap break-all">
            {truncate(message.content, 200)}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          isUser ? 'bg-gray-200' : 'bg-primary-100'
        }`}
      >
        {isUser ? (
          <User className="h-4 w-4 text-gray-600" />
        ) : (
          <Bot className="h-4 w-4 text-primary-600" />
        )}
      </div>
      <div
        className={`flex-1 rounded-lg px-4 py-3 text-sm ${
          isUser
            ? 'bg-primary-600 text-white'
            : 'border border-gray-200 bg-white text-gray-900'
        }`}
      >
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mb-2 space-y-1 border-b border-gray-200 pb-2">
            {message.toolCalls.map((tc: any, i: number) => (
              <div
                key={i}
                className="flex items-center gap-1.5 text-xs text-gray-500"
              >
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                {tc.function?.name || tc.name}
              </div>
            ))}
          </div>
        )}
        <div className="whitespace-pre-wrap">{message.content}</div>
      </div>
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '...' : s;
}
