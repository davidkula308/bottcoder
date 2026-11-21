import { useEffect, useRef, useState } from "react";

/** State persisted to localStorage. Loads after mount to stay hydration-safe. */
export function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const loaded = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`nightshift:${key}`);
      if (raw) {
        const parsed = JSON.parse(raw) as T;
        const isObj = initial && typeof initial === "object" && !Array.isArray(initial);
        setValue(isObj ? ({ ...(initial as object), ...(parsed as object) } as T) : parsed);
      }
    } catch {
      /* ignore corrupt storage */
    }
    loaded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (loaded.current) localStorage.setItem(`nightshift:${key}`, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue] as const;
}
