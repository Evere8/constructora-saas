import type { Paginated } from '@/types/api';

export function asItems<T>(data: Paginated<T> | T[] | undefined | null): T[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.items ?? [];
}

export function asTotal<T>(data: Paginated<T> | T[] | undefined | null, fallback = 0): number {
  if (!data) return fallback;
  if (Array.isArray(data)) return data.length;
  return data.total ?? data.items?.length ?? fallback;
}
