import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseDiff } from '../web/src/diff-model.js';

test('classifies additions, deletions and context', () => {
  const parsed = parseDiff('--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n ctx\n-old\n+new\n');
  assert.deepEqual(parsed.lines.map((line) => line.kind), ['meta', 'meta', 'hunk', 'context', 'removed', 'added']);
  const [context, removed, added] = parsed.lines.slice(3);
  assert.equal(context?.text, 'ctx');
  assert.deepEqual({ old: context?.oldLine, new: context?.newLine }, { old: 1, new: 1 });
  assert.deepEqual({ old: removed?.oldLine, new: removed?.newLine, text: removed?.text }, { old: 2, new: null, text: 'old' });
  assert.deepEqual({ old: added?.oldLine, new: added?.newLine, text: added?.text }, { old: null, new: 2, text: 'new' });
  assert.deepEqual({ added: parsed.added, removed: parsed.removed }, { added: 1, removed: 1 });
});

test('parses hunk variants and resets counters', () => {
  const parsed = parseDiff('@@ -3 +4 @@\n+four\n@@ -10,0 +11,2 @@\n+eleven\n+twelve\n');
  const [first, second, third, fourth, fifth] = parsed.lines;
  assert.equal(second?.kind, 'added');
  assert.deepEqual({ old: first?.oldLine, new: first?.newLine }, { old: 3, new: 4 });
  assert.deepEqual({ old: second?.oldLine, new: second?.newLine }, { old: null, new: 4 });
  assert.deepEqual({ old: third?.oldLine, new: third?.newLine }, { old: 10, new: 11 });
  assert.deepEqual([fourth?.newLine, fifth?.newLine], [11, 12]);
  assert.deepEqual({ old: fourth?.oldLine, old5: fifth?.oldLine }, { old: null, old5: null });
  assert.deepEqual({ added: parsed.added, removed: parsed.removed }, { added: 3, removed: 0 });
});

test('reads header lookalikes inside a hunk as code', () => {
  const parsed = parseDiff('@@ -1,2 +1,2 @@\n---- a/meta\n+++ b/meta\n');
  const [hunk, minus, plus] = parsed.lines;
  assert.equal(hunk?.kind, 'hunk');
  assert.deepEqual({ kind: minus?.kind, text: minus?.text, old: minus?.oldLine }, { kind: 'removed', text: '--- a/meta', old: 1 });
  assert.deepEqual({ kind: plus?.kind, text: plus?.text, new: plus?.newLine }, { kind: 'added', text: '++ b/meta', new: 1 });
  assert.deepEqual({ added: parsed.added, removed: parsed.removed }, { added: 1, removed: 1 });
});

test('keeps pre-hunk headers as metadata that never counts', () => {
  const parsed = parseDiff('diff --git a/f b/f\nindex 87326f2..c0f4a12 100644\n--- a/f\n+++ b/f\n');
  assert.deepEqual(parsed.lines.map((line) => line.kind), ['meta', 'meta', 'meta', 'meta']);
  assert.deepEqual(parsed.lines.map((line) => line.text), ['diff --git a/f b/f', 'index 87326f2..c0f4a12 100644', '--- a/f', '+++ b/f']);
  assert.deepEqual(parsed.lines.map((line) => [line.oldLine, line.newLine]), [[null, null], [null, null], [null, null], [null, null]]);
  assert.deepEqual({ added: parsed.added, removed: parsed.removed }, { added: 0, removed: 0 });
});

test('marks the no-newline marker as metadata without advancing counters', () => {
  const parsed = parseDiff('@@ -2,1 +3 @@\n-removed\n+kept\n\\ No newline at end of file\n@@ -9 +9 @@\n-tail\n');
  const [hunk, removed, added, marker, nextHunk] = parsed.lines;
  assert.equal(marker?.kind, 'meta');
  assert.equal(marker?.text, '\\ No newline at end of file');
  assert.deepEqual({ old: marker?.oldLine, new: marker?.newLine }, { old: null, new: null });
  assert.deepEqual({ old: removed?.oldLine, new: added?.newLine }, { old: 2, new: 3 });
  assert.deepEqual({ old: nextHunk?.oldLine, new: nextHunk?.newLine }, { old: 9, new: 9 });
  assert.deepEqual({ added: parsed.added, removed: parsed.removed }, { added: 1, removed: 2 });
});

