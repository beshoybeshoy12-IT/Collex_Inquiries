import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

/**
 * Clients ("الجهات") — the banks and companies inquiries are done for.
 *
 * The list is small and changes rarely, so it is cached and shared: the case
 * list, the case page and the printed form all read the same copy.
 */
export function useClients({ includeInactive = false, enabled = true } = {}) {
  return useQuery({
    queryKey: ['clients', { includeInactive }],
    queryFn: async () =>
      (await api.get('/clients', { params: includeInactive ? { includeInactive: true } : {} }))
        .data,
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useClient(id) {
  return useQuery({
    queryKey: ['client', id],
    queryFn: async () => (await api.get(`/clients/${id}`)).data,
    enabled: Boolean(id),
  });
}

/**
 * The client's logo as an object URL, or null.
 *
 * Fetched with the signed-in token (it is not at a public URL) and keyed on
 * the logo's version, so a new upload is a new request and an unchanged logo
 * is never fetched twice.
 *
 * @param {{ id: string, logoVersion?: string|null }|null|undefined} client
 */
export function useClientLogoUrl(client) {
  return useClientLogo(client).url;
}

/** The logo URL plus `settled`: loaded, failed, or there is none. */
function useClientLogo(client) {
  const version = client?.logoVersion;
  const { data: blob, isError } = useQuery({
    queryKey: ['client-logo', client?.id, version],
    queryFn: async () =>
      (
        await api.get(`/clients/${client.id}/logo`, {
          params: { v: version },
          responseType: 'blob',
        })
      ).data,
    enabled: Boolean(client?.id && version),
    staleTime: Infinity,
    retry: false,
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

  return { url, settled: !version || isError || Boolean(url) };
}

/**
 * The client a case belongs to, ready for the printed form: its name, its
 * logo as an object URL, and whether the logo has finished loading — printing
 * waits on that, or the first page comes out without it.
 *
 * @param {{ clientAccount?: { id: string } | null } | null | undefined} investigation
 */
export function useCaseClient(investigation) {
  const ref = investigation?.clientAccount ?? null;
  const { data: clients, isLoading } = useClients({ includeInactive: true, enabled: Boolean(ref) });
  // The case carries the client's name; the list adds its logo version.
  const client = ref ? { ...ref, ...(clients ?? []).find((item) => item.id === ref.id) } : null;
  const logo = useClientLogo(client);
  const logoUrl = logo.url;
  // A logo that fails to load must not stop the form from printing.
  const ready = !ref || (!isLoading && logo.settled);
  return { client, logoUrl, ready };
}
