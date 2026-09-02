import { describe, expect, it } from 'vitest'
import {
  adjacentKeyTime,
  formatTimecode,
  parseTimelineTime,
  snapTimeToFrame,
  timelineTimeAtPointer,
} from './timelineMath'

describe('timeline pointer geometry', () => {
  it('maps the visible lane rather than the row including its label', () => {
    const laneLeft = 174
    const laneWidth = 826

    expect(timelineTimeAtPointer(laneLeft, laneLeft, laneWidth, 4, 30)).toBe(0)
    expect(timelineTimeAtPointer(laneLeft + laneWidth / 2, laneLeft, laneWidth, 4, 30)).toBe(2)
    expect(timelineTimeAtPointer(laneLeft + laneWidth, laneLeft, laneWidth, 4, 30)).toBe(4)
  })

  it('clamps outside clicks and snaps edits to exportable frames', () => {
    expect(timelineTimeAtPointer(50, 100, 600, 4, 30)).toBe(0)
    expect(timelineTimeAtPointer(800, 100, 600, 4, 30)).toBe(4)
    expect(snapTimeToFrame(1.019, 30, 4)).toBeCloseTo(1.033333, 6)
  })

  it('treats a fractional clip duration as a frame-aligned end boundary', () => {
    expect(snapTimeToFrame(1.05, 30, 1.05)).toBeCloseTo(32 / 30)
    expect(snapTimeToFrame(1.01, 60, 1.01)).toBeCloseTo(61 / 60)
  })
})

describe('timeline navigation', () => {
  it('formats frame-accurate timecode', () => {
    expect(formatTimecode(0, 30)).toBe('00:00:00')
    expect(formatTimecode(61 + 12 / 30, 30)).toBe('01:01:12')
    expect(formatTimecode(1.999, 60)).toBe('00:02:00')
  })

  it('parses timecode or seconds and rejects invalid frame fields', () => {
    expect(parseTimelineTime('01:01:12', 30, 90)).toBeCloseTo(61.4)
    expect(parseTimelineTime('1.019', 30, 4)).toBeCloseTo(31 / 30)
    expect(parseTimelineTime('00:60:00', 30, 90)).toBeNull()
    expect(parseTimelineTime('00:01:30', 30, 90)).toBeNull()
    expect(parseTimelineTime('not a time', 30, 90)).toBeNull()
  })

  it('finds strictly adjacent keys around the playhead', () => {
    const keys = [0, 1, 2.5, 4]
    expect(adjacentKeyTime(keys, 2, -1)).toBe(1)
    expect(adjacentKeyTime(keys, 2, 1)).toBe(2.5)
    expect(adjacentKeyTime(keys, 1, -1)).toBe(0)
    expect(adjacentKeyTime(keys, 1, 1)).toBe(2.5)
    expect(adjacentKeyTime(keys, 0, -1)).toBeNull()
    expect(adjacentKeyTime(keys, 4, 1)).toBeNull()
  })
})
