import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import type { EaseHandle } from '../../store/schema'
import {
  EASE_SMOOTH,
  NAMED_EASINGS,
  normalizeEaseHandle,
  type AggregateEasing,
  type NamedEasing,
} from '../../timeline/easing'

const EASING_LABELS: Record<NamedEasing, string> = {
  linear: 'Linear',
  'ease-in': 'Ease In',
  'ease-out': 'Ease Out',
  'ease-in-out': 'Ease In Out',
  smooth: 'Smooth',
  overshoot: 'Overshoot',
}

export function KeyframeEasingControl({
  targetLabel,
  state,
  onChange,
  onCustomChange,
}: {
  targetLabel: string
  state: AggregateEasing
  onChange: (easing: NamedEasing) => void
  onCustomChange: (ease: EaseHandle) => void
}) {
  const value = state.kind === 'named' ? state.name : state.kind
  const handle = state.kind === 'named' || state.kind === 'custom' ? state.ease : null
  const disabled = state.kind === 'none'
  const [editorOpen, setEditorOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)

  function closeEditor(restoreFocus: boolean) {
    setEditorOpen(false)
    if (restoreFocus) {
      requestAnimationFrame(() => toggleRef.current?.focus({ preventScroll: true }))
    }
  }

  return (
    <div className="keyframe-context" role="group" aria-label={`${targetLabel} keyframe easing`}>
      <EasingGlyph handle={handle} mixed={state.kind === 'mixed'} />
      <div className="keyframe-context-copy">
        <span>{targetLabel}</span>
        <strong>{disabled ? 'End key' : 'To next key'}</strong>
      </div>
      <select
        className="easing-select"
        value={value}
        disabled={disabled}
        aria-label="Easing to next keyframe"
        title={disabled ? 'The last keyframe has no outgoing animation' : 'Easing from this key to the next'}
        onChange={(event) => {
          closeEditor(false)
          onChange(event.target.value as NamedEasing)
        }}
      >
        {state.kind === 'none' && <option value="none">No outgoing segment</option>}
        {state.kind === 'mixed' && <option value="mixed">Mixed curves</option>}
        {state.kind === 'custom' && <option value="custom">Custom curve</option>}
        {(Object.keys(NAMED_EASINGS) as NamedEasing[]).map((name) => (
          <option key={name} value={name}>
            {EASING_LABELS[name]}
          </option>
        ))}
      </select>
      <button
        ref={toggleRef}
        className="curve-editor-toggle"
        disabled={disabled}
        aria-label="Edit custom easing curve"
        aria-expanded={editorOpen}
        title="Edit custom cubic Bézier curve"
        onClick={() => setEditorOpen((open) => !open)}
      >
        <SlidersHorizontal size={13} />
      </button>
      {editorOpen && (
        <CurveEditor
          initial={handle ?? EASE_SMOOTH}
          onCancel={() => closeEditor(true)}
          onApply={(ease) => {
            onCustomChange(ease)
            closeEditor(true)
          }}
        />
      )}
    </div>
  )
}

function EasingGlyph({ handle, mixed = false }: { handle: EaseHandle | null; mixed?: boolean }) {
  if (!handle || mixed) {
    return (
      <svg className="easing-glyph" viewBox="0 0 28 18" aria-hidden="true">
        <path d={mixed ? 'M3 13 C8 13 8 5 13 5 M15 13 C20 13 20 5 25 5' : 'M3 9 H25'} />
      </svg>
    )
  }
  const [x1, y1, x2, y2] = handle
  const path = `M3 15 C${3 + x1 * 22} ${15 - y1 * 12},${3 + x2 * 22} ${15 - y2 * 12},25 3`
  return (
    <svg className="easing-glyph" viewBox="0 0 28 18" aria-hidden="true">
      <path d={path} />
    </svg>
  )
}

const CURVE_GRAPH = { left: 12, right: 188, top: 8, bottom: 92 } as const

function curvePoint(x: number, y: number) {
  const width = CURVE_GRAPH.right - CURVE_GRAPH.left
  const height = CURVE_GRAPH.bottom - CURVE_GRAPH.top
  return {
    x: CURVE_GRAPH.left + x * width,
    y: CURVE_GRAPH.bottom - ((y + 2) / 4) * height,
  }
}

function formatCurveValue(value: number): string {
  return String(Number(value.toFixed(2)))
}

