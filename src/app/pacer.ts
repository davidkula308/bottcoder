// Typing speed: lets code appear at a chosen pace, from human typing to "as fast as the AI writes".

export type SpeedId = "human" | "typist" | "quick" | "instant" | "custom";

export interface SpeedOption {
  id: SpeedId;
  label: string;
  detail: string;
  /** characters per second; null = no slowing down */
  cps: number | null;
  /** small random hesitations, pauses at line ends and while "thinking" */
  humanLike: boolean;
}

/** ~40 words per minute is a normal person typing (5 characters per word incl. space). */
export const SPEEDS: SpeedOption[] = [
  { id: "human", label: "Human typing speed", detail: "Like a normal person, about 40 words a minute, with small pauses.", cps: 3.5, humanLike: true },
  { id: "typist", label: "Fast typist", detail: "A quick, practised typist, about 80 words a minute.", cps: 7, humanLike: true },
  { id: "quick", label: "Quick", detail: "Steady and fast, 25 characters a second.", cps: 25, humanLike: false },
  { id: "instant", label: "As fast as possible", detail: "Code appears as fast as it is written (the previous speed).", cps: null, humanLike: false },
];

export interface SpeedSetting {
  id: SpeedId;
  /** used when id = "custom" */
  customCps: number;
}

export const DEFAULT_SPEED: SpeedSetting = { id: "human", customCps: 12 };

export function resolveSpeed(s: SpeedSetting): { cps: number | null; humanLike: boolean } {
  if (s.id === "custom") return { cps: Math.min(200, Math.max(1, s.customCps || 12)), humanLike: true };
  const o = SPEEDS.find((x) => x.id === s.id);
  return o ? { cps: o.cps, humanLike: o.humanLike } : { cps: 3.5, humanLike: true };
}

/** Delay before showing this character. Averages out to `cps`; human-like adds pauses at line ends. */
export function charDelayMs(ch: string, cps: number, humanLike: boolean, rand: () => number): number {
  const base = 1000 / cps;
  if (!humanLike) return base;
  let d = base * (0.55 + rand() * 0.9);
  if (ch === "\n") d += 120 + rand() * 380;
  else if (ch === " " && rand() < 0.04) d += 250 + rand() * 600; // a short "thinking" pause
  return d;
}

/**
 * Re-emits streamed text at the chosen speed. push() takes AI chunks; drain() resolves when everything
 * pushed has been shown (or the session was stopped).
 */
export function createPacer(
  speed: { cps: number | null; humanLike: boolean },
  emit: (chunk: string) => void,
  alive: () => boolean,
  rand: () => number = Math.random,
) {
  if (speed.cps === null) {
    return { push: (c: string) => emit(c), drain: async () => {} };
  }
  const cps = speed.cps;
  let buffer = "";
  let running: Promise<void> | null = null;
  const loop = async () => {
    while (buffer.length && alive()) {
      // Group characters so very fast speeds don't need thousands of timers.
      let wait = 0;
      let out = "";
      while (buffer.length && (wait < 16 || out === "")) {
        const ch = buffer[0];
        if (ch === undefined) break;
        wait += charDelayMs(ch, cps, speed.humanLike, rand);
        out += ch;
        buffer = buffer.slice(1);
        if (ch === "\n" && speed.humanLike) break;
      }
      await new Promise((r) => setTimeout(r, wait));
      if (alive()) emit(out);
    }
    running = null;
  };
  return {
    push(c: string) {
      buffer += c;
      if (!running) running = loop();
    },
    async drain() {
      while (running) await running;
    },
  };
}
