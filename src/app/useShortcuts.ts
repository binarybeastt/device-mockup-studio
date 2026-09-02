import { useEffect } from 'react'
import { useProjectStore } from '../store/project'

const NATIVE_SPACE_TARGETS = [
  'button',
  'a[href]',
  'summary',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="slider"]',
].join(', ')

type ClosestTarget = EventTarget & {
  closest?: (selector: string) => Element | null
}

/** Keep Space available to controls whose native keyboard activation depends on it. */
export function reservesSpaceForNativeActivation(target: EventTarget | null): boolean {
  const candidate = target as ClosestTarget | null
  return typeof candidate?.closest === 'function' && candidate.closest(NATIVE_SPACE_TARGETS) !== null
}

/**
 * Global keyboard shortcuts.
 *
 * Deliberately inert while a text field has focus: undo inside an input
 * should undo typing, not reach past it and revert the document.
 */
export function useShortcuts() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
        return
      }

      const store = useProjectStore.getState()
      const mod = e.metaKey || e.ctrlKey

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void store.saveProject()
        return
      }
      if (e.key === ' ') {
        if (reservesSpaceForNativeActivation(e.target)) return
        e.preventDefault()
        store.setPlaying(!store.playing)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
