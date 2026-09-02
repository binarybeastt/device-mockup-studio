import { describe, expect, it, vi } from 'vitest'
import { reservesSpaceForNativeActivation } from './useShortcuts'

function targetInside(match: boolean): EventTarget {
  return { closest: vi.fn(() => (match ? {} : null)) } as unknown as EventTarget
}

describe('global Space shortcut ownership', () => {
  it('leaves Space to focused native or ARIA controls', () => {
    expect(reservesSpaceForNativeActivation(targetInside(true))).toBe(true)
  })

  it('keeps the playback shortcut on non-interactive surfaces', () => {
    expect(reservesSpaceForNativeActivation(targetInside(false))).toBe(false)
    expect(reservesSpaceForNativeActivation(null)).toBe(false)
  })
})
