import { describe, expect, it } from 'vitest'
import { EASE_LINEAR } from '../../timeline/easing'
import type { TrackSet } from '../../store/schema'
import {
  recordedRetimeSelectionTime,
  retimedSelectionTime,
  type RetimeTransition,
} from './timelineSelection'

function tracks(...times: number[]): TrackSet {
  return {
    'position.x': {
      keys: times.map((t) => ({ t, v: t, ease: EASE_LINEAR })),
    },
  }
}

describe('retimed selection recovery', () => {
  it('follows a key through undo and redo', () => {
    expect(retimedSelectionTime(tracks(1, 2), tracks(1.5, 2), 1)).toBe(1.5)
    expect(retimedSelectionTime(tracks(1.5, 2), tracks(1, 2), 1.5)).toBe(1)
  })

  it('does not invent a selection after deletion or a broader replacement', () => {
    expect(retimedSelectionTime(tracks(1, 2), tracks(2), 1)).toBeNull()
    expect(retimedSelectionTime(tracks(1, 2), tracks(1.5, 2.5), 1)).toBeNull()
  })

  it('does nothing while the selected key still exists', () => {
    expect(retimedSelectionTime(tracks(1, 2), tracks(1, 2, 3), 1)).toBeNull()
  })

  it('follows a merged retime through undo and redo by project identity', () => {
    const original = { id: 'original' }
    const merged = { id: 'merged' }
    const transitions: RetimeTransition<typeof original>[] = [
      {
        before: original,
        after: merged,
        scope: 'device:one',
        from: 1,
        to: 2,
        restoreKeyFocus: true,
      },
    ]

    expect(recordedRetimeSelectionTime(transitions, merged, original, 'device:one', 2)).toEqual({
      time: 1,
      restoreKeyFocus: true,
    })
    expect(recordedRetimeSelectionTime(transitions, original, merged, 'device:one', 1)).toEqual({
      time: 2,
      restoreKeyFocus: true,
    })
  })

  it('does not apply a recorded retime to another scope or project transition', () => {
    const original = { id: 'original' }
    const merged = { id: 'merged' }
    const unrelated = { id: 'unrelated' }
    const transitions: RetimeTransition<typeof original>[] = [
      {
        before: original,
        after: merged,
        scope: 'camera',
        from: 1,
        to: 2,
        restoreKeyFocus: false,
      },
    ]

    expect(recordedRetimeSelectionTime(transitions, merged, original, 'device:one', 2)).toBeNull()
    expect(recordedRetimeSelectionTime(transitions, unrelated, original, 'camera', 2)).toBeNull()
  })
})
