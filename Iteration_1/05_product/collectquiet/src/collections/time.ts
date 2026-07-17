/**
 * Time helpers for collections automation.
 * Persist UTC; keep user timezone as metadata for display / schedule building.
 */

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export function assertUtcIso(value: string, field = 'timestamp'): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid ${field}: ${value}`);
  }
  // Normalize to UTC ISO
  return d.toISOString();
}

export function isUtcIso(value: string): boolean {
  if (!ISO_UTC.test(value) && !value.endsWith('Z')) {
    // Accept any parseable instant; storage normalizes to Z
  }
  return !Number.isNaN(new Date(value).getTime());
}

/**
 * Convert a local wall-clock datetime in `timeZone` to a UTC ISO string.
 * `localParts` uses the user's intended local date/time (no offset).
 */
/** Parse `<input type="datetime-local">` value (`YYYY-MM-DDTHH:mm`) into parts. */
export function parseDateTimeLocal(value: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
  if (!m) {
    throw new Error(`Invalid datetime-local value: ${value}`);
  }
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: Number(m[6] ?? 0),
  };
}

/** Convert a datetime-local string in `timeZone` to UTC ISO. */
export function dateTimeLocalStringToUtcIso(localValue: string, timeZone: string): string {
  return localDateTimeToUtcIso(parseDateTimeLocal(localValue), timeZone);
}

export function localDateTimeToUtcIso(
  localParts: {
    year: number;
    month: number; // 1-12
    day: number;
    hour: number;
    minute: number;
    second?: number;
  },
  timeZone: string
): string {
  const { year, month, day, hour, minute, second = 0 } = localParts;
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const getParts = (ms: number) => {
    const parts = formatter.formatToParts(new Date(ms));
    const map: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = p.value;
    }
    return {
      year: Number(map.year),
      month: Number(map.month),
      day: Number(map.day),
      hour: Number(map.hour),
      minute: Number(map.minute),
      second: Number(map.second),
    };
  };

  const asUtcMs = (p: typeof localParts) =>
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second ?? 0);

  // Binary-search style: adjust guess so that zoned wall time matches desired local
  let guess = utcGuess;
  for (let i = 0; i < 3; i++) {
    const got = getParts(guess);
    const diff = asUtcMs(localParts) - asUtcMs(got);
    guess += diff;
  }

  // DST gap / overlap: prefer the offset that matches wall clock after one more pass
  const finalParts = getParts(guess);
  if (
    finalParts.year !== year ||
    finalParts.month !== month ||
    finalParts.day !== day ||
    finalParts.hour !== hour ||
    finalParts.minute !== minute
  ) {
    // Ambiguous or invalid local time — nudge by ±1h and pick closest match
    for (const delta of [-3600000, 3600000, -7200000, 7200000]) {
      const candidate = guess + delta;
      const c = getParts(candidate);
      if (
        c.year === year &&
        c.month === month &&
        c.day === day &&
        c.hour === hour &&
        c.minute === minute
      ) {
        return new Date(candidate).toISOString();
      }
    }
  }

  return new Date(guess).toISOString();
}

export function formatInTimeZone(utcIso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(utcIso));
}

export function nowUtcIso(): string {
  return new Date().toISOString();
}

export function assertChronologicalUtc(dates: string[]): void {
  let prev = 0;
  for (const d of dates) {
    const t = new Date(assertUtcIso(d)).getTime();
    if (t < prev) {
      throw new Error('Reminder dates must be in chronological order (UTC).');
    }
    prev = t;
  }
}
