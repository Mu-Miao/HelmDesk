export interface DiffLine {
  kind: 'added' | 'removed' | 'context' | 'hunk' | 'meta';
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface ParsedDiff {
  lines: DiffLine[];
  added: number;
  removed: number;
  binary: boolean;
  truncated: boolean;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const TRUNCATION_MARKER = '[显示已截断';
const BINARY_PREFIXES = ['binary file', 'git binary patch'];
const STRUCTURAL_PREFIXES = [
  'diff ', 'index ', 'similarity ', 'rename ', 'old mode', 'new mode',
  ...BINARY_PREFIXES,
];

function metaRow(text: string): DiffLine {
  return { kind: 'meta', text, oldLine: null, newLine: null };
}

function startsWithAny(row: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => row.startsWith(prefix));
}

export function parseDiff(diff: string): ParsedDiff {
  const parsed: ParsedDiff = { lines: [], added: 0, removed: 0, binary: false, truncated: false };
  const rows = diff.replace(/\r\n/g, '\n').split('\n');
  if (rows[rows.length - 1] === '') rows.pop();

  let inHunk = false;
  let oldLine = 0;
  let newLine = 0;

  for (const row of rows) {
    const hunk = HUNK_HEADER.exec(row);
    if (hunk) {
      inHunk = true;
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      parsed.lines.push({ kind: 'hunk', text: row, oldLine, newLine });
      continue;
    }

    if (row.startsWith(TRUNCATION_MARKER)) {
      parsed.truncated = true;
      inHunk = false;
      parsed.lines.push(metaRow(row));
      continue;
    }

    const lower = row.toLowerCase();
    if (startsWithAny(lower, STRUCTURAL_PREFIXES)) {
      if (startsWithAny(lower, BINARY_PREFIXES)) parsed.binary = true;
      inHunk = false;
      parsed.lines.push(metaRow(row));
      continue;
    }

    if (inHunk && row.startsWith('+')) {
      parsed.lines.push({ kind: 'added', text: row.slice(1), oldLine: null, newLine });
      parsed.added += 1;
      newLine += 1;
    } else if (inHunk && row.startsWith('-')) {
      parsed.lines.push({ kind: 'removed', text: row.slice(1), oldLine, newLine: null });
      parsed.removed += 1;
      oldLine += 1;
    } else if (inHunk && row.startsWith(' ')) {
      parsed.lines.push({ kind: 'context', text: row.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    } else {
      parsed.lines.push(metaRow(row));
    }
  }

  return parsed;
}
