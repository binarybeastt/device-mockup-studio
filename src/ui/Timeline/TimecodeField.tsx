import { useRef, useState } from 'react'
import { formatTimecode, parseTimelineTime } from './timelineMath'

export function TimecodeField({
  time,
  fps,
  duration,
  onCommit,
}: {
  time: number
  fps: number
  duration: number
  onCommit: (time: number) => void
}) {
  const formatted = formatTimecode(time, fps)
  const [draft, setDraft] = useState(formatted)
  const [editing, setEditing] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const cancelBlur = useRef(false)

  function commit() {
    const parsed = parseTimelineTime(draft, fps, duration)
    if (parsed === null) {
      setDraft(formatted)
      setEditing(false)
      setInvalid(true)
      return
    }
    setInvalid(false)
    setEditing(false)
    onCommit(parsed)
  }

  function cancel() {
    setDraft(formatted)
    setInvalid(false)
    setEditing(false)
  }

  return (
    <input
      className={invalid ? 'time-now invalid' : 'time-now'}
      value={editing ? draft : formatted}
      aria-label="Current time in minutes, seconds, and frames"
      aria-invalid={invalid}
      title="Current time · MM:SS:FF (you can also enter seconds)"
      spellCheck={false}
      onFocus={(event) => {
        setEditing(true)
        setDraft(formatted)
        setInvalid(false)
        event.currentTarget.select()
      }}
      onChange={(event) => {
        setDraft(event.target.value)
        setInvalid(false)
      }}
      onBlur={() => {
        if (cancelBlur.current) {
          cancelBlur.current = false
          return
        }
        commit()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          cancelBlur.current = true
          cancel()
          event.currentTarget.blur()
        }
      }}
    />
  )
}
