import { create } from 'zustand'
import { createDefaultProject, createDevice } from './defaults'
import { applyTemplateToDevices, getTemplate, templateCamera } from '../timeline/templates'
import { emptyHistory, record, redo, resetCoalescing, undo, type History } from './history'
import type { ExportQuality } from '../export/frameRenderer'
import { deserializeProject, downloadProject, pruneUnreferencedMedia, serializeProject } from './persist'
import { applyCameraAngle, applyMotionPreset, type MotionPresetId } from '../timeline/presets'
import { NAMED_EASINGS, normalizeEaseHandle, type NamedEasing } from '../timeline/easing'
import { sampleTimeline, tracksEnd } from '../timeline/sample'
import { alignDurationToFrames } from '../timeline/time'
import {
  keyTimes,
  moveTrackValuesAt,
  removeTrackValuesAt,
  setTrackValuesAt,
  setTrackEasingAt,
  setVec3At,
  setValueAt,
} from '../timeline/tracks'
import { getManifest } from '../devices/manifest'
import type {
  BackgroundConfig,
  CameraAnglePreset,
  DeviceId,
  DeviceInstance,
  DeviceOrientation,
  EaseHandle,
  MediaRef,
  Project,
  ScreenFit,
  TrackSet,
  Vec3,
} from './schema'

const KEY_TIME_EPSILON = 1e-6

function editTimes(tracks: TrackSet, time: number): number[] {
  const times = keyTimes(tracks)
  if (!times.some((candidate) => Math.abs(candidate - time) < KEY_TIME_EPSILON)) times.push(time)
  return times.sort((a, b) => a - b)
}

/**
 * The compact timeline renders one diamond per object time, not per scalar
 * channel. Before editing one of those diamonds, materialise a complete pose
 * at every visible time so changing Y at an X-driven preset key changes that
 * frame rather than the static Y value for the whole clip.
 */
function completeDevicePoseKeys(project: Project, deviceIndex: number, time: number): TrackSet {
  const device = project.devices[deviceIndex]
  if (!device) return {}
  const samples = editTimes(device.transform, time).map((sampleTime) => ({
    time: sampleTime,
    state: sampleTimeline(project, sampleTime).devices[deviceIndex],
  }))
  return samples.reduce(
    (tracks, sample) =>
      setTrackValuesAt(tracks, sample.time, {
        'position.x': sample.state.position[0],
        'position.y': sample.state.position[1],
        'position.z': sample.state.position[2],
        'rotation.x': sample.state.rotation[0],
        'rotation.y': sample.state.rotation[1],
        'rotation.z': sample.state.rotation[2],
        scale: sample.state.scale,
      }),
    device.transform,
  )
}

function completeCameraPoseKeys(project: Project, time: number): TrackSet {
  const samples = editTimes(project.camera.tracks, time).map((sampleTime) => ({
    time: sampleTime,
    state: sampleTimeline(project, sampleTime).camera,
  }))
  return samples.reduce(
    (tracks, sample) =>
      setTrackValuesAt(tracks, sample.time, {
        'position.x': sample.state.position[0],
        'position.y': sample.state.position[1],
        'position.z': sample.state.position[2],
        'target.x': sample.state.target[0],
        'target.y': sample.state.target[1],
        'target.z': sample.state.target[2],
        fov: sample.state.fov,
      }),
    project.camera.tracks,
  )
}

