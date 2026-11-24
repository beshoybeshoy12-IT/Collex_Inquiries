import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import { useRealtime } from '../../hooks/useRealtime';

/**
 * Chat data. The socket only says "conversation X changed"; everything is
 * fetched over REST, so who-may-see-what is decided in one place, the server.
 */
export function useChatSignals() {
  const queryClient = useQueryClient();

  useRealtime('chat:message', (payload) => {
    queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
    queryClient.invalidateQueries({ queryKey: ['chat', 'unread'] });
    if (payload?.conversationId) {
      queryClient.invalidateQueries({ queryKey: ['chat', 'messages', payload.conversationId] });
    }
  });

  useRealtime('chat:read', (payload) => {
    if (payload?.conversationId) {
      queryClient.invalidateQueries({ queryKey: ['chat', 'messages', payload.conversationId] });
    }
    queryClient.invalidateQueries({ queryKey: ['chat', 'unread'] });
  });
}

export function useChatUnread() {
  return useQuery({
    queryKey: ['chat', 'unread'],
    queryFn: async () => (await api.get('/chat/unread')).data,
    // The socket keeps it fresh; this is the safety net if a signal is lost.
    refetchInterval: 120_000,
    staleTime: 30_000,
  });
}

export function useConversations(enabled) {
  return useQuery({
    queryKey: ['chat', 'conversations'],
    queryFn: async () => (await api.get('/chat/conversations')).data,
    enabled,
    staleTime: 15_000,
  });
}

export function useContacts(search, enabled) {
  const [term, setTerm] = useState(search);
  // Debounced, so typing a name is one request, not one per letter.
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  return useQuery({
    queryKey: ['chat', 'contacts', term],
    queryFn: async () =>
      (await api.get('/chat/contacts', { params: term ? { search: term } : {} })).data,
    enabled,
    staleTime: 60_000,
  });
}

/** A conversation's messages, newest page first; older pages load on demand. */
export function useMessages(conversationId) {
  const query = useInfiniteQuery({
    queryKey: ['chat', 'messages', conversationId],
    queryFn: async ({ pageParam }) =>
      (
        await api.get(`/chat/conversations/${conversationId}/messages`, {
          params: pageParam ? { before: pageParam, limit: 40 } : { limit: 40 },
        })
      ).data,
    initialPageParam: null,
    getNextPageParam: (page) =>
      page.hasMore && page.messages.length ? page.messages[0].createdAt : undefined,
    enabled: Boolean(conversationId),
  });

  const pages = query.data?.pages ?? [];
  const messages = [...pages].reverse().flatMap((page) => page.messages);
  const other = pages[0]?.other ?? null;
  return { ...query, messages, other };
}

/** A sent file as an object URL — for showing an image in the thread. */
export function useChatFileUrl(attachment, enabled = true) {
  const { data: blob } = useQuery({
    queryKey: ['chat', 'file', attachment?.id],
    queryFn: async () => fetchChatFile(attachment),
    enabled: Boolean(attachment?.id) && enabled,
    staleTime: Infinity,
    retry: false,
  });
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!blob) return undefined;
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

/**
 * The file's bytes, typed. The server sends them opaque and nameless, so the
 * browser never renders them on our origin and a download manager leaves the
 * request alone; the type comes from the message.
 */
export async function fetchChatFile(attachment) {
  const response = await api.get(`/chat/attachments/${attachment.id}`, {
    responseType: 'blob',
    timeout: 120_000,
  });
  return new Blob([response.data], { type: attachment.mimeType });
}
