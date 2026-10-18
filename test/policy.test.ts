import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { toolDecision } from '../src/tool-policy.js';
test('tool hook gates read paths, write scope, glob traversal, symlinks, and unapproved tools', () => {
  const root = mkdtempSync(join(tmpdir(), 'helmdesk-policy-')); const workspace = join(root, 'work'); mkdirSync(workspace);
  try {
    const check = (name: string, input: Record<string,unknown>) => toolDecision(name, input, workspace, ['result.txt', 'src/']).allowed;
    assert.equal(check('Write', { file_path: 'result.txt' }), true); assert.equal(check('Edit', { file_path: 'src/new.ts' }), true);
    assert.equal(check('Write', { file_path: 'unapproved.txt' }), false); assert.equal(check('Read', { file_path: '/etc/passwd' }), false);
    assert.equal(check('Glob', { pattern: '../**/*' }), false); assert.equal(check('Bash', { command: 'echo hello' }), false);
    symlinkSync(root, join(workspace, 'escape')); assert.equal(check('Read', { file_path: 'escape/anything' }), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
