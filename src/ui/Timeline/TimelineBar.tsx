import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  Plus,
  SkipBack,
  SkipForward,
  Trash2,
} from 'lucide-react'
import { useProjectStore } from '../../store/project'
import { MOTION_PRESETS, type MotionPresetId } from '../../timeline/presets'
import { editableKeyTimes, hasEditableKeyAtTime } from '../../timeline/tracks'
import { isAnimated, tracksEnd } from '../../timeline/sample'
import {
  aggregateEasingAt,
  type NamedEasing,
} from '../../timeline/easing'
import type { EaseHandle, Project, TrackSet } from '../../store/schema'
import {
  adjacentKeyTime,
  formatTimecode,
  snapTimeToFrame,
  timelineTimeAtPointer,
} from './timelineMath'
import {
  recordedRetimeSelectionTime,
  retimedSelectionTime,
  type RetimeTransition,
} from './timelineSelection'
import { KeyframeEasingControl } from './KeyframeEasingControl'
import { TimecodeField } from './TimecodeField'
import { TrackRow } from './TrackRow'
import type { TrackTarget } from './types'

type KeySelection = { target: TrackTarget; time: number; deviceInstanceId?: string }

function tracksForSelection(
  project: Project,
  activeDevice: number,
  selection: KeySelection,
): TrackSet | null {
  if (selection.target === 'camera') return project.camera.tracks
  const device = project.devices[activeDevice]
  return device?.instanceId === selection.deviceInstanceId ? device.transform : null
}

function selectionExists(project: Project, activeDevice: number, selection: KeySelection): boolean {
  const tracks = tracksForSelection(project, activeDevice, selection)
  return tracks !== null && hasEditableKeyAtTime(tracks, selection.time)
}

function selectionScope(selection: KeySelection): string {
  return selection.target === 'camera'
    ? 'camera'
    : `device:${selection.deviceInstanceId ?? 'missing'}`
}

/**
 * Compact object-level timeline. Each diamond represents all scalar keys for
 * one Camera or Device at that instant; detailed per-channel rows and easing
 * handles can build on the same track data later.
 */
