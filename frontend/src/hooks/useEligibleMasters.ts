import { useQuery } from '@tanstack/react-query';
import { queries } from '@/services/queries';
import type { StaffMember } from '@/types/api';

/** Masters who can do every chosen service; "Any master" offers the most free times. */
export function useEligibleMasters(serviceIds: string[]) {
  const staff = useQuery(queries.staff());
  const eligible = (staff.data ?? []).filter(
    (member: StaffMember) => !member.serviceIds || serviceIds.every((id) => member.serviceIds!.includes(id)),
  );
  return { ...staff, eligible };
}
