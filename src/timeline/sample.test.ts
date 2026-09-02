import { describe, expect, it } from 'vitest'
import { isAnimated, sampleTimeline, sampleTrack, tracksEnd } from './sample'
import {
  aggregateEasingAt,
  easingFor,
  EASE_LINEAR,
  EASE_OUT,
  EASE_OVERSHOOT,
  EASE_SMOOTH,
  normalizeEaseHandle,
} from './easing'
import { deviceTracksForMotion } from './presets'
import {
  keyTimes,
  moveTrackValuesAt,
  removeTrackValuesAt,
  setKey,
  setTrackValuesAt,
  setTrackEasingAt,
  setValueAt,
  staticTrack,
} from './tracks'
import { createDefaultProject } from '../store/defaults'
import type { Track } from '../store/schema'

const linear = (keys: [number, number][]): Track => ({
  keys: keys.map(([t, v]) => ({ t, v, ease: EASE_LINEAR })),
})

describe('sampleTrack', () => {
  it('falls back when the channel has never been touched', () => {
    expect(sampleTrack(undefined, 0, 7)).toBe(7)
    expect(sampleTrack({ keys: [] }, 3, 7)).toBe(7)
  })

  it('treats a single key as a static value at every time', () => {
    const track = staticTrack(5)
    expect(sampleTrack(track, -10, 0)).toBe(5)
    expect(sampleTrack(track, 0, 0)).toBe(5)
    expect(sampleTrack(track, 999, 0)).toBe(5)
  })

  it('holds the boundary values outside the key range', () => {
    const track = linear([[1, 10], [3, 30]])
    expect(sampleTrack(track, 0, 0)).toBe(10)
    expect(sampleTrack(track, 1, 0)).toBe(10)
    expect(sampleTrack(track, 3, 0)).toBe(30)
    expect(sampleTrack(track, 99, 0)).toBe(30)
  })

  it('interpolates linearly between a pair', () => {
    const track = linear([[0, 0], [2, 100]])
    expect(sampleTrack(track, 0.5, 0)).toBeCloseTo(25, 5)
    expect(sampleTrack(track, 1, 0)).toBeCloseTo(50, 5)
    expect(sampleTrack(track, 1.5, 0)).toBeCloseTo(75, 5)
  })

  it('picks the right segment with many keys', () => {
    const track = linear([[0, 0], [1, 10], [2, 20], [3, 30], [4, 40], [5, 50]])
    for (const t of [0.5, 1.5, 2.5, 3.5, 4.5]) {
      expect(sampleTrack(track, t, 0)).toBeCloseTo(t * 10, 5)
    }
  })

  it('applies the outgoing key easing to its own segment', () => {
    // EASE_SMOOTH is not symmetric, so an eased midpoint must differ from
    // the linear one — this is what catches "easing silently ignored".
    const eased: Track = {
      keys: [
        { t: 0, v: 0, ease: EASE_SMOOTH },
        { t: 1, v: 100, ease: EASE_LINEAR },
      ],
    }
    const mid = sampleTrack(eased, 0.5, 0)
    expect(mid).not.toBeCloseTo(50, 1)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(100)
    // Endpoints must still land exactly, whatever the curve.
    expect(sampleTrack(eased, 0, 0)).toBe(0)
    expect(sampleTrack(eased, 1, 0)).toBe(100)
  })

  it('supports a bounded overshoot curve without changing the track model', () => {
    expect(easingFor(EASE_OVERSHOOT)(0.7)).toBeGreaterThan(1)
    expect(easingFor(EASE_OVERSHOOT)(1)).toBe(1)
    expect(normalizeEaseHandle([2, 9, -1, Number.NaN])).toEqual([1, 2, 0, 1])
  })

  it('is monotonic across a monotonic track', () => {
    const track: Track = {
      keys: [
        { t: 0, v: 0, ease: EASE_SMOOTH },
        { t: 2, v: 50, ease: EASE_SMOOTH },
        { t: 4, v: 100, ease: EASE_SMOOTH },
      ],
    }
    let prev = -Infinity
    for (let t = 0; t <= 4; t += 0.05) {
      const v = sampleTrack(track, t, 0)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = v
    }
  })

  it('lets the later of two coincident keys win', () => {
    const track = linear([[0, 0], [1, 10], [1, 99], [2, 20]])
    expect(sampleTrack(track, 1, 0)).toBe(99)
  })
})

