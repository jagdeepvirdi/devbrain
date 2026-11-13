import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

const rulesMock  = vi.fn()
const addMock    = vi.fn()
const deleteMock = vi.fn()

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
  return {
    ...actual,
    timeApi: {
      rules:      (...a: unknown[]) => rulesMock(...a),
      addRule:    (...a: unknown[]) => addMock(...a),
      deleteRule: (...a: unknown[]) => deleteMock(...a),
    },
  }
})

import { TimeMappingRules } from './TimeMappingRules'

const PROJECTS = [{ id: 'p1', name: 'DevBrain' }, { id: 'p2', name: 'PlayCru' }]
const RULE = { id: 'r1', project_id: 'p1', project_name: 'DevBrain', kind: 'app' as const, pattern: 'Android Studio', priority: 5 }

beforeEach(() => {
  for (const m of [rulesMock, addMock, deleteMock]) m.mockReset()
  rulesMock.mockResolvedValue([])
})

describe('TimeMappingRules', () => {
  it('shows an empty state, then lists existing rules with their project and priority', async () => {
    rulesMock.mockResolvedValue([RULE])
    render(<TimeMappingRules projects={PROJECTS} onChanged={vi.fn()} />)
    expect(await screen.findByText('Android Studio')).toBeInTheDocument()
    expect(screen.getByText('→ DevBrain')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('says so when there are no rules', async () => {
    render(<TimeMappingRules projects={PROJECTS} onChanged={vi.fn()} />)
    expect(await screen.findByText('No rules yet.')).toBeInTheDocument()
  })

  it('disables Add until a pattern is entered', async () => {
    render(<TimeMappingRules projects={PROJECTS} onChanged={vi.fn()} />)
    const add = await screen.findByRole('button', { name: 'Add rule' })
    expect(add).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Rule pattern'), { target: { value: '  devbrain ' } })
    expect(add).toBeEnabled()
  })

  it('adds a rule (trimmed, default project, chosen kind/priority), reloads and notifies', async () => {
    const onChanged = vi.fn()
    addMock.mockResolvedValue(RULE)
    render(<TimeMappingRules projects={PROJECTS} onChanged={onChanged} />)
    await screen.findByText('No rules yet.')

    fireEvent.change(screen.getByLabelText('Rule kind'), { target: { value: 'title' } })
    fireEvent.change(screen.getByLabelText('Rule pattern'), { target: { value: '  devbrain ' } })
    fireEvent.change(screen.getByLabelText('Rule project'), { target: { value: 'p2' } })
    fireEvent.change(screen.getByLabelText('Rule priority'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))

    await waitFor(() => expect(addMock).toHaveBeenCalledWith({ project_id: 'p2', kind: 'title', pattern: 'devbrain', priority: 7 }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(rulesMock).toHaveBeenCalledTimes(2)
    expect(screen.getByLabelText('Rule pattern')).toHaveValue('')
  })

  it('defaults the project to the first one', async () => {
    addMock.mockResolvedValue(RULE)
    render(<TimeMappingRules projects={PROJECTS} onChanged={vi.fn()} />)
    await screen.findByText('No rules yet.')
    fireEvent.change(screen.getByLabelText('Rule pattern'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    await waitFor(() => expect(addMock).toHaveBeenCalledWith(expect.objectContaining({ project_id: 'p1' })))
  })

  it('shows the server error when adding fails and does not notify', async () => {
    const onChanged = vi.fn()
    addMock.mockRejectedValue(new Error('Validation error'))
    render(<TimeMappingRules projects={PROJECTS} onChanged={onChanged} />)
    await screen.findByText('No rules yet.')
    fireEvent.change(screen.getByLabelText('Rule pattern'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Validation error')
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('deletes a rule, reloads and notifies', async () => {
    const onChanged = vi.fn()
    rulesMock.mockResolvedValueOnce([RULE]).mockResolvedValueOnce([])
    deleteMock.mockResolvedValue({ id: 'r1' })
    render(<TimeMappingRules projects={PROJECTS} onChanged={onChanged} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Delete rule Android Studio' }))

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('r1'))
    expect(await screen.findByText('No rules yet.')).toBeInTheDocument()
    expect(onChanged).toHaveBeenCalled()
  })

  it('shows an error when the rules fail to load or delete fails', async () => {
    rulesMock.mockRejectedValueOnce(new Error('Failed to reach the server'))
    render(<TimeMappingRules projects={PROJECTS} onChanged={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to reach the server')
  })

  it('surfaces a delete failure', async () => {
    rulesMock.mockResolvedValue([RULE])
    deleteMock.mockRejectedValue(new Error('Rule not found'))
    render(<TimeMappingRules projects={PROJECTS} onChanged={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete rule Android Studio' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Rule not found')
  })
})
