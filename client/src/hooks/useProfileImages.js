import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';

/**
 * The signed-in user's profile photo and cover.
 *
 * The images are served by the API to the caller's own token, so an <img src>
 * cannot point at them directly (it would carry no Authorization header).
 * Each is fetched as a blob through the normal axios instance — which also
 * gets token refresh for free — and shown through an object URL.
 *
 * `/profile` returns a version per image that changes on every upload; it is
 * part of both the query key and the request, so a new photo is a new URL and
 * the browser's private cache can hold the old one without ever showing it.
 */

const SUMMARY_KEY = ['profile-images'];

export function useProfileImages() {
  const { data } = useQuery({
    queryKey: SUMMARY_KEY,
    queryFn: async () => (await api.get('/profile')).data,
    staleTime: 5 * 60_000,
  });

  return {
    avatar: useImageUrl('avatar', data?.avatar),
    cover: useImageUrl('cover', data?.cover),
    hasAvatar: Boolean(data?.avatar),
    hasCover: Boolean(data?.cover),
  };
}

function useImageUrl(kind, version) {
  const { data: blob } = useQuery({
    queryKey: ['profile-image', kind, version],
    queryFn: async () =>
      (await api.get(`/profile/${kind}`, { params: { v: version }, responseType: 'blob' })).data,
    enabled: Boolean(version),
    staleTime: Infinity,
  });

  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!version || !blob) {
      setUrl(null);
      return undefined;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob, version]);

  return url;
}

/** Upload or remove one image; refreshes every place that shows it. */
export function useProfileImageMutations() {
  const queryClient = useQueryClient();
  const refresh = (summary) => queryClient.setQueryData(SUMMARY_KEY, summary);

  const upload = useMutation({
    mutationFn: async ({ kind, file }) => {
      const form = new FormData();
      form.append('file', file);
      return (await api.post(`/profile/${kind}`, form)).data;
    },
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: async (kind) => (await api.delete(`/profile/${kind}`)).data,
    onSuccess: refresh,
  });

  return { upload, remove };
}

/** Client-side limits, for a quick answer. The server enforces the real ones. */
export const PROFILE_IMAGE_LIMITS = {
  avatar: 5 * 1024 * 1024,
  cover: 8 * 1024 * 1024,
};
export const PROFILE_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';
