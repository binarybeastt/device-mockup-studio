import { describe, expect, it } from 'vitest'
import {
  editableKeyTimes,
  hasEditableKeyAtTime,
  hasKeyAtTime,
  moveTrackValuesAt,
  removeTrackValuesAt,
  staticTrack,
} from './tracks'

describe('aggregate keyframe identity', () => {
  it('tracks the destination after a retime and no longer reports the source', () => {
    const tracks = {
      'position.x': { keys: [{ ...staticTrack(1).keys[0], t: 0.5 }] },
      'position.y': staticTrack(2),
    }

    const moved = moveTrackValuesAt(tracks, 0.5, 1)
    expect(hasKeyAtTime(moved, 0.5)).toBe(false)
    expect(hasKeyAtTime(moved, 1)).toBe(true)
    expect(hasKeyAtTime(tracks, 0.5)).toBe(true)
  })

  it('does not expose protected static storage as a deletable diamond', () => {
    const tracks = {
      'position.x': {
        keys: [
          { ...staticTrack(0).keys[0], t: 0 },
          { ...staticTrack(1).keys[0], t: 1 },
          { ...staticTrack(2).keys[0], t: 2 },
        ],
      },
      'position.y': staticTrack(2),
    }

    const deleted = removeTrackValuesAt(tracks, 0)

    expect(hasKeyAtTime(deleted, 0)).toBe(true)
    expect(hasEditableKeyAtTime(deleted, 0)).toBe(false)
    expect(editableKeyTimes(deleted)).toEqual([1, 2])
  })
})
