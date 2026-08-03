import { useEffect, useRef, type RefObject } from 'react';

/**
 * Attach a non-passive `wheel` listener.
 *
 * React registers its own wheel handlers as passive at the root, so a handler
 * passed via `onWheel` cannot call `preventDefault`. Scroll hijacking needs the
 * native listener.
 */
export function useNativeWheel<E extends HTMLElement>(
  ref: RefObject<E>,
  handler: (event: WheelEvent) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const listener = (event: WheelEvent): void => handlerRef.current(event);
    element.addEventListener('wheel', listener, { passive: false });
    return () => element.removeEventListener('wheel', listener);
  }, [ref]);
}
