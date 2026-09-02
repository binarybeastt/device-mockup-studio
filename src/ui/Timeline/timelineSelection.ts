import type { TrackSet } from '../../store/schema'
import { editableKeyTimes, hasEditableKeyAtTime } from '../../timeline/tracks'

const SAME_TIME_EPSILON = 1e-6

export type RetimeTransition<Document> = {
  before: Document
  after: Document
  scope: string
  from: number
  to: number
  restoreKeyFocus: boolean
}

export type RecordedRetimeSelection = {
  time: number
  restoreKeyFocus: boolean
}

function includesTime(times: number[], candidate: number): boolean {
  return times.some((time) => Math.abs(time - candidate) < SAME_TIME_EPSILON)
}

/**
 * Detect the one-for-one time replacement produced by a keyframe retime.
 * Deletions and broader document changes deliberately return null so the UI
 * never guesses which unrelated key should become selected.
 */
export function retimedSelectionTime(
  before: TrackSet,
  after: TrackSet,
  selectedTime: number,
): number | null {
  if (
    !hasEditableKeyAtTime(before, selectedTime) ||
    hasEditableKeyAtTime(after, selectedTime)
  ) return null

  const beforeTimes = editableKeyTimes(before)
  const addedTimes = editableKeyTimes(after).filter((time) => !includesTime(beforeTimes, time))
  return addedTimes.length === 1 ? addedTimes[0] : null
}

/**
 * Follow a UI selection across a retime whose destination replaced an
 * existing aggregate key. Project identity makes this exact: an unrelated
 * add/delete that happens to use the same times cannot be mistaken for it.
 */
export function recordedRetimeSelectionTime<Document>(
  transitions: RetimeTransition<Document>[],
  before: Document,
  after: Document,
  scope: string,
  selectedTime: number,
): RecordedRetimeSelection | null {
  for (let index = transitions.length - 1; index >= 0; index -= 1) {
    const transition = transitions[index]
    if (transition.scope !== scope) continue
    if (
      transition.before === before &&
      transition.after === after &&
      Math.abs(transition.from - selectedTime) < SAME_TIME_EPSILON
    ) {
      return { time: transition.to, restoreKeyFocus: transition.restoreKeyFocus }
    }
    if (
      transition.after === before &&
      transition.before === after &&
      Math.abs(transition.to - selectedTime) < SAME_TIME_EPSILON
    ) {
      return { time: transition.from, restoreKeyFocus: transition.restoreKeyFocus }
    }
  }
  return null
}
