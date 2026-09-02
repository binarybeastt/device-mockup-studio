import { useRef, useState } from 'react'
import { timelineTimeAtPointer } from './timelineMath'
import type { TrackTarget } from './types'

export function TrackRow({
  target,
  label,
  keys,
  animated,
  active,
  selectedTime,
  duration,
  fps,
  pct,
  onScrub,
  onSelect,
  onMove,
}: {
  target: TrackTarget
  label: string
  keys: number[]
  animated: boolean
  active: boolean
  selectedTime: number | null
  duration: number
  fps: number
  pct: (t: number) => string
  onScrub: (target: TrackTarget, clientX: number, laneLeft: number, laneWidth: number) => void
  onSelect: (target: TrackTarget, time: number) => void
  onMove: (target: TrackTarget, from: number, to: number) => void
}) {
  const drag = useRef<{
    pointerId: number
    sourceTime: number
    originX: number
    laneLeft: number
    laneWidth: number
    active: boolean
  } | null>(null)
  const suppressClick = useRef(false)
  const [dragPreview, setDragPreview] = useState<{ sourceTime: number; time: number } | null>(null)

  function finishDrag() {
    drag.current = null
    setDragPreview(null)
  }

  return (
    <div className={active ? 'track-row active' : 'track-row'}>
      <span className="track-label">{label}</span>
      <div
        className={animated ? 'track-lane animated' : 'track-lane'}
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          onScrub(target, event.clientX, rect.left, rect.width)
        }}
      >
        {animated &&
          keys.map((time) => {
            const selected = selectedTime !== null && Math.abs(selectedTime - time) < 1e-6
            const previewTime = dragPreview?.sourceTime === time ? dragPreview.time : time
            return (
              <button
                key={time}
                className={
                  dragPreview?.sourceTime === time
                    ? 'keyframe selected dragging'
                    : selected
                      ? 'keyframe selected'
                      : 'keyframe'
                }
                style={{ left: pct(previewTime) }}
                title={`${label} keyframe at ${time.toFixed(2)} seconds · drag or press Option/Alt + Arrow to retime`}
                aria-label={`${label} keyframe at ${time.toFixed(2)} seconds`}
                aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                aria-pressed={selected}
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  event.stopPropagation()
                  const rect = event.currentTarget.parentElement?.getBoundingClientRect()
                  if (!rect) return
                  onSelect(target, time)
                  event.currentTarget.setPointerCapture(event.pointerId)
                  drag.current = {
                    pointerId: event.pointerId,
                    sourceTime: time,
                    originX: event.clientX,
                    laneLeft: rect.left,
                    laneWidth: rect.width,
                    active: false,
                  }
                }}
                onPointerMove={(event) => {
                  const state = drag.current
                  if (!state || state.pointerId !== event.pointerId) return
                  if (!state.active && Math.abs(event.clientX - state.originX) < 3) return
                  state.active = true
                  const preview = timelineTimeAtPointer(
                    event.clientX,
                    state.laneLeft,
                    state.laneWidth,
                    duration,
                    fps,
                  )
                  setDragPreview({ sourceTime: state.sourceTime, time: preview })
                }}
                onPointerUp={(event) => {
                  const state = drag.current
                  if (!state || state.pointerId !== event.pointerId) return
                  if (state.active) {
                    const destination = timelineTimeAtPointer(
                      event.clientX,
                      state.laneLeft,
                      state.laneWidth,
                      duration,
                      fps,
                    )
                    suppressClick.current = true
                    window.setTimeout(() => {
                      suppressClick.current = false
                    }, 0)
                    onMove(target, state.sourceTime, destination)
                  }
                  finishDrag()
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId)
                  }
                }}
                onPointerCancel={(event) => {
                  const state = drag.current
                  if (!state || state.pointerId !== event.pointerId) return
                  suppressClick.current = false
                  finishDrag()
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId)
                  }
                }}
                onClick={() => {
                  if (suppressClick.current) {
                    suppressClick.current = false
                    return
                  }
                  onSelect(target, time)
                }}
                onKeyDown={(event) => {
                  const state = drag.current
                  if (event.key !== 'Escape' || !state) return
                  event.preventDefault()
                  suppressClick.current = false
                  finishDrag()
                  if (event.currentTarget.hasPointerCapture(state.pointerId)) {
                    event.currentTarget.releasePointerCapture(state.pointerId)
                  }
                  onSelect(target, state.sourceTime)
                }}
              />
            )
          })}
      </div>
    </div>
  )
}