function CurveValueField({
  autoFocus,
  index,
  value,
  onChange,
}: {
  autoFocus: boolean
  index: number
  value: number
  onChange: (value: number) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const isX = index % 2 === 0
  const min = isX ? 0 : -2
  const max = isX ? 1 : 2

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: true })
  }, [autoFocus])

  useEffect(() => {
    if (document.activeElement !== inputRef.current && inputRef.current) {
      inputRef.current.value = formatCurveValue(value)
    }
  }, [value])

  return (
    <input
      ref={inputRef}
      type="number"
      min={min}
      max={max}
      step={0.01}
      defaultValue={formatCurveValue(value)}
      onChange={(event) => {
        // Leave transient input such as "-" or "0." in the native field
        // until it becomes a number; controlled number inputs erase it.
        if (Number.isFinite(event.currentTarget.valueAsNumber)) {
          onChange(event.currentTarget.valueAsNumber)
        }
      }}
      onBlur={(event) => {
        const candidate = event.currentTarget.valueAsNumber
        if (!Number.isFinite(candidate)) {
          event.currentTarget.value = formatCurveValue(value)
          return
        }
        const normalized = Math.min(max, Math.max(min, candidate))
        onChange(normalized)
        event.currentTarget.value = formatCurveValue(normalized)
      }}
    />
  )
}

function CurveEditor({
  initial,
  onCancel,
  onApply,
}: {
  initial: EaseHandle
  onCancel: () => void
  onApply: (ease: EaseHandle) => void
}) {
  const [draft, setDraft] = useState(() => normalizeEaseHandle(initial))
  const start = curvePoint(0, 0)
  const end = curvePoint(1, 1)
  const first = curvePoint(draft[0], draft[1])
  const second = curvePoint(draft[2], draft[3])

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }

    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onCancel])

  function updateHandle(index: 0 | 1, event: ReactPointerEvent<SVGCircleElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const px = ((event.clientX - rect.left) / rect.width) * 200
    const py = ((event.clientY - rect.top) / rect.height) * 100
    const x = (px - CURVE_GRAPH.left) / (CURVE_GRAPH.right - CURVE_GRAPH.left)
    const y = ((CURVE_GRAPH.bottom - py) / (CURVE_GRAPH.bottom - CURVE_GRAPH.top)) * 4 - 2
    setDraft((current) => {
      const next = [...current] as EaseHandle
      const offset = index * 2
      next[offset] = x
      next[offset + 1] = y
      return normalizeEaseHandle(next)
    })
  }

  function updatePart(index: number, value: number) {
    if (!Number.isFinite(value)) return
    setDraft((current) => {
      const next = [...current] as EaseHandle
      next[index] = value
      return normalizeEaseHandle(next)
    })
  }

  const path = `M${start.x} ${start.y} C${first.x} ${first.y},${second.x} ${second.y},${end.x} ${end.y}`

  return (
    <div className="curve-editor" role="dialog" aria-label="Custom cubic Bézier easing">
      <div className="curve-editor-header">
        <div>
          <strong>Custom curve</strong>
          <span>Drag handles or enter control points</span>
        </div>
        <button aria-label="Close curve editor" onClick={onCancel}>
          <X size={13} />
        </button>
      </div>

      <svg className="curve-graph" viewBox="0 0 200 100" aria-label="Easing curve preview">
        <line className="curve-axis" x1={start.x} y1={start.y} x2={end.x} y2={start.y} />
        <line className="curve-axis" x1={start.x} y1={start.y} x2={start.x} y2={end.y} />
        <line className="curve-control" x1={start.x} y1={start.y} x2={first.x} y2={first.y} />
        <line className="curve-control" x1={end.x} y1={end.y} x2={second.x} y2={second.y} />
        <path className="curve-path" d={path} />
        {[first, second].map((point, index) => (
          <circle
            key={index}
            className="curve-handle"
            cx={point.x}
            cy={point.y}
            r={5}
            onPointerDown={(event) => {
              const active = document.activeElement
              if (
                active instanceof HTMLInputElement &&
                event.currentTarget.closest('.curve-editor')?.contains(active)
              ) {
                // Finish a transient numeric edit before pointer movement
                // starts changing the same draft from the curve graph.
                active.blur()
              }
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => updateHandle(index as 0 | 1, event)}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
            }}
            onPointerCancel={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
            }}
          />
        ))}
      </svg>

      <div className="curve-values">
        {draft.map((value, index) => (
          <label key={index}>
            <span>{index % 2 === 0 ? `x${index / 2 + 1}` : `y${(index + 1) / 2}`}</span>
            <CurveValueField
              autoFocus={index === 0}
              index={index}
              value={value}
              onChange={(next) => updatePart(index, next)}
            />
          </label>
        ))}
      </div>

      <div className="curve-editor-actions">
        <button onClick={() => setDraft([...EASE_SMOOTH] as EaseHandle)}>Reset</button>
        <button className="primary" onClick={() => onApply(draft)}>Apply curve</button>
      </div>
    </div>
  )
}
