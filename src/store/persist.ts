import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'
import { getMedia, putMedia, pruneMedia } from '../media/storage'
import { createDefaultProject, createDevice } from './defaults'
import type { MediaRef, Project } from './schema'
import { tracksEnd } from '../timeline/sample'
import { alignDurationToFrames } from '../timeline/time'

/**
 * `.mockup` = a zip of project.json plus a media/ folder (§5).
 *
 * The document is the source of truth and stays plain JSON; blobs ride
 * alongside it rather than being inlined, so file size scales with the media
 * rather than 4/3 of it in base64.
 */

const PROJECT_ENTRY = 'project.json'
const MEDIA_PREFIX = 'media/'

/** Object URLs are per-session, so they must never be written to disk. */
function stripRuntimeFields(project: Project): Project {
  return {
    ...project,
    devices: project.devices.map((device) => {
      if (!device.screen) return device
      const { url: _url, ...rest } = device.screen
      return { ...device, screen: rest as MediaRef }
    }),
  }
}

function mediaRefs(project: Project): MediaRef[] {
  return project.devices.flatMap((d) => (d.screen ? [d.screen] : []))
}

export async function serializeProject(project: Project): Promise<Blob> {
  const files: Record<string, Uint8Array> = {
    [PROJECT_ENTRY]: strToU8(JSON.stringify(stripRuntimeFields(project), null, 2)),
  }

  for (const ref of mediaRefs(project)) {
    const blob = await getMedia(ref.id)
    if (blob) files[`${MEDIA_PREFIX}${ref.id}`] = new Uint8Array(await blob.arrayBuffer())
  }

  return new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' })
}

export async function deserializeProject(file: Blob): Promise<Project> {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const raw = entries[PROJECT_ENTRY]
  if (!raw) throw new Error('Not a .mockup file — project.json is missing')

  const project = migrate(JSON.parse(strFromU8(raw)))

  // Restore blobs before handing back the project, so every MediaRef in it
  // already has a usable object URL by the time the scene reads it.
  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.startsWith(MEDIA_PREFIX)) continue
    const id = name.slice(MEDIA_PREFIX.length)
    // Copy into a fresh buffer: fflate hands back views onto one shared
    // ArrayBuffer, and a Blob over a view keeps the whole archive alive.
    await putMedia(id, new Blob([new Uint8Array(bytes)]))
  }

  project.devices = await Promise.all(
    project.devices.map(async (device) => {
      if (!device.screen) return device
      const blob = await getMedia(device.screen.id)
      // Media lost: better an empty screen than a ref pointing at nothing.
      if (!blob) return { ...device, screen: null }
      return { ...device, screen: { ...device.screen, url: URL.createObjectURL(blob) } }
    }),
  )

  return project
}

/**
 * Bring an older document up to the current shape. Runs on every load, not
 * only when the version differs, so a file written by a half-finished build
 * still opens.
 */
export function migrate(input: unknown): Project {
  const defaults = createDefaultProject()
  if (!input || typeof input !== 'object') return defaults
  const raw = input as Partial<Project>

  const project: Project = {
    ...defaults,
    ...raw,
    version: 1,
    output: { ...defaults.output, ...raw.output },
    environment: { ...defaults.environment, ...raw.environment },
    camera: { ...defaults.camera, ...raw.camera },
    devices: migrateDevices(raw, defaults),
  }
  const contentEnd = Math.max(
    tracksEnd(project.camera.tracks),
    ...project.devices.map((device) => tracksEnd(device.transform)),
  )
  return { ...project, duration: alignDurationToFrames(project.duration, project.fps, contentEnd) }
}

type LegacySingleDevice = {
  device?: Partial<Project['devices'][number]>
  deviceTransform?: Project['devices'][number]['transform']
}

/**
 * Scenes became a list of devices when templates arrived. Files written
 * before that carry a single `device` plus a separate `deviceTransform`, so
 * fold the pair into a one-element list rather than dropping the user's
 * device and screenshot on the floor.
 */
function migrateDevices(raw: Partial<Project>, defaults: Project): Project['devices'] {
  if (Array.isArray(raw.devices) && raw.devices.length > 0) {
    return raw.devices.map((device) => ({ ...createDevice(), ...device }))
  }

  const legacy = raw as LegacySingleDevice
  if (legacy.device) {
    return [
      createDevice({
        ...legacy.device,
        transform: legacy.deviceTransform ?? createDevice().transform,
      }),
    ]
  }

  return defaults.devices
}

export function downloadProject(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name || 'Untitled'}.mockup`
  a.click()
  URL.revokeObjectURL(url)
}

/** Drop stored blobs the project no longer references. */
export function pruneUnreferencedMedia(project: Project) {
  return pruneMedia(mediaRefs(project).map((r) => r.id))
}
