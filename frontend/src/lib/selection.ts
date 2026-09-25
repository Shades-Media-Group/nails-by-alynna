import type { Category, Service } from '@/types/api';

interface CatalogIndex {
  byId: Map<string, Service>;
  categoryById: Map<string, Category>;
}

/**
 * Adds or removes a service. In a one-choice category (extension sizes) picking another option
 * replaces the previous one instead of stacking two lengths in one visit.
 */
export function toggleService(selected: string[], service: Service, catalog: CatalogIndex): string[] {
  if (selected.includes(service.id)) return selected.filter((id) => id !== service.id);
  const singleChoice = catalog.categoryById.get(service.categoryId)?.singleChoice === true;
  const kept = singleChoice ? selected.filter((id) => catalog.byId.get(id)?.categoryId !== service.categoryId) : selected;
  return [...kept, service.id];
}