type ProjectStore = {
  project: Project
  /** Playhead position in seconds. Transient UI state, not part of the document. */
  playhead: number
  playing: boolean
  motionPreset: MotionPresetId

  /** 'image' hides the timeline entirely — a still has no time axis. */
  editorMode: 'movie' | 'image'
  exportQuality: ExportQuality
  setExportQuality: (q: ExportQuality) => void
  /**
   * Size the export from the screenshot rather than from the chosen output
   * size. Opt-in: enabling it can create a much larger file, so the chosen
   * canvas dimensions remain authoritative unless the user asks otherwise.
   */
  matchSource: boolean
  setMatchSource: (on: boolean) => void
  history: History
  canUndo: () => boolean
  canRedo: () => boolean
  undo: () => void
  redo: () => void
  newProject: () => void
  saveProject: () => Promise<void>
  openProject: (file: Blob) => Promise<void>
  setEditorMode: (mode: 'movie' | 'image') => void
  setName: (name: string) => void
  setPlayhead: (t: number) => void
  setPlaying: (playing: boolean) => void
  setDuration: (seconds: number) => void
  setFps: (fps: 30 | 60) => void

  /** Index of the device the inspector edits. Transient, not part of the doc. */
  activeDevice: number
  setActiveDevice: (index: number) => void
  addDevice: () => void
  duplicateDevice: (index: number) => void
  removeDevice: (index: number) => void
  applyTemplate: (templateId: string) => void

  setScreenMedia: (ref: MediaRef | null) => void
  setScreenFit: (fit: ScreenFit) => void
  setDeviceId: (id: DeviceId) => void
  setColorway: (id: string) => void
  setOrientation: (o: DeviceOrientation) => void

  setBackground: (bg: BackgroundConfig) => void
  setEnvironment: (patch: Partial<Project['environment']>) => void
  setOutput: (patch: Partial<Project['output']>) => void

  setCameraPreset: (preset: CameraAnglePreset) => void
  setCameraPosition: (v: Vec3) => void
  setCameraFov: (fov: number) => void
  setDeviceRotation: (v: Vec3) => void
  setDevicePosition: (v: Vec3) => void
  setDeviceScale: (v: number) => void
  setMotionPreset: (preset: MotionPresetId) => void
  addCameraKeyframe: (t: number) => void
  addDeviceKeyframe: (t: number) => void
  deleteCameraKeyframe: (t: number) => void
  deleteDeviceKeyframe: (t: number) => void
  moveCameraKeyframe: (from: number, to: number) => void
  moveDeviceKeyframe: (from: number, to: number) => void
  setCameraKeyframeEasing: (t: number, easing: NamedEasing) => void
  setDeviceKeyframeEasing: (t: number, easing: NamedEasing) => void
  setCameraKeyframeEase: (t: number, ease: EaseHandle) => void
  setDeviceKeyframeEase: (t: number, ease: EaseHandle) => void
}

