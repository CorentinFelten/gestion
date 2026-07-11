import { useEffect, useState } from 'react';

/**
 * Tracks the app's dark mode. The Layout toggles the `dark` class on
 * <html> (class-based Tailwind dark mode), so we observe that class and also
 * respond to the OS preference for the initial value. Charts read this to pick
 * legible axis / grid colours in both themes.
 */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(
    () =>
      typeof document !== 'undefined' &&
      document.documentElement.classList.contains('dark'),
  );

  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains('dark'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return dark;
}