export function TimelineBar() {
  const project = useProjectStore((s) => s.project)
  const playhead = useProjectStore((s) => s.playhead)
  const playing = useProjectStore((s) => s.playing)
  const motionPreset = useProjectStore((s) => s.motionPreset)
  const setPlayhead = useProjectStore((s) => s.setPlayhead)
  const setPlaying = useProjectStore((s) => s.setPlaying)
  const setDuration = useProjectStore((s) => s.setDuration)
  const setMotionPreset = useProjectStore((s) => s.setMotionPreset)
  const addCameraKeyframe = useProjectStore((s) => s.addCameraKeyframe)
  const addDeviceKeyframe = useProjectStore((s) => s.addDeviceKeyframe)
  const deleteCameraKeyframe = useProjectStore((s) => s.deleteCameraKeyframe)
  const deleteDeviceKeyframe = useProjectStore((s) => s.deleteDeviceKeyframe)
  const moveCameraKeyframe = useProjectStore((s) => s.moveCameraKeyframe)
  const moveDeviceKeyframe = useProjectStore((s) => s.moveDeviceKeyframe)
  const setCameraKeyframeEasing = useProjectStore((s) => s.setCameraKeyframeEasing)
  const setDeviceKeyframeEasing = useProjectStore((s) => s.setDeviceKeyframeEasing)
  const setCameraKeyframeEase = useProjectStore((s) => s.setCameraKeyframeEase)
  const setDeviceKeyframeEase = useProjectStore((s) => s.setDeviceKeyframeEase)
  const [activeTrack, setActiveTrack] = useState<TrackTarget>('device')
  const [selection, setSelectionState] = useState<KeySelection | null>(null)
  const selectionRef = useRef<KeySelection | null>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const retimeTransitionsRef = useRef<RetimeTransition<Project>[]>([])

  const setSelection = useCallback((next: KeySelection | null) => {
    selectionRef.current = next
    setSelectionState(next)
  }, [])

  const duration = project.duration
  const pct = (t: number) => `${(t / duration) * 100}%`

  function scrubTo(target: TrackTarget, clientX: number, laneLeft: number, laneWidth: number) {
    const time = timelineTimeAtPointer(clientX, laneLeft, laneWidth, duration, project.fps)
    setPlaying(false)
    setActiveTrack(target)
    setSelection(null)
    setPlayhead(time)
    timelineRef.current?.focus({ preventScroll: true })
  }

  const cameraKeys = editableKeyTimes(project.camera.tracks)
  const active = useProjectStore((s) => s.activeDevice)
  const deviceTracks = project.devices[active]?.transform ?? {}
  const activeDeviceInstanceId = project.devices[active]?.instanceId
  const deviceKeys = editableKeyTimes(deviceTracks)
  const cameraAnimated = isAnimated(project.camera.tracks)
  const deviceAnimated = isAnimated(deviceTracks)
  const activeKeys = activeTrack === 'camera' ? cameraKeys : deviceKeys
  const previousKey = adjacentKeyTime(activeKeys, playhead, -1)
  const nextKey = adjacentKeyTime(activeKeys, playhead, 1)
  const currentSelection =
    selection && selectionExists(project, active, selection) ? selection : null
  const selectedTracks = currentSelection?.target === 'camera' ? project.camera.tracks : deviceTracks
  const selectedEasing = currentSelection
    ? aggregateEasingAt(selectedTracks, currentSelection.time)
    : null

  function selectKeyframe(target: TrackTarget, time: number) {
    setPlaying(false)
    setActiveTrack(target)
    setSelection({
      target,
      time,
      deviceInstanceId: target === 'device' ? activeDeviceInstanceId : undefined,
    })
    // A key click is an exact jump, not a frame-rounded approximation.
    setPlayhead(time)
  }

  function addKeyframe() {
    const time = snapTimeToFrame(playhead, project.fps, duration)
    if (activeTrack === 'camera') addCameraKeyframe(time)
    else addDeviceKeyframe(time)
    setPlaying(false)
    setPlayhead(time)
    setSelection({
      target: activeTrack,
      time,
      deviceInstanceId: activeTrack === 'device' ? activeDeviceInstanceId : undefined,
    })
  }

  const moveKeyframe = useCallback(
    (target: TrackTarget, from: number, to: number) => {
      const time = snapTimeToFrame(to, project.fps, duration)
      if (Math.abs(from - time) < 1e-6) return
      setPlaying(false)
      const restoreKeyFocus = document.activeElement?.classList.contains('keyframe') === true
      const before = useProjectStore.getState().project
      if (target === 'camera') moveCameraKeyframe(from, time)
      else moveDeviceKeyframe(from, time)
      const after = useProjectStore.getState().project
      if (after !== before) {
        retimeTransitionsRef.current = [
          ...retimeTransitionsRef.current,
          {
            before,
            after,
            scope:
              target === 'camera'
                ? 'camera'
                : `device:${activeDeviceInstanceId ?? 'missing'}`,
            from,
            to: time,
            restoreKeyFocus,
          },
        ].slice(-100)
      }
      setPlayhead(time)
      setActiveTrack(target)
      setSelection({
        target,
        time,
        deviceInstanceId: target === 'device' ? activeDeviceInstanceId : undefined,
      })
      requestAnimationFrame(() => {
        timelineRef.current?.querySelector<HTMLButtonElement>('.keyframe.selected')?.focus()
      })
    },
    [
      activeDeviceInstanceId,
      duration,
      moveCameraKeyframe,
      moveDeviceKeyframe,
      project.fps,
      setPlayhead,
      setPlaying,
      setSelection,
    ],
  )

  function setSelectedEasing(easing: NamedEasing) {
    if (!currentSelection) return
    setPlaying(false)
    if (currentSelection.target === 'camera') {
      setCameraKeyframeEasing(currentSelection.time, easing)
    } else {
      setDeviceKeyframeEasing(currentSelection.time, easing)
    }
  }

  function setSelectedCustomEase(ease: EaseHandle) {
    if (!currentSelection) return
    setPlaying(false)
    if (currentSelection.target === 'camera') {
      setCameraKeyframeEase(currentSelection.time, ease)
    } else {
      setDeviceKeyframeEase(currentSelection.time, ease)
    }
  }

  const deleteSelected = useCallback(() => {
    if (!currentSelection) return
    if (currentSelection.target === 'camera') deleteCameraKeyframe(currentSelection.time)
    else deleteDeviceKeyframe(currentSelection.time)
    setSelection(null)
  }, [currentSelection, deleteCameraKeyframe, deleteDeviceKeyframe, setSelection])

  const seekTo = useCallback(
    (time: number) => {
      setPlaying(false)
      setSelection(null)
      setPlayhead(snapTimeToFrame(time, project.fps, duration))
    },
    [duration, project.fps, setPlayhead, setPlaying, setSelection],
  )

  const stepFrames = useCallback(
    (frames: number) => seekTo(playhead + frames / project.fps),
    [playhead, project.fps, seekTo],
  )

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (!timelineRef.current?.contains(document.activeElement)) return
      if ((event.key === 'Delete' || event.key === 'Backspace') && currentSelection) {
        event.preventDefault()
        deleteSelected()
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const direction = event.key === 'ArrowLeft' ? -1 : 1
        if (event.altKey && currentSelection && target?.closest('.keyframe')) {
          moveKeyframe(
            currentSelection.target,
            currentSelection.time,
            currentSelection.time + (direction * (event.shiftKey ? 10 : 1)) / project.fps,
          )
          return
        }
        stepFrames(direction * (event.shiftKey ? 10 : 1))
        return
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        seekTo(event.key === 'Home' ? 0 : duration)
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [currentSelection, deleteSelected, duration, moveKeyframe, project.fps, seekTo, stepFrames])

  useEffect(
    () =>
      useProjectStore.subscribe((state, previous) => {
        if (state.project === previous.project && state.activeDevice === previous.activeDevice) return
        const current = selectionRef.current
        if (!current) return
        const hadKeyFocus = document.activeElement?.classList.contains('keyframe') === true
        const beforeTracks = tracksForSelection(previous.project, previous.activeDevice, current)
        const afterTracks = tracksForSelection(state.project, state.activeDevice, current)
        const recordedSelection = recordedRetimeSelectionTime(
          retimeTransitionsRef.current,
          previous.project,
          state.project,
          selectionScope(current),
          current.time,
        )
        const replacementTime = recordedSelection?.time ?? (
          beforeTracks && afterTracks
            ? retimedSelectionTime(beforeTracks, afterTracks, current.time)
            : null
        )

        if (
          replacementTime !== null &&
          afterTracks &&
          hasEditableKeyAtTime(afterTracks, replacementTime)
        ) {
          const replacement = { ...current, time: replacementTime }
          setSelection(replacement)
          state.setPlayhead(replacementTime)
          setActiveTrack(current.target)
          if (hadKeyFocus || recordedSelection?.restoreKeyFocus) {
            requestAnimationFrame(() => {
              timelineRef.current?.querySelector<HTMLButtonElement>('.keyframe.selected')?.focus()
            })
          }
          return
        }

        if (selectionExists(state.project, state.activeDevice, current)) return

        setSelection(null)
        if (hadKeyFocus) {
          requestAnimationFrame(() => timelineRef.current?.focus({ preventScroll: true }))
        }
      }),
    [setSelection],
  )

  useEffect(() => {
    function clearSelectionOutsideTimeline(event: PointerEvent) {
      if (timelineRef.current?.contains(event.target as Node)) return
      setSelection(null)
    }
    window.addEventListener('pointerdown', clearSelectionOutsideTimeline, true)
    return () => window.removeEventListener('pointerdown', clearSelectionOutsideTimeline, true)
  }, [setSelection])

  // One tick per second, plus a half-second subdivision for readability.
  const seconds = Math.ceil(duration)

  return (
    <div className="timeline" ref={timelineRef} tabIndex={-1} role="region" aria-label="Timeline">
      <div className="timeline-toolbar">
        <button className="play-btn" onClick={() => setPlaying(!playing)} title={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>

        <div className="transport-nav" role="group" aria-label="Timeline navigation">
          <button
            className="transport-btn"
            onClick={() => previousKey !== null && seekTo(previousKey)}
            disabled={previousKey === null}
            title={`Previous ${activeTrack} keyframe`}
            aria-label={`Previous ${activeTrack} keyframe`}
          >
            <SkipBack size={13} />
          </button>
          <button
            className="transport-btn"
            onClick={() => stepFrames(-1)}
            disabled={playhead <= 0}
            title="Previous frame (Left Arrow)"
            aria-label="Previous frame"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            className="transport-btn"
            onClick={() => stepFrames(1)}
            disabled={playhead >= duration}
            title="Next frame (Right Arrow)"
            aria-label="Next frame"
          >
            <ChevronRight size={14} />
          </button>
          <button
            className="transport-btn"
            onClick={() => nextKey !== null && seekTo(nextKey)}
            disabled={nextKey === null}
            title={`Next ${activeTrack} keyframe`}
            aria-label={`Next ${activeTrack} keyframe`}
          >
            <SkipForward size={13} />
          </button>
        </div>

        <label className="add-animation">
          <Plus size={14} />
          <select
            value={motionPreset}
            onChange={(e) => {
              setSelection(null)
              setMotionPreset(e.target.value as MotionPresetId)
            }}
          >
            {MOTION_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === 'none' ? 'Add animation' : p.label}
              </option>
            ))}
          </select>
        </label>

        <div className="keyframe-actions" role="group" aria-label="Keyframe actions">
          <button
            className="timeline-action"
            onClick={addKeyframe}
            title={`Add a ${activeTrack} keyframe at ${playhead.toFixed(2)} seconds`}
          >
            <Plus size={13} />
            Add {activeTrack === 'camera' ? 'Camera' : 'Device'} key
          </button>
          <button
            className="timeline-action icon-only"
            onClick={deleteSelected}
            disabled={!currentSelection}
            title={
              currentSelection
                ? `Delete selected key at ${currentSelection.time.toFixed(2)} seconds`
                : 'Select a keyframe to delete it'
            }
            aria-label="Delete selected keyframe"
          >
            <Trash2 size={13} />
          </button>
        </div>

        <div className="time-readout">
          <TimecodeField
            time={playhead}
            fps={project.fps}
            duration={duration}
            onCommit={seekTo}
          />
          <span className="time-of">of</span>
          <input
            className="time-duration"
            type="number"
            min={Math.max(
              0.5,
              tracksEnd(project.camera.tracks),
              ...project.devices.map((device) => tracksEnd(device.transform)),
            )}
            step={0.5}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            title="Duration cannot be shorter than the last keyframe"
          />
          <span className="time-of">s</span>
        </div>
      </div>

      <div className="timeline-body">
        <div className="ruler">
          {Array.from({ length: seconds + 1 }, (_, i) => (
            <span key={i} className="tick" style={{ left: pct(Math.min(i, duration)) }}>
              {i}s
            </span>
          ))}
        </div>

        <div className="tracks">
          <TrackRow
            target="camera"
            label="Camera"
            keys={cameraKeys}
            animated={cameraAnimated}
            active={activeTrack === 'camera'}
            selectedTime={currentSelection?.target === 'camera' ? currentSelection.time : null}
            duration={duration}
            fps={project.fps}
            pct={pct}
            onScrub={scrubTo}
            onSelect={selectKeyframe}
            onMove={moveKeyframe}
          />
          <TrackRow
            target="device"
            label={project.devices.length > 1 ? `Device ${active + 1}` : 'Device'}
            keys={deviceKeys}
            animated={deviceAnimated}
            active={activeTrack === 'device'}
            selectedTime={currentSelection?.target === 'device' ? currentSelection.time : null}
            duration={duration}
            fps={project.fps}
            pct={pct}
            onScrub={scrubTo}
            onSelect={selectKeyframe}
            onMove={moveKeyframe}
          />
          <div className="playhead-layer">
            <div className="playhead-line" style={{ left: pct(playhead) }}>
              <button
                className="playhead-handle"
                title={`Drag playhead · ${formatTimecode(playhead, project.fps)}`}
                aria-label={`Playhead at ${formatTimecode(playhead, project.fps)}`}
                role="slider"
                aria-valuemin={0}
                aria-valuemax={duration}
                aria-valuenow={playhead}
                aria-valuetext={formatTimecode(playhead, project.fps)}
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.currentTarget.focus({ preventScroll: true })
                  event.currentTarget.setPointerCapture(event.pointerId)
                  const rect = event.currentTarget.closest('.playhead-layer')?.getBoundingClientRect()
                  if (rect) seekTo(timelineTimeAtPointer(event.clientX, rect.left, rect.width, duration, project.fps))
                }}
                onPointerMove={(event) => {
                  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
                  const rect = event.currentTarget.closest('.playhead-layer')?.getBoundingClientRect()
                  if (rect) seekTo(timelineTimeAtPointer(event.clientX, rect.left, rect.width, duration, project.fps))
                }}
                onPointerUp={(event) => {
                  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
                  const rect = event.currentTarget.closest('.playhead-layer')?.getBoundingClientRect()
                  if (rect) seekTo(timelineTimeAtPointer(event.clientX, rect.left, rect.width, duration, project.fps))
                  event.currentTarget.releasePointerCapture(event.pointerId)
                }}
                onPointerCancel={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId)
                  }
                }}
              >
                <span className="playhead-grip" />
              </button>
            </div>
          </div>
        </div>
        {currentSelection && selectedEasing && (
          <KeyframeEasingControl
            key={`${currentSelection.target}:${currentSelection.deviceInstanceId ?? 'camera'}:${currentSelection.time}`}
            targetLabel={
              currentSelection.target === 'camera'
                ? 'Camera'
                : project.devices.length > 1
                  ? `Device ${active + 1}`
                  : 'Device'
            }
            state={selectedEasing}
            onChange={setSelectedEasing}
            onCustomChange={setSelectedCustomEase}
          />
        )}
      </div>
    </div>
  )
}
