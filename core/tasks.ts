// Ticking a task in a note, pure: how a task line is named for the host, and the link that asks it.
//
// zenbot's host owns the file and does the ticking: the reader sends `zen://task?id=<id>&done=1|0`.
// The id is the line's 🆔 (Obsidian Tasks) when it has one, else `L:<vault-relative path>:<1-based line>`.

/** The 🆔 on a task line (letters, digits, `-` and `_`), or null. */
export function taskIdIn(line: string): string | null {
  return /🆔\s*([A-Za-z0-9_-]+)/u.exec(line)?.[1] ?? null;
}

/** The id of the task at `line` (1-based, in the whole file) of `path`: its 🆔, else `L:<path>:<line>`. */
export function taskId(path: string, line: number, tid?: string | null): string {
  return tid || `L:${path}:${line}`;
}

/** The link that ticks (`done`) or unticks a task. The id is URL-encoded (it holds `:` and `/`). */
export function taskUrl(id: string, done: boolean): string {
  return `zen://task?id=${encodeURIComponent(id)}&done=${done ? 1 : 0}`;
}
