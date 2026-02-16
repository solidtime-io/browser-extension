<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { computed, onMounted, watch, watchEffect } from "vue";
import {
    TimeEntryGroupedTable,
    LoadingSpinner,
    TimeTrackerControls,
    TimeTrackerRunningInDifferentOrganizationOverlay,
} from "@solidtime/ui";
import { apiClient } from "../../utils/api";
import {
    useMyMemberships,
    currentMembershipId,
} from "../../utils/myMemberships";
import { useTimer } from "../../utils/useTimer";
import { useLiveTimer } from "../../utils/liveTimer";
import { useCurrentTimeEntryUpdateMutation } from "../../utils/timeEntries";
import { getCurrentTimeEntry } from "../../utils/timeEntries";
import { emptyTimeEntry } from "../../utils/timeEntries";
import { dayjs } from "../../utils/dayjs";
import type {
    CreateClientBody,
    CreateProjectBody,
    CreateTimeEntryBody,
    TimeEntry,
    UpdateMultipleTimeEntriesChangeset,
} from "@solidtime/api";

// Use shared memberships state
const { currentOrganizationId, currentMembership, memberships } =
    useMyMemberships();

// Fetch time entries
const { data: timeEntriesResponse } = useQuery({
    queryKey: ["timeEntries", currentOrganizationId],
    queryFn: async () => {
        const client = apiClient();
        return await client.getTimeEntries({
            params: { organization: currentOrganizationId.value! },
            queries: {
                member_id: currentMembership.value!.id,
                limit: 50,
                only_full_dates: true,
            },
        });
    },
    enabled: computed(
        () => !!currentOrganizationId.value && !!currentMembership.value?.id,
    ),
});

const timeEntries = computed(() => timeEntriesResponse.value?.data ?? []);

// Fetch projects
const { data: projectsResponse } = useQuery({
    queryKey: ["projects", currentOrganizationId],
    queryFn: async () => {
        const client = apiClient();
        return await client.getProjects({
            params: { organization: currentOrganizationId.value! },
        });
    },
    enabled: computed(() => !!currentOrganizationId.value),
});

const projects = computed(() => projectsResponse.value?.data ?? []);

// Fetch tasks
const { data: tasksResponse } = useQuery({
    queryKey: ["tasks", currentOrganizationId],
    queryFn: async () => {
        const client = apiClient();
        return await client.getTasks({
            params: { organization: currentOrganizationId.value! },
        });
    },
    enabled: computed(() => !!currentOrganizationId.value),
});

const tasks = computed(() => tasksResponse.value?.data ?? []);

// Fetch tags
const { data: tagsResponse } = useQuery({
    queryKey: ["tags", currentOrganizationId],
    queryFn: async () => {
        const client = apiClient();
        return await client.getTags({
            params: { organization: currentOrganizationId.value! },
        });
    },
    enabled: computed(() => !!currentOrganizationId.value),
});

const tags = computed(() => tagsResponse.value?.data ?? []);

// Fetch clients
const { data: clientsResponse } = useQuery({
    queryKey: ["clients", currentOrganizationId],
    queryFn: async () => {
        const client = apiClient();
        return await client.getClients({
            params: { organization: currentOrganizationId.value! },
        });
    },
    enabled: computed(() => !!currentOrganizationId.value),
});

const clients = computed(() => clientsResponse.value?.data ?? []);

// Mutations
async function createTag(name: string) {
    const client = apiClient();
    const response = await client.createTag(
        { name },
        { params: { organization: currentOrganizationId.value! } },
    );
    return response.data;
}

async function createProject(project: CreateProjectBody) {
    const client = apiClient();
    const response = await client.createProject(project, {
        params: { organization: currentOrganizationId.value! },
    });
    return response.data;
}

async function createClient(clientData: CreateClientBody) {
    const client = apiClient();
    const response = await client.createClient(clientData, {
        params: { organization: currentOrganizationId.value! },
    });
    return response.data;
}

async function createTimeEntry(entry: Omit<CreateTimeEntryBody, "member_id">) {
    const client = apiClient();
    await client.createTimeEntry(
        { ...entry, member_id: currentMembership.value!.id },
        { params: { organization: currentOrganizationId.value! } },
    );
}

async function updateTimeEntry(entry: TimeEntry) {
    const client = apiClient();
    await client.updateTimeEntry(entry, {
        params: {
            organization: currentOrganizationId.value!,
            timeEntry: entry.id,
        },
    });
}

async function updateTimeEntries(ids: string[], changes: Partial<TimeEntry>) {
    const client = apiClient();
    await client.updateMultipleTimeEntries(
        { ids, changes: changes as UpdateMultipleTimeEntriesChangeset },
        { params: { organization: currentOrganizationId.value! } },
    );
}

async function deleteTimeEntries(entries: TimeEntry[]) {
    const client = apiClient();
    for (const entry of entries) {
        await client.deleteTimeEntry({
            params: {
                organization: currentOrganizationId.value!,
                timeEntry: entry.id,
            },
        });
    }
}

