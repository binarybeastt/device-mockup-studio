import { alignDurationToFrames } from '../../timeline/time'

/** Keep interactive timeline edits on exportable frame boundaries. */
export function snapTimeToFrame(time: number, fps: number, duration: number): number {
  const boundary = alignDurationToFrames(duration, fps)
  const clamped = Math.min(boundary, Math.max(0, time))
  return Math.min(boundary, Math.round(clamped * fps) / fps)
}

/**
 * Convert a pointer coordinate within the visible lane — not the label plus
 * lane row — into a deterministic timeline time.
 */
export function timelineTimeAtPointer(
  clientX: number,
  laneLeft: number,
  laneWidth: number,
  duration: number,
  fps: number,
): number {
  if (laneWidth <= 0) return 0
  const ratio = Math.min(1, Math.max(0, (clientX - laneLeft) / laneWidth))
  return snapTimeToFrame(ratio * duration, fps, duration)
}

/** Display timeline positions as minutes:seconds:frames without sub-frame drift. */
export function formatTimecode(time: number, fps: number): string {
  const totalFrames = Math.max(0, Math.round(time * fps))
  const frames = totalFrames % fps
  const totalSeconds = Math.floor(totalFrames / fps)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60)
  return [minutes, seconds, frames].map((part) => String(part).padStart(2, '0')).join(':')
}

/** Accept either seconds or the compact minutes:seconds:frames shown by the UI. */
export function parseTimelineTime(
  value: string,
  fps: number,
  duration: number,
): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  if (!trimmed.includes(':')) {
    const seconds = Number(trimmed)
    return Number.isFinite(seconds) ? snapTimeToFrame(seconds, fps, duration) : null
  }

  const parts = trimmed.split(':').map(Number)
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) return null
  const [minutes, seconds, frames] = parts
  if (seconds >= 60 || frames >= fps) return null
  return snapTimeToFrame(minutes * 60 + seconds + frames / fps, fps, duration)
}

/** Find the nearest key strictly before or after a time, tolerating float noise. */
export function adjacentKeyTime(
  keys: number[],
  time: number,
  direction: -1 | 1,
): number | null {
  const epsilon = 1e-6
  if (direction < 0) {
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      if (keys[index] < time - epsilon) return keys[index]
    }
    return null
  }
  return keys.find((key) => key > time + epsilon) ?? null
}
