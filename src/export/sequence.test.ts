import { describe, expect, it } from 'vitest'
import { frameFileName, frameTimes } from './sequence'
import { alignDurationToFrames } from '../timeline/time'

describe('frameTimes', () => {
  it('derives every time from the frame index alone', () => {
    // The point of the export loop: t is i/fps and nothing else, so the same
    // project exports identically whatever the machine is doing (§14 trap 5).
    const times = frameTimes(2, 30)
    expect(times).toHaveLength(60)
    expect(times[0]).toBe(0)
    expect(times[1]).toBeCloseTo(1 / 30)
    expect(times.at(-1)).toBeCloseTo(59 / 30)
  })

  it('stops one frame short of the duration', () => {
    // Including t = duration would render the loop point twice — visible as
    // a stutter every time a looping clip wraps.
    const times = frameTimes(2, 30)
    expect(times.at(-1)).toBeLessThan(2)
    expect(times).not.toContain(2)
  })

  it('follows the frame rate', () => {
    expect(frameTimes(1, 60)).toHaveLength(60)
    expect(frameTimes(1, 30)).toHaveLength(30)
  })

  it('rounds a duration that is not a whole number of frames', () => {
    expect(frameTimes(1.5, 30)).toHaveLength(45)
    expect(frameTimes(0.51, 30)).toHaveLength(15)
  })

  it('agrees with a frame-aligned exclusive duration boundary', () => {
    const duration = alignDurationToFrames(1.05, 30)
    expect(duration).toBeCloseTo(32 / 30)
    expect(frameTimes(duration, 30)).toHaveLength(32)
    expect(frameTimes(duration, 30).at(-1)).toBeCloseTo(31 / 30)
  })

  it('always renders at least one frame', () => {
    // A zero-length clip should produce a still, not an empty archive the
    // user has to open to discover is empty.
    expect(frameTimes(0, 30)).toEqual([0])
  })
})

describe('frameFileName', () => {
  it('zero-pads so a plain sort matches frame order', () => {
    expect(frameFileName(0)).toBe('frame_0000.png')
    expect(frameFileName(9)).toBe('frame_0009.png')
    expect(frameFileName(123)).toBe('frame_0123.png')
  })

  it('sorts lexicographically in frame order past ten', () => {
    // Unpadded names put frame_10 before frame_2, and ffmpeg's %04d pattern
    // silently reads the wrong files.
    const names = [0, 2, 10, 100].map(frameFileName)
    expect([...names].sort()).toEqual(names)
  })
})
