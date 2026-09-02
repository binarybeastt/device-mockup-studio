import { Zip, ZipPassThrough } from 'fflate'
import { beginFrameExport, type FrameExportParams } from './frameRenderer'
import type { SceneApplier } from './renderer'
import { hasScreenVideos, seekScreenVideos } from '../media/screenVideo'
import { frameCountForDuration } from '../timeline/time'

/**
 * Frame times for a clip. `t = i / fps`, nothing else.
 *
 * Split out and tested because it is the definition of what "deterministic"
 * means here: the export never reads a clock or a frame delta, so the same
 * project exports byte-identically on a fast machine and a slow one, and
 * frame `i` of the export is the same pose as scrubbing the preview to
 * `i / fps` (§4, §14 trap 5).
 *
 * The last frame sits one frame *before* `duration`, not on it: a 2s clip at
 * 30fps is 60 frames covering 0..59/30, and including t = duration would
 * duplicate the loop point.
 */
export function frameTimes(duration: number, fps: number): number[] {
  const count = frameCountForDuration(duration, fps)
  return Array.from({ length: count }, (_, i) => i / fps)
}

/** Zero-padded to keep ffmpeg's `%04d` and a plain file sort in agreement. */
export function frameFileName(index: number): string {
  return `frame_${String(index).padStart(4, '0')}.png`
}

export type SequenceExportParams = FrameExportParams & {
  duration: number
  fps: number
  /** Poses the scene at `t` — the same function the preview loop calls. */
  applyAt: SceneApplier
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

/**
 * PNG sequence export (§9.3, M8).
 *
 * This is the guaranteed path: no WebCodecs, no codec support matrix, no
 * container. It is worth having even once video export exists, because it
 * cannot be blocked by a browser bug — the user runs one ffmpeg command.
 *
 * The frames are stored, not deflated. PNG is already compressed; asking
 * fflate to deflate it again spends seconds per frame to save fractions of a
 * percent. `ZipPassThrough` streams each frame into the archive as it is
 * encoded, so peak memory is the archive rather than the archive plus every
 * frame.
 */
export async function exportPngSequence({
  duration,
  fps,
  applyAt,
  onProgress,
  signal,
  ...frameParams
}: SequenceExportParams): Promise<Blob> {
  const times = frameTimes(duration, fps)
  const exporter = beginFrameExport(frameParams)

  const chunks: Uint8Array[] = []
  let zipError: Error | null = null
  let finished: () => void = () => {}
  const done = new Promise<void>((resolve) => {
    finished = resolve
  })

  const zip = new Zip((err, data, final) => {
    if (err) zipError = err
    if (data.length) chunks.push(data)
    if (final) finished()
  })

  try {
    for (let i = 0; i < times.length; i++) {
      signal?.throwIfAborted()

      applyAt(times[i])
      // Screen recordings are seeked exactly and awaited, unlike the
      // preview's tolerant sync (§8.3). Rendering without the await gives
      // whatever frame the decoder happened to hold — the same frame
      // repeated, then a jump.
      if (hasScreenVideos()) await seekScreenVideos(times[i])

      const frame = exporter.renderFrame()
      const blob = await frame.convertToBlob({ type: 'image/png' })

      const entry = new ZipPassThrough(frameFileName(i))
      zip.add(entry)
      entry.push(new Uint8Array(await blob.arrayBuffer()), true)
      if (zipError) throw zipError

      onProgress?.((i + 1) / times.length)

      // Yield to the event loop between frames. The render itself is
      // synchronous and the loop is stopped, so without this the whole
      // export runs inside one task: no progress paints and the cancel
      // button cannot be clicked.
      await new Promise((r) => setTimeout(r, 0))
    }

    zip.end()
    await done
    if (zipError) throw zipError
    return new Blob(chunks as BlobPart[], { type: 'application/zip' })
  } finally {
    exporter.dispose()
  }
}
