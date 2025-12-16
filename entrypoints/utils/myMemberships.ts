import { apiClient } from "./api";
import { useQuery } from "@tanstack/vue-query";
import { computed, watch } from "vue";
import type { MyMembership, MyMemberships } from "@solidtime/api";
import { useStorage } from "@vueuse/core";

export function getMyMemberships() {
  const client = apiClient();
  return client.getMyMemberships({});
}

export const currentMembershipId = useStorage<string | null>(
  "currentMembershipId",
  null,
);

export function useMyMemberships() {
  const query = useQuery({
    queryKey: ["myMemberships"],
    queryFn: getMyMemberships,
  });
  const memberships = computed<MyMemberships>(() => {
    return query.data.value?.data ?? [];
  });

  const currentMembership = computed(() => {
    return memberships.value?.find(
      (membership: MyMembership) => membership.id === currentMembershipId.value,
    );
  });

  const currentOrganizationId = computed(() => {
    if (currentMembership.value) {
      return currentMembership.value?.organization?.id;
    }
    return null;
  });

  watch(memberships, () => {
    if (currentMembershipId.value === null) {
      currentMembershipId.value = memberships.value?.[0]?.id;
    } else if (
      !memberships.value.some(
        (membership: MyMembership) =>
          membership.id === currentMembershipId.value,
      )
    ) {
      currentMembershipId.value = memberships.value?.[0]?.id;
    }
  });

  // Store current organization ID and membership ID in browser.storage for content scripts to access
  watch(currentOrganizationId, async (newOrgId) => {
    if (newOrgId) {
      await browser.storage.local.set({ current_organization_id: newOrgId });
    }
  });

  watch(currentMembershipId, async (newMembershipId) => {
    if (newMembershipId) {
      await browser.storage.local.set({ currentMembershipId: newMembershipId });
    }
  });

  return { query, memberships, currentOrganizationId, currentMembership };
}
