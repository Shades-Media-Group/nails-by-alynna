import { useQuery } from '@tanstack/react-query';
import { loyaltyQueries } from '@/services/api/loyalty';
import { queries } from '@/services/queries';

/**
 * The stamp a visit booked for `start` will be on the client's card, and the discount it carries:
 * its place follows the completed visits and the other bookings before it. Null until known, or
 * when the card is off.
 */
export function useLoyaltyForecast(start: string): { visit: number; percent: number } | null {
  const card = useQuery(loyaltyQueries.mine());
  const upcoming = useQuery(queries.appointments('upcoming'));
  const status = card.data?.loyalty;
  if (!status?.enabled || !upcoming.data) return null;
  const before = upcoming.data.filter(
    (a) => (a.status === 'pending' || a.status === 'confirmed') && new Date(a.start).getTime() < new Date(start).getTime(),
  ).length;
  const visit = ((status.visits + before) % status.cycle) + 1;
  return { visit, percent: status.rewards.find((r) => r.visit === visit)?.percent ?? 0 };
}
