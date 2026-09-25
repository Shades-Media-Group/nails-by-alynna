import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '@/components/ui';
import { useStudio } from '@/hooks/useStudio';
import { zonedDate } from '@/lib/format';
import type { AppointmentStatus, StaffAppointment } from '@/types/api';
import { adminApi, adminQueries, type AdminCategory, type AdminService } from '../api';

/** `value`, once it has stopped changing for `delay` ms (search boxes). */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** The current time, refreshed every `intervalMs` (for "now" markers and relative times). */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Today in the studio's time zone, following the clock past midnight. */
export function useStudioToday(): { today: string; now: number; timeZone: string } {
  const { timeZone } = useStudio();
  const now = useNow();
  return { today: zonedDate(new Date(now), timeZone), now, timeZone };
}

/**
 * After a booking changes: every staff list, count and client view that could show it, the
 * client app's own lists, and free times (a moved or cancelled visit frees its slot).
 */
export function useRefreshBookings() {
  const queryClient = useQueryClient();
  return useCallback(
    (clientId?: string) => {
      const keys = [
        ['admin', 'appointments'],
        ['admin', 'stats'],
        ['admin', 'clients'],
        ['appointments'],
        ['appointment'],
        ['availability-days'],
        ['availability-slots'],
      ];
      for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
      if (clientId) void queryClient.invalidateQueries({ queryKey: ['admin', 'client', clientId] });
    },
    [queryClient],
  );
}

/** The bookable price list (what clients can book), for staff. */
export function useBookableCatalog() {
  const catalog = useQuery(adminQueries.catalog());
  const index = useMemo(() => {
    const categories = (catalog.data?.categories ?? []).filter((c) => c.isActive).sort((a, b) => a.order - b.order);
    const categoryById = new Map<string, AdminCategory>(categories.map((c) => [c.id, c]));
    const services = (catalog.data?.services ?? []).filter((s) => s.isActive && categoryById.has(s.categoryId)).sort((a, b) => a.order - b.order);
    const byId = new Map<string, AdminService>(services.map((s) => [s.id, s]));
    return { categories, services, categoryById, byId };
  }, [catalog.data]);
  return { ...catalog, ...index };
}

export interface StatusChange {
  id: string;
  status: AppointmentStatus;
  cancelReason?: string;
  /** Restore a cancelled booking even if its time was taken meanwhile. */
  force?: boolean;
  /** admin:appointment.toast.<key>; defaults to the new status. */
  toast?: string;
}

/** Move a booking to another status, then refresh every view of it and say so. */
export function useStatusChange(onDone?: (updated: StaffAppointment, change: StatusChange) => void) {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const refresh = useRefreshBookings();
  return useMutation({
    mutationFn: ({ id, status, cancelReason, force }: StatusChange) => adminApi.updateAppointment(id, { status, cancelReason, force }),
    onSuccess: (updated, change) => {
      queryClient.setQueryData(adminQueries.appointment(updated.id).queryKey, updated);
      refresh(updated.client.id);
      toast.success(t(`appointment.toast.${change.toast ?? change.status}`));
      onDone?.(updated, change);
    },
  });
}