describe('sampleTimeline', () => {
  it('is pure — same t always yields the same state', () => {
    const project = createDefaultProject()
    const a = sampleTimeline(project, 1.234)
    const b = sampleTimeline(project, 1.234)
    expect(a).toEqual(b)
  })

  it('resolves the default project to its camera preset pose', () => {
    const project = createDefaultProject()
    const state = sampleTimeline(project, 0)
    expect(state.camera.position).toEqual([-2.2, 0.9, 2.4])
    expect(state.camera.target).toEqual([0, 0, 0])
    expect(state.devices[0].position).toEqual([0, 0, 0])
    expect(state.devices[0].scale).toBe(1)
  })

  it('holds a static project steady across the whole duration', () => {
    const project = createDefaultProject()
    const at0 = sampleTimeline(project, 0)
    const atEnd = sampleTimeline(project, project.duration)
    expect(at0).toEqual(atEnd)
  })
})

describe('motion presets', () => {
  it('spin-y-360 travels a full turn, not zero', () => {
    // The regression this guards: routing rotation through a quaternion
    // makes 0 -> 2pi slerp the short way and produce no motion at all.
    const tracks = deviceTracksForMotion('spin-y-360', 4)
    expect(sampleTrack(tracks['rotation.y'], 0, 0)).toBeCloseTo(0, 6)
    expect(sampleTrack(tracks['rotation.y'], 2, 0)).toBeCloseTo(Math.PI, 4)
    expect(sampleTrack(tracks['rotation.y'], 4, 0)).toBeCloseTo(Math.PI * 2, 6)
  })

  it('float returns to its start so it loops seamlessly', () => {
    const tracks = deviceTracksForMotion('float', 3)
    const start = sampleTrack(tracks['position.y'], 0, 0)
    const end = sampleTrack(tracks['position.y'], 3, 0)
    expect(start).toBeCloseTo(end, 6)
    expect(sampleTrack(tracks['position.y'], 1.5, 0)).toBeGreaterThan(start)
  })

  it('none leaves every channel at rest', () => {
    const tracks = deviceTracksForMotion('none', 4)
    expect(isAnimated(tracks)).toBe(false)
  })

  it('reports animation only when a channel has more than one key', () => {
    expect(isAnimated(deviceTracksForMotion('tilt-in', 4))).toBe(true)
    expect(tracksEnd(deviceTracksForMotion('slide-in-left', 4))).toBeCloseTo(2.2, 6)
  })
})

