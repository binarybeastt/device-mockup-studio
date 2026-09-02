import BezierEasing from 'bezier-easing'
import type { EaseHandle, TrackSet } from '../store/schema'

// CSS-compatible cubic-bezier control points. These are the four values a
// keyframe carries; anything the UI offers as a named curve is just a label
// on one of these.
export const EASE_LINEAR: EaseHandle = [0, 0, 1, 1]
export const EASE_IN: EaseHandle = [0.42, 0, 1, 1]
export const EASE_OUT: EaseHandle = [0, 0, 0.58, 1]
export const EASE_IN_OUT: EaseHandle = [0.42, 0, 0.58, 1]
export const EASE_SMOOTH: EaseHandle = [0.33, 0, 0.15, 1]
export const EASE_OVERSHOOT: EaseHandle = [0.34, 1.56, 0.64, 1]

export const NAMED_EASINGS = {
  linear: EASE_LINEAR,
  'ease-in': EASE_IN,
  'ease-out': EASE_OUT,
  'ease-in-out': EASE_IN_OUT,
  smooth: EASE_SMOOTH,
  overshoot: EASE_OVERSHOOT,
} as const

export type NamedEasing = keyof typeof NAMED_EASINGS

export type AggregateEasing =
  | { kind: 'none' }
  | { kind: 'mixed' }
  | { kind: 'named'; name: NamedEasing; ease: EaseHandle }
  | { kind: 'custom'; ease: EaseHandle }

export function easeHandlesEqual(a: EaseHandle, b: EaseHandle): boolean {
  return a.every((value, index) => Math.abs(value - b[index]) < 1e-6)
}

/** Keep persisted or hand-entered curves inside the engine's safe domain. */
export function normalizeEaseHandle(handle: EaseHandle): EaseHandle {
  const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback
  return [
    Math.min(1, Math.max(0, finite(handle[0], 0.33))),
    Math.min(2, Math.max(-2, finite(handle[1], 0))),
    Math.min(1, Math.max(0, finite(handle[2], 0.67))),
    Math.min(2, Math.max(-2, finite(handle[3], 1))),
  ]
}

export function namedEasingFor(handle: EaseHandle): NamedEasing | null {
  for (const [name, candidate] of Object.entries(NAMED_EASINGS)) {
    if (easeHandlesEqual(handle, candidate)) return name as NamedEasing
  }
  return null
}

/** Summarise the outgoing scalar segments represented by one aggregate diamond. */
export function aggregateEasingAt(tracks: TrackSet, time: number): AggregateEasing {
  const handles: EaseHandle[] = []
  for (const track of Object.values(tracks)) {
    const index = track.keys.findIndex((key) => Math.abs(key.t - time) < 1e-6)
    if (index >= 0 && index < track.keys.length - 1) handles.push(track.keys[index].ease)
  }
  if (handles.length === 0) return { kind: 'none' }
  if (!handles.every((handle) => easeHandlesEqual(handle, handles[0]))) return { kind: 'mixed' }
  const name = namedEasingFor(handles[0])
  return name ? { kind: 'named', name, ease: handles[0] } : { kind: 'custom', ease: handles[0] }
}

// Constructing a BezierEasing builds a sample table, so it is far too
// expensive to do per-frame — and sampleTimeline runs once per track per
// frame. Handles come from a small fixed set in practice, so cache on the
// control points themselves.
const cache = new Map<string, (x: number) => number>()

export function easingFor(handle: EaseHandle): (x: number) => number {
  const safe = normalizeEaseHandle(handle)
  const key = `${safe[0]},${safe[1]},${safe[2]},${safe[3]}`
  let fn = cache.get(key)
  if (!fn) {
    fn = BezierEasing(safe[0], safe[1], safe[2], safe[3])
    cache.set(key, fn)
  }
  return fn
}
