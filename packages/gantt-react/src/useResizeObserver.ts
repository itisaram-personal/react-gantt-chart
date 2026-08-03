import { useEffect, useRef, useState } from 'react';

export interface Size {
  width: number;
  height: number;
}

/**
 * Track an element's content box.
 *
 * Falls back to a window `resize` listener where `ResizeObserver` is missing, so
 * the chart still follows the page in older browsers.
 */
export function useElementSize<E extends HTMLElement>(): [React.RefObject<E>, Size] {
  const ref = useRef<E>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const last = useRef<Size>(size);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = (): void => {
      const width = Math.round(element.clientWidth);
      const height = Math.round(element.clientHeight);
      // Sub-pixel jitter would otherwise re-render on every scroll.
      if (width === last.current.width && height === last.current.height) return;
      last.current = { width, height };
      setSize(last.current);
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}
