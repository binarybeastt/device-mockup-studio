import { describe, expect, it, beforeEach } from 'vitest'
import { emptyHistory, record, redo, resetCoalescing, undo } from './history'
import { migrate } from './persist'
import { createDefaultProject } from './defaults'
import type { Project } from './schema'

const withName = (p: Project, name: string): Project => ({ ...p, name })

describe('history', () => {
  beforeEach(() => resetCoalescing())

  it('undoes and redoes a single edit', () => {
    const a = createDefaultProject()
    const b = withName(a, 'second')
    const h = record(emptyHistory, a, 'name-1')

    const undone = undo(h, b)!
    expect(undone.project.name).toBe(a.name)

    const redone = redo(undone.history, undone.project)!
    expect(redone.project.name).toBe('second')
  })

  it('returns null at the ends rather than throwing', () => {
    const p = createDefaultProject()
    expect(undo(emptyHistory, p)).toBeNull()
    expect(redo(emptyHistory, p)).toBeNull()
  })

  it('walks back through several distinct edits in order', () => {
    const v0 = createDefaultProject()
    const v1 = withName(v0, 'one')
    const v2 = withName(v0, 'two')

    let h = record(emptyHistory, v0, 'a')
    resetCoalescing()
    h = record(h, v1, 'b')

    const first = undo(h, v2)!
    expect(first.project.name).toBe('one')
    const second = undo(first.history, first.project)!
    expect(second.project.name).toBe(v0.name)
  })

  it('coalesces a continuous gesture into one entry', () => {
    // A field drag fires many updates under one label; undo should land
    // before the whole gesture, not somewhere inside it.
    const v0 = createDefaultProject()
    let h = record(emptyHistory, v0, 'drag')
    for (let i = 0; i < 20; i++) h = record(h, withName(v0, `step-${i}`), 'drag')
    expect(h.past).toHaveLength(1)

    const undone = undo(h, withName(v0, 'final'))!
    expect(undone.project.name).toBe(v0.name)
  })

  it('does not coalesce across different labels', () => {
    const v0 = createDefaultProject()
    let h = record(emptyHistory, v0, 'rotate')
    h = record(h, withName(v0, 'x'), 'background')
    expect(h.past).toHaveLength(2)
  })

  it('a new edit clears the redo stack', () => {
    const v0 = createDefaultProject()
    const h = record(emptyHistory, v0, 'a')
    const undone = undo(h, withName(v0, 'one'))!
    expect(undone.history.future).toHaveLength(1)

    resetCoalescing()
    const afterNewEdit = record(undone.history, undone.project, 'b')
    expect(afterNewEdit.future).toHaveLength(0)
  })

  it('caps the stack so long sessions do not grow without bound', () => {
    let h = emptyHistory
    for (let i = 0; i < 250; i++) {
      resetCoalescing()
      h = record(h, withName(createDefaultProject(), `v${i}`), `edit-${i}`)
    }
    expect(h.past.length).toBeLessThanOrEqual(100)
    // The most recent entries are the ones kept.
    expect(h.past[h.past.length - 1].name).toBe('v249')
  })
})

describe('migrate', () => {
  it('fills in fields missing from an older document', () => {
    const migrated = migrate({ version: 1, name: 'Old', devices: [{ id: 'iphone-17-pro' }] })
    expect(migrated.name).toBe('Old')
    expect(migrated.devices[0].id).toBe('iphone-17-pro')
    // Everything the old file predates comes from defaults rather than undefined.
    expect(migrated.devices[0].orientation).toBe('portrait')
    expect(migrated.devices[0].transform).toBeDefined()
    expect(migrated.camera.tracks).toBeDefined()
    expect(migrated.duration).toBeGreaterThan(0)
  })

  it('falls back to a default project for junk input', () => {
    expect(migrate(null).version).toBe(1)
    expect(migrate('nonsense').version).toBe(1)
    expect(migrate(42).name).toBe('Untitled')
  })

  it('preserves keyframes through a round trip of the document', () => {
    const project = createDefaultProject()
    const restored = migrate(JSON.parse(JSON.stringify(project)))
    expect(restored.camera.tracks['position.x'].keys).toEqual(
      project.camera.tracks['position.x'].keys,
    )
  })

  it('aligns fractional durations without cutting off existing keys', () => {
    const project = createDefaultProject()
    project.fps = 30
    project.duration = 1.05
    project.camera.tracks['position.x'].keys = [
      { t: 0, v: 0, ease: [0, 0, 1, 1] },
      { t: 1.1, v: 1, ease: [0, 0, 1, 1] },
    ]

    const migrated = migrate(project)
    expect(migrated.duration * migrated.fps).toBeCloseTo(33)
    expect(migrated.duration).toBeGreaterThanOrEqual(1.1)
    expect(migrated.camera.tracks['position.x'].keys.at(-1)?.t).toBe(1.1)
  })
})
