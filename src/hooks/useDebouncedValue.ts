import { useEffect, useState } from 'react';

/**
 * Trailing-edge debounce for a value.
 *
 * The city field is a plain text input, so a fetch keyed directly on it would
 * fire once per keystroke — against a free community service that is rude, and
 * it makes the widget flicker. Waiting for a pause in typing fixes both.
 */
export function useDebouncedValue<T>(value: T, delayMs = 600): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
