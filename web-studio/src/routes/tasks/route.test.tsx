// @vitest-environment jsdom

import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TasksRoute } from './route'
import type { TaskRecord } from './-lib/task-record'

const clientMocks = vi.hoisted(() => ({ getTasks: vi.fn() }))

vi.mock('#/lib/ov-client', () => ({
  getOvResult: async (value: unknown) => value,
  getTasks: clientMocks.getTasks,
  ovClient: { instance: { post: vi.fn() } },
}))

vi.mock('#/gen/ov-client', () => ({ postResources: vi.fn() }))
vi.mock('#/lib/sessions/api', () => ({ commitSession: vi.fn() }))
vi.mock('#/hooks/use-app-connection', () => ({
  useAppConnection: () => ({ identityScopeKey: 'test/test' }),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, options?: { taskId?: string }) =>
      key === 'detail.openLabel' ? `Task ${options?.taskId}` : key,
  }),
}))
vi.mock('#/routes/monitoring/-components/queue-status-card', () => ({
  QueueStatusCard: () => null,
}))
vi.mock('#/routes/tasks/-components/task-detail-sheet', () => ({
  TaskDetailSheet: () => null,
}))

let records: TaskRecord[]
const queryClients: QueryClient[] = []

function runningTasks(count: number): TaskRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    task_id: `task-${index + 1}`,
    task_type: index < 8 ? 'session_commit' : 'add_resource',
    resource_id: `resource-${index + 1}`,
    status: 'running',
    created_at: 100 + index,
  }))
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClients.push(queryClient)
  render(
    <QueryClientProvider client={queryClient}>
      <TasksRoute />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

function taskRows() {
  return screen.queryAllByRole('row', { name: /^Task / })
}

function expectRunningRows(count: number) {
  expect(taskRows()).toHaveLength(count)
  for (const row of taskRows()) {
    expect(within(row).getByText('status.running')).toBeDefined()
  }
}

beforeEach(() => {
  records = runningTasks(12)
  clientMocks.getTasks.mockReset()
  // Model the API contract: filtering precedes ordering and the result limit.
  clientMocks.getTasks.mockImplementation(({ query }) =>
    records
      .filter((task) => !query.status || task.status === query.status)
      .filter((task) => !query.task_type || task.task_type === query.task_type)
      .sort((left, right) => Number(right.created_at) - Number(left.created_at))
      .slice(0, query.limit),
  )
})

afterEach(() => {
  cleanup()
  for (const client of queryClients.splice(0)) client.clear()
})

describe('task status presentation', () => {
  it('keeps all twelve running tasks running in both rows and the count', async () => {
    renderPage()
    await screen.findByRole('row', { name: 'Task task-12' })

    expectRunningRows(12)
    expect(screen.getByText('12 / 0')).toBeDefined()
  })

  it('shows no pending tasks when all tasks are running, including after type filtering', async () => {
    const user = renderPage()
    await screen.findByRole('row', { name: 'Task task-12' })

    await user.click(screen.getByRole('combobox', { name: 'filters.status' }))
    await user.click(
      await screen.findByRole('option', { name: 'status.pending' }),
    )
    await screen.findByText('emptyFiltered')
    expect(taskRows()).toHaveLength(0)
    expect(screen.getByText('0 / 0')).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'filters.clear' }))
    await screen.findByRole('row', { name: 'Task task-12' })
    await user.click(screen.getByRole('combobox', { name: 'filters.type' }))
    await user.click(
      await screen.findByRole('option', { name: 'types.add_resource' }),
    )
    await screen.findByText('4 / 0')
    expectRunningRows(4)
  })

  it('counts and filters actual pending tasks without moving running tasks into pending', async () => {
    records.push(
      ...[1, 2].map((index) => ({
        task_id: `pending-${index}`,
        task_type: 'add_resource',
        resource_id: `pending-resource-${index}`,
        status: 'pending',
        created_at: 200 + index,
      })),
    )
    const user = renderPage()
    await screen.findByRole('row', { name: 'Task pending-2' })
    expect(screen.getByText('12 / 2')).toBeDefined()

    await user.click(screen.getByRole('combobox', { name: 'filters.status' }))
    await user.click(
      await screen.findByRole('option', { name: 'status.pending' }),
    )
    await screen.findByText('0 / 2')
    expect(taskRows()).toHaveLength(2)
    for (const row of taskRows()) {
      expect(within(row).getByText('status.pending')).toBeDefined()
    }
  })

  it('preserves task statuses when grouping and pagination change the visible rows', async () => {
    records = runningTasks(26)
    records[25].resource_id = records[0].resource_id
    const user = renderPage()
    await screen.findByRole('row', { name: 'Task task-26' })
    expectRunningRows(20)
    expect(screen.getByText('25 / 0')).toBeDefined()

    await user.click(
      screen.getByRole('button', { name: 'Latest per Resource' }),
    )
    expect(screen.getByText('26 / 0')).toBeDefined()
    expectRunningRows(20)

    await user.click(screen.getByRole('button', { name: 'Go to next page' }))
    expectRunningRows(6)
    expect(screen.getByText('26 / 0')).toBeDefined()
  })
})