// Narrow selectors are used at call sites (§14 trap 10) — components should
// subscribe to the slice they need, not the whole project object, or every
// timeline scrub re-renders the scene tree.
export const useProjectStore = create<ProjectStore>((set, get) => {
  /**
   * Every document mutation goes through here, so undo coverage can't drift
   * out of sync with the set of actions. `label` groups a continuous gesture
   * (a field drag, a slider) into one history entry.
   */
  const edit = (label: string | undefined, update: (p: Project) => Project) =>
    set((s) => ({
      project: update(s.project),
      history: record(s.history, s.project, label),
    }))

  /** Edit one device instance in place, leaving the rest of the list alone. */
  const editDevice = (label: string, update: (d: DeviceInstance) => DeviceInstance) =>
    edit(label, (p) => ({
      ...p,
      devices: p.devices.map((d, i) => (i === get().activeDevice ? update(d) : d)),
    }))

  const editDeviceTracks = (label: string, update: (tracks: TrackSet) => TrackSet) => {
    const { activeDevice, editorMode, playhead } = get()
    edit(label, (p) => ({
      ...p,
      devices: p.devices.map((device, index) => {
        if (index !== activeDevice) return device
        const tracks =
          editorMode === 'movie'
            ? completeDevicePoseKeys(p, activeDevice, playhead)
            : device.transform
        return { ...device, transform: update(tracks) }
      }),
    }))
  }

  const editCameraTracks = (label: string, update: (tracks: TrackSet) => TrackSet) => {
    const { editorMode, playhead } = get()
    edit(label, (p) => {
      const tracks =
        editorMode === 'movie' ? completeCameraPoseKeys(p, playhead) : p.camera.tracks
      return {
        ...p,
        camera: { ...p.camera, preset: null, tracks: update(tracks) },
      }
    })
  }

  const setCameraKeyframeEase = (t: number, handle: EaseHandle) => {
    const ease = normalizeEaseHandle(handle)
    const tracks = get().project.camera.tracks
    const next = setTrackEasingAt(tracks, t, ease)
    if (next === tracks) return
    edit(undefined, (p) => ({
      ...p,
      camera: { ...p.camera, tracks: setTrackEasingAt(p.camera.tracks, t, ease) },
    }))
  }

  const setDeviceKeyframeEase = (t: number, handle: EaseHandle) => {
    const ease = normalizeEaseHandle(handle)
    const active = get().activeDevice
    const tracks = get().project.devices[active]?.transform
    if (!tracks) return
    const next = setTrackEasingAt(tracks, t, ease)
    if (next === tracks) return
    edit(undefined, (p) => ({
      ...p,
      devices: p.devices.map((device, index) =>
        index === active ? { ...device, transform: setTrackEasingAt(device.transform, t, ease) } : device,
      ),
    }))
  }

  const replace = (project: Project) => {
    resetCoalescing()
    set({ project, history: emptyHistory, playhead: 0, playing: false, activeDevice: 0 })
  }

  return {
  project: createDefaultProject(),
  history: emptyHistory,

  canUndo: () => get().history.past.length > 0,
  canRedo: () => get().history.future.length > 0,
  undo: () => {
    const s = get()
    const result = undo(s.history, s.project)
    if (result) set({ project: result.project, history: result.history })
  },
  redo: () => {
    const s = get()
    const result = redo(s.history, s.project)
    if (result) set({ project: result.project, history: result.history })
  },

  newProject: () => replace(createDefaultProject()),
  saveProject: async () => {
    const project = get().project
    downloadProject(await serializeProject(project), project.name)
  },
  openProject: async (file) => {
    const project = await deserializeProject(file)
    replace(project)
    void pruneUnreferencedMedia(project)
  },

  playhead: 0,
  playing: false,
  motionPreset: 'none',
  editorMode: 'image',
  activeDevice: 0,
  exportQuality: 'high',
  matchSource: false,

  setExportQuality: (exportQuality) => set({ exportQuality }),

  // Opt-in because matching a tall source can multiply both output axes.
  // Typing a size also turns it off, keeping the dimensions authoritative.
  setMatchSource: (matchSource: boolean) => set({ matchSource }),

  setEditorMode: (editorMode) => set({ editorMode }),
  setName: (name) => edit('name', (p) => ({ ...p, name })),

  setPlayhead: (t) => set({ playhead: Math.min(get().project.duration, Math.max(0, t)) }),
  setPlaying: (playing) => set({ playing }),
  setDuration: (seconds) => {
    const project = get().project
    const contentEnd = Math.max(
      tracksEnd(project.camera.tracks),
      ...project.devices.map((device) => tracksEnd(device.transform)),
    )
    const duration = alignDurationToFrames(Math.max(0.1, seconds), project.fps, contentEnd)
    if (duration === project.duration) {
      set((state) => ({ playhead: Math.min(state.playhead, duration) }))
      return
    }
    edit('duration', (p) => ({ ...p, duration }))
    set((state) => ({ playhead: Math.min(state.playhead, duration) }))
  },
  // Frame rate is a document property, not an export setting: it decides
  // which times the timeline is sampled at, so changing it changes the clip
  // rather than just the file.
  setFps: (fps) =>
    edit('fps', (p) => {
      const contentEnd = Math.max(
        tracksEnd(p.camera.tracks),
        ...p.devices.map((device) => tracksEnd(device.transform)),
      )
      return { ...p, fps, duration: alignDurationToFrames(p.duration, fps, contentEnd) }
    }),

  setActiveDevice: (index) => set({ activeDevice: index }),

  addDevice: () => {
    // New devices land beside the current one rather than on top of it —
    // an added device you cannot see reads as nothing having happened.
    const source = get().project.devices[get().activeDevice]
    edit('addDevice', (p) => ({
      ...p,
      devices: [...p.devices, createDevice({ id: source?.id, colorway: source?.colorway })],
    }))
    set({ activeDevice: get().project.devices.length - 1 })
  },

  duplicateDevice: (index) => {
    edit('duplicateDevice', (p) => {
      const source = p.devices[index]
      if (!source) return p
      const copy = { ...source, instanceId: crypto.randomUUID() }
      return { ...p, devices: [...p.devices.slice(0, index + 1), copy, ...p.devices.slice(index + 1)] }
    })
    set({ activeDevice: index + 1 })
  },

  removeDevice: (index) => {
    // A scene with no devices has nothing to show and no way back, so the
    // last one can't be removed.
    if (get().project.devices.length <= 1) return
    edit('removeDevice', (p) => ({ ...p, devices: p.devices.filter((_, i) => i !== index) }))
    set({ activeDevice: Math.max(0, Math.min(index, get().project.devices.length - 1)) })
  },

  applyTemplate: (templateId) => {
    const template = getTemplate(templateId)
    if (!template) return
    edit('template', (p) => ({
      ...p,
      devices: applyTemplateToDevices(template, p.devices),
      camera: templateCamera(template),
      output: template.suggestedOutput ?? p.output,
      // Backdrop and shadow carry the look as much as the pose does.
      background: template.background ?? p.background,
      environment:
        template.shadowOpacity === undefined
          ? p.environment
          : { ...p.environment, shadowOpacity: template.shadowOpacity },
    }))
    set({ activeDevice: 0 })
  },

  setScreenMedia: (ref) => editDevice('screen', (d) => ({ ...d, screen: ref })),
  setScreenFit: (fit) => editDevice('fit', (d) => ({ ...d, screenFit: fit })),
  setDeviceId: (id) =>
    // A colorway id is only meaningful within its own manifest, so reset to
    // the incoming device's first swatch rather than carrying a stale one.
    editDevice('device', (d) => ({ ...d, id, colorway: getManifest(id).colorways[0].id })),
  setColorway: (colorway) => editDevice('colorway', (d) => ({ ...d, colorway })),
  setOrientation: (orientation) => editDevice('orientation', (d) => ({ ...d, orientation })),

  setBackground: (bg) => edit('background', (p) => ({ ...p, background: bg })),
  setEnvironment: (patch) =>
    edit('environment', (p) => ({ ...p, environment: { ...p.environment, ...patch } })),
  setOutput: (patch) => edit('output', (p) => ({ ...p, output: { ...p.output, ...patch } })),

  setCameraPreset: (preset) => edit('cameraPreset', (p) => applyCameraAngle(p, preset)),
  setCameraPosition: (v) =>
    editCameraTracks('cameraPosition', (tracks) =>
      setVec3At(tracks, 'position', get().playhead, v),
    ),
  setCameraFov: (fov) => {
    const { editorMode, playhead } = get()
    edit('fov', (p) => {
      const tracks =
        editorMode === 'movie' ? completeCameraPoseKeys(p, playhead) : p.camera.tracks
      return {
        ...p,
        camera: {
          ...p.camera,
          fov,
          preset: null,
          tracks: { ...tracks, fov: setValueAt(tracks.fov, playhead, fov) },
        },
      }
    })
  },
  setDeviceRotation: (v) =>
    editDeviceTracks('deviceRotation', (tracks) =>
      setVec3At(tracks, 'rotation', get().playhead, v),
    ),
  setDevicePosition: (v) =>
    editDeviceTracks('devicePosition', (tracks) =>
      setVec3At(tracks, 'position', get().playhead, v),
    ),
  // Uniform, like every other scale in the document — a non-uniform device is
  // a distorted device, which is never what a mockup wants.
  setDeviceScale: (v) =>
    editDeviceTracks('deviceScale', (tracks) => ({
      ...tracks,
      scale: setValueAt(tracks.scale, get().playhead, v),
    })),
  addCameraKeyframe: (t) =>
    edit('addCameraKeyframe', (p) => {
      const time = Math.min(p.duration, Math.max(0, t))
      return {
        ...p,
        camera: {
          ...p.camera,
          preset: null,
          tracks: completeCameraPoseKeys(p, time),
        },
      }
    }),
  addDeviceKeyframe: (t) => {
    const active = get().activeDevice
    edit('addDeviceKeyframe', (p) => {
      const time = Math.min(p.duration, Math.max(0, t))
      if (!p.devices[active]) return p
      return {
        ...p,
        devices: p.devices.map((device, index) =>
          index === active
            ? {
                ...device,
                transform: completeDevicePoseKeys(p, active, time),
              }
            : device,
        ),
      }
    })
  },
  deleteCameraKeyframe: (t) => {
    const tracks = get().project.camera.tracks
    const next = removeTrackValuesAt(tracks, t)
    if (next === tracks) return
    edit('deleteCameraKeyframe', (p) => ({
      ...p,
      camera: { ...p.camera, preset: null, tracks: next },
    }))
  },
  deleteDeviceKeyframe: (t) => {
    const active = get().activeDevice
    const tracks = get().project.devices[active]?.transform
    if (!tracks) return
    const next = removeTrackValuesAt(tracks, t)
    if (next === tracks) return
    edit('deleteDeviceKeyframe', (p) => ({
      ...p,
      devices: p.devices.map((device, index) =>
        index === active ? { ...device, transform: next } : device,
      ),
    }))
  },
  moveCameraKeyframe: (from, to) => {
    const tracks = get().project.camera.tracks
    const time = Math.min(get().project.duration, Math.max(0, to))
    const next = moveTrackValuesAt(tracks, from, time)
    if (next === tracks) return
    // Discrete commands must never coalesce when two quick drags happen to
    // share the same action name; each drop is one independent undo step.
    edit(undefined, (p) => ({
      ...p,
      camera: { ...p.camera, preset: null, tracks: moveTrackValuesAt(p.camera.tracks, from, time) },
    }))
  },
  moveDeviceKeyframe: (from, to) => {
    const active = get().activeDevice
    const tracks = get().project.devices[active]?.transform
    if (!tracks) return
    const time = Math.min(get().project.duration, Math.max(0, to))
    const next = moveTrackValuesAt(tracks, from, time)
    if (next === tracks) return
    edit(undefined, (p) => ({
      ...p,
      devices: p.devices.map((device, index) =>
        index === active
          ? { ...device, transform: moveTrackValuesAt(device.transform, from, time) }
          : device,
      ),
    }))
  },
  setCameraKeyframeEasing: (t, easing) => setCameraKeyframeEase(t, NAMED_EASINGS[easing]),
  setDeviceKeyframeEasing: (t, easing) => setDeviceKeyframeEase(t, NAMED_EASINGS[easing]),
  setCameraKeyframeEase,
  setDeviceKeyframeEase,
  setMotionPreset: (preset) => {
    set({ motionPreset: preset })
    edit('motionPreset', (p) => applyMotionPreset(p, preset))
  },
  }
})