test('detects binary payloads but not binary mentions in code', () => {
  const binary = parseDiff('diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n');
  assert.equal(binary.binary, true);
  assert.deepEqual(binary.lines.map((line) => line.kind), ['meta', 'meta']);
  const patch = parseDiff('GIT binary patch\n');
  assert.equal(patch.binary, true);
  const text = parseDiff('@@ -1,1 +1 @@\n-// binary file\n+/* git binary patch */\n');
  assert.equal(text.binary, false);
  assert.deepEqual({ added: text.added, removed: text.removed }, { added: 1, removed: 1 });
});

test('detects the display truncation marker but not code holding that text', () => {
  const truncated = parseDiff('@@ -1 +1,1 @@\n const text = "hi";\n[显示已截断，仅显示前 1 行]\n');
  const [hunk, context, marker] = truncated.lines;
  assert.equal(hunk?.kind, 'hunk');
  assert.equal(context?.kind, 'context');
  assert.equal(marker?.kind, 'meta');
  assert.deepEqual({ old: marker?.oldLine, new: marker?.newLine }, { old: null, new: null });
  assert.equal(truncated.truncated, true);
  assert.deepEqual({ added: truncated.added, removed: truncated.removed }, { added: 0, removed: 0 });

  const code = parseDiff('@@ -0,0 +1,1 @@\n+const text = "显示已截断";\n');
  assert.equal(code.truncated, false);
  assert.deepEqual({ kind: code.lines[1]?.kind, text: code.lines[1]?.text }, { kind: 'added', text: 'const text = "显示已截断";' });
});

test('normalizes CRLF, drops the trailing row, keeps blank rows as metadata', () => {
  const crlf = parseDiff('--- a/f\r\n+++ b/f\r\n@@ -1,2 +1,3 @@\r\n ctx\r\n+b\r\n');
  assert.deepEqual(crlf.lines.map((line) => line.text), ['--- a/f', '+++ b/f', '@@ -1,2 +1,3 @@', 'ctx', 'b']);
  assert.deepEqual({ kind: crlf.lines[4]?.kind, new: crlf.lines[4]?.newLine }, { kind: 'added', new: 2 });
  assert.deepEqual(parseDiff(''), { lines: [], added: 0, removed: 0, binary: false, truncated: false });
  const blank = parseDiff('a\n\nb');
  assert.deepEqual(blank.lines.map((line) => [line.kind, line.text]), [['meta', 'a'], ['meta', ''], ['meta', 'b']]);
});

test('keeps malformed and unrecognized rows as metadata with no invented numbers', () => {
  const parsed = parseDiff('@@ not a hunk @@\n@@ -x +y @@\nplain text line\n@ -1 +1 @@\n');
  assert.equal(parsed.lines.length, 4);
  assert.deepEqual(parsed.lines.map((line) => line.kind), ['meta', 'meta', 'meta', 'meta']);
  assert.deepEqual(parsed.lines.map((line) => [line.oldLine, line.newLine]), [[null, null], [null, null], [null, null], [null, null]]);
  assert.deepEqual({ added: parsed.added, removed: parsed.removed }, { added: 0, removed: 0 });
});

test('treats diff content as data, never as markup', () => {
  const parsed = parseDiff('@@ -0,0 +1,2 @@\n+<script>alert("xss")</script>\n+<img src=1 onerror=alert(1)>\n');
  assert.deepEqual(parsed.lines.map((line) => line.kind), ['hunk', 'added', 'added']);
  assert.equal(parsed.lines[1]?.text, '<script>alert("xss")</script>');
  assert.equal(parsed.lines[2]?.text, '<img src=1 onerror=alert(1)>');
  assert.deepEqual({ added: parsed.added, removed: parsed.removed, binary: parsed.binary, truncated: parsed.truncated }, { added: 2, removed: 0, binary: false, truncated: false });
});
