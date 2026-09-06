import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

/**
 * The reference data almost every screen needs: products, investigation types,
 * geography, investigators.
 *
 * Cached hard and shared across screens. These change a few times a year, and
 * refetching them on every case list would be one query per dropdown per
 * navigation for data that has not moved.
 *
 * Each hook returns the array directly rather than the paginated envelope,
 * because a dropdown does not want `{ data, meta }`.
 */

const CATALOG_STALE_TIME = 10 * 60_000;

export function useProducts({ activeOnly = true } = {}) {
  return useQuery({
    queryKey: ['products', { activeOnly }],
    queryFn: async () =>
      (await api.get('/products', { params: { activeOnly, limit: 200 } })).data.data,
    staleTime: CATALOG_STALE_TIME,
  });
}

export function useInvestigationTypes({ activeOnly = true } = {}) {
  return useQuery({
    queryKey: ['investigation-types', { activeOnly }],
    queryFn: async () =>
      (await api.get('/investigation-types', { params: { activeOnly, limit: 200 } }))
        .data.data,
    staleTime: CATALOG_STALE_TIME,
  });
}

export function useGovernorates() {
  return useQuery({
    queryKey: ['governorates'],
    queryFn: async () => (await api.get('/geography/governorates')).data,
    staleTime: Infinity, // Egypt's governorates do not change during a session.
  });
}

export function useCities(governorateId) {
  return useQuery({
    queryKey: ['cities', governorateId],
    queryFn: async () =>
      (await api.get('/geography/cities', { params: { governorateId } })).data,
    enabled: Boolean(governorateId),
    staleTime: Infinity,
  });
}

export function useDistricts(cityId) {
  return useQuery({
    queryKey: ['districts', cityId],
    queryFn: async () =>
      (await api.get('/geography/districts', { params: { cityId } })).data,
    enabled: Boolean(cityId),
    staleTime: Infinity,
  });
}

export function useInvestigators({ status = 'ACTIVE' } = {}) {
  return useQuery({
    queryKey: ['investigators', { status }],
    queryFn: async () =>
      (await api.get('/investigators', { params: { status, limit: 200 } })).data.data,
    staleTime: 2 * 60_000,
  });
}

export function useRoles() {
  return useQuery({
    queryKey: ['roles'],
    queryFn: async () => (await api.get('/roles')).data,
    staleTime: CATALOG_STALE_TIME,
  });
}

export function usePermissionCatalog() {
  return useQuery({
    queryKey: ['permission-catalog'],
    queryFn: async () => (await api.get('/permissions')).data,
    staleTime: Infinity, // Fixed by the build, not by the tenant.
  });
}

export function useMediaCategories() {
  return useQuery({
    queryKey: ['media-categories'],
    queryFn: async () =>
      (await api.get('/media/categories/all', { params: { activeOnly: true } })).data,
    staleTime: CATALOG_STALE_TIME,
  });
}

export function useQcReasons() {
  return useQuery({
    queryKey: ['qc-reasons'],
    queryFn: async () =>
      (await api.get('/qc/reasons', { params: { activeOnly: true } })).data,
    staleTime: CATALOG_STALE_TIME,
  });
}
