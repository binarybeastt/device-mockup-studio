/** The export and editor must agree on how many frames a duration contains. */
export function frameCountForDuration(duration: number, fps: number): number {
  return Math.max(1, Math.round(Math.max(0, duration) * fps))
}

/**
 * Quantise an exclusive duration boundary while keeping every existing key
 * inside it. The boundary itself may carry a loop/end pose; exported samples
 * remain the frame indices 0...(count - 1).
 */
export function alignDurationToFrames(duration: number, fps: number, contentEnd = 0): number {
  const requestedFrames = frameCountForDuration(duration, fps)
  const contentFrames = Math.max(0, Math.ceil(contentEnd * fps - 1e-9))
  return Math.max(1, requestedFrames, contentFrames) / fps
}
