import { apiClient } from './api'
import type {
    CreateTimeEntryBody,
    TimeEntry,
    TimeEntryResponse,
    UpdateMultipleTimeEntriesChangeset,
} from '@solidtime/api'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { useMyMemberships } from './myMemberships'

export const emptyTimeEntry = {
    id: '',
    description: null,
    user_id: '',
    start: '',
    end: null,
    duration: null,
    task_id: null,
    project_id: null,
    tags: [],
    billable: false,
    organization_id: '',
} as TimeEntry

const offlineUuidStore = {} as Record<string, string>

export function getCurrentTimeEntry() {
    const client = apiClient()
    return client.getMyActiveTimeEntry({})
}

export function useTimeEntryStopMutation() {
    const queryClient = useQueryClient()
    const { currentOrganizationId } = useMyMemberships()

    return useMutation({
        scope: {
            id: 'timeEntry',
        },
        mutationFn: (timeEntry: TimeEntry) => {
            if (currentOrganizationId.value === null) {
                throw new Error('No current organization id - create time entry')
            }
            if (timeEntry.id === '') {
                throw new Error('No time entry id - stop time entry')
            }
            if (timeEntry.id in offlineUuidStore) {
                timeEntry.id = offlineUuidStore[timeEntry.id]
            }
            const client = apiClient()
            return client.updateTimeEntry(
                { ...timeEntry },
                {
                    params: {
                        organization: currentOrganizationId.value,
                        timeEntry: timeEntry.id,
                    },
                }
            )
        },
        onMutate: async (timeEntry: TimeEntry) => {
            await queryClient.cancelQueries({ queryKey: ['timeEntries', currentOrganizationId] })
            await queryClient.cancelQueries({ queryKey: ['currentTimeEntry'] })

            queryClient.setQueryData(['currentTimeEntry'], () => emptyTimeEntry)

            return { timeEntry }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['timeEntries', currentOrganizationId] })
            queryClient.invalidateQueries({ queryKey: ['currentTimeEntry'] })
        },
    })
}

export function useCurrentTimeEntryUpdateMutation() {
    const queryClient = useQueryClient()
    const { currentOrganizationId } = useMyMemberships()

    return useMutation({
        scope: {
            id: 'timeEntry',
        },
        mutationFn: (timeEntry: TimeEntry) => {
            if (currentOrganizationId.value === null) {
                throw new Error('No current organization id - update time entry')
            }
            if (timeEntry.id === '') {
                throw new Error('No time entry id - update time entry')
            }
            if (offlineUuidStore[timeEntry.id]) {
                timeEntry.id = offlineUuidStore[timeEntry.id]
            }
            const client = apiClient()
            return client.updateTimeEntry(timeEntry, {
                params: {
                    organization: currentOrganizationId.value,
                    timeEntry: timeEntry.id,
                },
            })
        },
        onMutate: async (variables) => {
            await queryClient.cancelQueries({ queryKey: ['currentTimeEntry'] })
            const optimisticTimeEntry = { data: { ...variables } }
            queryClient.setQueryData(['currentTimeEntry'], () => optimisticTimeEntry)
            return { optimisticTimeEntry }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['timeEntries', currentOrganizationId] })
            queryClient.invalidateQueries({ queryKey: ['currentTimeEntry'] })
        },
    })
}

export function useTimeEntryCreateMutation() {
    const queryClient = useQueryClient()
    const { currentOrganizationId } = useMyMemberships()

    return useMutation({
        scope: {
            id: 'timeEntry',
        },
        mutationFn: (timeEntry: CreateTimeEntryBody) => {
            if (currentOrganizationId.value === null) {
                throw new Error('No current organization id - create time entry')
            }
            const client = apiClient()
            return client.createTimeEntry(timeEntry, {
                params: {
                    organization: currentOrganizationId.value,
                },
            })
        },
        onMutate: async (variables) => {
            await queryClient.cancelQueries({ queryKey: ['currentTimeEntry'] })
            const optimisticTimeEntry = {
                data: {
                    ...variables,
                    organization_id: currentOrganizationId.value,
                    id: self.crypto.randomUUID(),
                },
            }
            queryClient.setQueryData(['currentTimeEntry'], () => optimisticTimeEntry)
            return { optimisticTimeEntry }
        },
        onSuccess: (data, _, context) => {
            offlineUuidStore[context.optimisticTimeEntry.data.id] = data.data.id
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['timeEntries', currentOrganizationId] })
            queryClient.invalidateQueries({ queryKey: ['currentTimeEntry'] })
        },
    })
}