const selectedTimeEntries = computed({
    get: () => [],
    set: () => {},
});

const currency = computed(
    () => currentMembership.value?.organization?.currency ?? "USD",
);
const canCreateProject = computed(() => {
    const role = currentMembership.value?.role;
    return role === "admin" || role === "owner" || role === "manager";
});

// Timer state (must be after timeEntriesResponse is defined)
const { liveTimer, startLiveTimer, stopLiveTimer } = useLiveTimer();
const { currentTimeEntry, lastTimeEntry, isActive, stopTimer, startTimer } =
    useTimer();

// Fetch current time entry
const {
    data: currentTimeEntryResponse,
    isError: currentTimeEntryResponseIsError,
} = useQuery({
    queryKey: ["currentTimeEntry"],
    queryFn: () => getCurrentTimeEntry(),
});

// Update lastTimeEntry when timeEntries change
watch(
    () => timeEntriesResponse.value,
    () => {
        const entries = timeEntriesResponse.value?.data;
        if (entries?.[0]) {
            lastTimeEntry.value = { ...entries[0] };
        }
    },
);

watch(currentTimeEntryResponseIsError, () => {
    if (currentTimeEntryResponseIsError.value) {
        // Only reset if we had a previously started timer (has an ID)
        // Don't reset if user is preparing a new time entry (no ID yet)
        if (currentTimeEntry.value.id !== '') {
            currentTimeEntry.value = { ...emptyTimeEntry };
        }
    }
});

watch(currentTimeEntryResponse, () => {
    if (currentTimeEntryResponse.value?.data) {
        currentTimeEntry.value = { ...currentTimeEntryResponse.value?.data };
    }
});

// Watch for active state changes and manage live timer
watchEffect(() => {
    if (isActive.value) {
        startLiveTimer();
    } else {
        stopLiveTimer();
    }
});

onMounted(async () => {
    liveTimer.value = dayjs().utc();
});

const currentTimeEntryUpdateMutation = useCurrentTimeEntryUpdateMutation();

function updateCurrentTimeEntry() {
    if (currentTimeEntry.value?.id) {
        currentTimeEntryUpdateMutation.mutate(currentTimeEntry.value);
    }
}

function switchOrganization() {
    const newMembershipId = memberships.value.find(
        (membership) =>
            membership.organization.id ===
            currentTimeEntry.value.organization_id,
    )?.id;
    if (newMembershipId) {
        currentMembershipId.value = newMembershipId;
    }
}
</script>

<template>
    <div class="w-full h-full bg-default-background flex flex-col">
        <div
            v-if="timeEntries && projects && tasks && tags && clients"
            class="flex flex-col h-full"
        >
            <!-- Time Tracker Controls -->
            <div class="p-2 border-b border-border-primary relative">
                <TimeTrackerRunningInDifferentOrganizationOverlay
                    v-if="
                        currentTimeEntry.organization_id &&
                        currentTimeEntry.organization_id !==
                            currentOrganizationId
                    "
                    @switch-organization="switchOrganization"
                />
                <TimeTrackerControls
                    v-model:currentTimeEntry="currentTimeEntry"
                    v-model:liveTimer="liveTimer"
                    :tags="tags"
                    :enableEstimatedTime="false"
                    :canCreateProject="canCreateProject"
                    :createProject="createProject"
                    :createClient="createClient"
                    :tasks="tasks"
                    :clients="clients"
                    :projects="projects"
                    :createTag="createTag"
                    :isActive="isActive"
                    :currency="currency"
                    :timeEntries="timeEntries"
                    @start-live-timer="startLiveTimer"
                    @stop-live-timer="stopLiveTimer"
                    @start-timer="startTimer"
                    @stop-timer="stopTimer"
                    @update-time-entry="updateCurrentTimeEntry"
                />
            </div>

            <!-- Time Entries List -->
            <div class="flex-1 overflow-y-auto">
                <TimeEntryGroupedTable
                    v-model:selected="selectedTimeEntries"
                    :timeEntries="timeEntries"
                    :projects="projects"
                    :tasks="tasks"
                    :tags="tags"
                    :clients="clients"
                    :createTag="createTag"
                    :updateTimeEntry="updateTimeEntry"
                    :updateTimeEntries="updateTimeEntries"
                    :deleteTimeEntries="deleteTimeEntries"
                    :createTimeEntry="createTimeEntry"
                    :createProject="createProject"
                    :createClient="createClient"
                    :currency="currency"
                    :enableEstimatedTime="false"
                    :canCreateProject="canCreateProject"
                />
            </div>
        </div>
        <div v-else class="flex items-center justify-center h-full">
            <div class="flex flex-col items-center">
                <LoadingSpinner class="ml-0 mr-0" />
                <span class="py-3 font-medium text-sm text-muted text-center"
                    >Loading time entries...</span
                >
            </div>
        </div>
    </div>
</template>