describe('track editing', () => {
  it('keeps keys sorted no matter the insertion order', () => {
    let track = staticTrack(0)
    track = setKey(track, 3, 30)
    track = setKey(track, 1, 10)
    track = setKey(track, 2, 20)
    expect(track.keys.map((k) => k.t)).toEqual([0, 1, 2, 3])
  })

  it('replaces rather than duplicates a key at the same time', () => {
    let track = staticTrack(0)
    track = setKey(track, 1, 10)
    track = setKey(track, 1, 99)
    expect(track.keys).toHaveLength(2)
    expect(sampleTrack(track, 1, 0)).toBe(99)
  })

  it('preserves easing when only the value changes', () => {
    let track = setKey(staticTrack(0), 1, 10, EASE_LINEAR)
    track = setKey(track, 1, 20)
    expect(track.keys[1].ease).toEqual(EASE_LINEAR)
  })

  it('retimes only keys that exist at the aggregate source time', () => {
    const tracks = {
      x: {
        keys: [
          { t: 0, v: 0, ease: EASE_SMOOTH },
          { t: 1, v: 10, ease: EASE_LINEAR },
          { t: 2, v: 20, ease: EASE_SMOOTH },
        ],
      },
      y: { keys: [{ t: 2, v: 8, ease: EASE_SMOOTH }] },
      z: {
        keys: [
          { t: 1, v: 3, ease: EASE_SMOOTH },
          { t: 3, v: 9, ease: EASE_LINEAR },
        ],
      },
    }

    const moved = moveTrackValuesAt(tracks, 1, 2)

    expect(moved.x.keys).toEqual([
      { t: 0, v: 0, ease: EASE_SMOOTH },
      { t: 2, v: 10, ease: EASE_LINEAR },
    ])
    expect(moved.y).toBe(tracks.y)
    expect(moved.z.keys).toEqual([
      { t: 2, v: 3, ease: EASE_SMOOTH },
      { t: 3, v: 9, ease: EASE_LINEAR },
    ])
  })

  it('summarises and updates aggregate outgoing easing without touching end keys', () => {
    const tracks = {
      x: { keys: [
        { t: 0, v: 0, ease: EASE_LINEAR },
        { t: 2, v: 2, ease: EASE_SMOOTH },
      ] },
      y: { keys: [
        { t: 0, v: 1, ease: EASE_SMOOTH },
        { t: 1, v: 3, ease: EASE_LINEAR },
      ] },
      z: { keys: [{ t: 0, v: 4, ease: EASE_LINEAR }] },
    }

    expect(aggregateEasingAt(tracks, 0)).toEqual({ kind: 'mixed' })
    const eased = setTrackEasingAt(tracks, 0, EASE_OUT)
    expect(aggregateEasingAt(eased, 0)).toEqual({ kind: 'named', name: 'ease-out', ease: EASE_OUT })
    expect(eased.x.keys[0].ease).toEqual(EASE_OUT)
    expect(eased.y.keys[0].ease).toEqual(EASE_OUT)
    expect(eased.z).toBe(tracks.z)
    expect(setTrackEasingAt(eased, 2, EASE_LINEAR)).toBe(eased)

    const custom = setTrackEasingAt(eased, 0, [0.2, -0.4, 0.8, 1.4])
    expect(aggregateEasingAt(custom, 0)).toEqual({
      kind: 'custom',
      ease: [0.2, -0.4, 0.8, 1.4],
    })
  })

  it('editing a static channel does not accidentally create animation', () => {
    const track = setValueAt(staticTrack(5), 2.5, 9)
    expect(track.keys).toHaveLength(1)
    expect(sampleTrack(track, 0, 0)).toBe(9)
  })

  it('adds a key when the channel is already animated', () => {
    const animated = linear([[0, 0], [4, 40]])
    const track = setValueAt(animated, 2, 99)
    expect(track.keys).toHaveLength(3)
    expect(sampleTrack(track, 2, 0)).toBe(99)
  })

  it('collapses key times across channels into one column per time', () => {
    expect(keyTimes(deviceTracksForMotion('tilt-in', 4))).toEqual([0, 2.8])
  })

  it('writes a complete aggregate key without requiring a preset', () => {
    const tracks = {
      'position.x': staticTrack(0),
      'position.y': staticTrack(1),
    }
    const keyed = setTrackValuesAt(tracks, 2, { 'position.x': 4, 'position.y': 5 })

    expect(keyed['position.x'].keys.map((key) => [key.t, key.v])).toEqual([[0, 0], [2, 4]])
    expect(keyed['position.y'].keys.map((key) => [key.t, key.v])).toEqual([[0, 1], [2, 5]])
  })

  it('deletes an aggregate key but preserves every channel\'s final value key', () => {
    const tracks = {
      'position.x': setKey(staticTrack(0), 2, 4),
      'position.y': staticTrack(1),
    }
    const withoutEnd = removeTrackValuesAt(tracks, 2)

    expect(withoutEnd['position.x'].keys).toHaveLength(1)
    expect(withoutEnd['position.y']).toBe(tracks['position.y'])
    expect(removeTrackValuesAt(withoutEnd, 0)).toBe(withoutEnd)
  })
})
