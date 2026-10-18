import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeSkillCompatibility } from '../src/skill-compatibility.js';

const entry = (content: string) => ({ path: 'SKILL.md', content });

test('plain instruction-only React style guide is compatible', () => {
  const result = analyzeSkillCompatibility([
    entry(
      '# React Style Guide\n\n' +
        'Prefer function components and hooks. This guide also discusses memory performance\n' +
        'and configuration examples for shared components.\n\n' +
        'See [rules](references/rules.md) and [docs](https://example.com/docs).\n',
    ),
    { path: 'references/rules.md', content: 'Use relative imports.\n' },
  ]);
  assert.equal(result.status, 'compatible');
  assert.deepEqual(result.reasons, []);
});

test('generic memory performance and configuration examples wording is not blocked', () => {
  const result = analyzeSkillCompatibility([
    entry('# Skill\n\nCovers memory performance tuning and configuration examples.\n'),
  ]);
  assert.equal(result.status, 'compatible');
});

test('ordinary project configuration edits are not Codex configuration writes', () => {
  assert.equal(analyzeSkillCompatibility([entry('Update configuration examples for React.')]).status,'compatible');
  assert.equal(analyzeSkillCompatibility([{path:'nested/SKILL.md',content:'Nested only'}]).status,'blocked');
  assert.equal(analyzeSkillCompatibility([entry('Plain'),{path:'',content:'Empty path'}]).status,'blocked');
});

test('missing SKILL.md entry is blocked', () => {
  const result = analyzeSkillCompatibility([
    { path: 'README.md', content: 'not an entry file\n' },
  ]);
  assert.equal(result.status, 'blocked');
  assert.ok(result.reasons.some((reason) => reason.includes('SKILL.md')));
});

test('empty file list is blocked', () => {
  const result = analyzeSkillCompatibility([]);
  assert.equal(result.status, 'blocked');
  assert.ok(result.reasons.length > 0);
});

test('parent traversal and dot segment paths are blocked', () => {
  const traversal = analyzeSkillCompatibility([
    entry('# Skill\n'),
    { path: '../outside/notes.md', content: 'notes\n' },
  ]);
  assert.equal(traversal.status, 'blocked');

  const dotSegment = analyzeSkillCompatibility([
    entry('# Skill\n'),
    { path: './hidden/notes.md', content: 'notes\n' },
  ]);
  assert.equal(dotSegment.status, 'blocked');
});

test('absolute and backslash paths are blocked', () => {
  const absolute = analyzeSkillCompatibility([
    entry('# Skill\n'),
    { path: '/etc/notes.md', content: 'notes\n' },
  ]);
  assert.equal(absolute.status, 'blocked');

  const backslash = analyzeSkillCompatibility([
    entry('# Skill\n'),
    { path: 'scripts\\helper.md', content: 'notes\n' },
  ]);
  assert.equal(backslash.status, 'blocked');
});

test('credential-like files are blocked without leaking content', () => {
  for (const path of ['.env', 'keys/server.pem', 'secrets/id_rsa']) {
    const result = analyzeSkillCompatibility([
      entry('# Skill\n'),
      { path, content: 'SUPER-SECRET-VALUE\n' },
    ]);
    assert.equal(result.status, 'blocked', path);
    assert.ok(
      result.reasons.every((reason) => !reason.includes('SUPER-SECRET-VALUE')),
      path,
    );
  }
});

test('prose asking to install plugins, change config, or update memory is blocked', () => {
  const result = analyzeSkillCompatibility([
    entry(
      '# Skill\n\n' +
        'Please install the plugin, change the Codex config, and update memory after each run.\n',
    ),
  ]);
  assert.equal(result.status, 'blocked');
  assert.ok(result.reasons.some((reason) => reason.includes('插件')));
  assert.ok(result.reasons.some((reason) => reason.includes('配置')));
  assert.ok(result.reasons.some((reason) => reason.includes('记忆')));
});

test('writing to ~/.codex or ~/.agents is blocked', () => {
  const result = analyzeSkillCompatibility([
    entry('# Skill\n\nWrite your notes to ~/.codex/notes.md and state to ~/.agents/state.json.\n'),
  ]);
  assert.equal(result.status, 'blocked');
});

test('Codex-specific tool references need adaptation', () => {
  const result = analyzeSkillCompatibility([
    entry('# Skill\n\nUse functions.exec, node_repl, or the mcp__filesystem server.\n'),
  ]);
  assert.equal(result.status, 'needs_adaptation');
  assert.ok(result.reasons.some((reason) => reason.includes('Codex 专用工具')));
});

test('script files need adaptation', () => {
  const result = analyzeSkillCompatibility([
    entry('# Skill\n\nUse the bundled helpers when needed.\n'),
    { path: 'scripts/helper.py', content: 'print("hi")\n' },
    { path: 'scripts/deploy.sh', content: 'echo hi\n' },
  ]);
  assert.equal(result.status, 'needs_adaptation');
  assert.ok(result.reasons.some((reason) => reason.includes('脚本文件')));
});

test('shell execution prose needs adaptation', () => {
  const result = analyzeSkillCompatibility([
    entry('# Skill\n\nRun the following bash script before use.\n'),
  ]);
  assert.equal(result.status, 'needs_adaptation');
  assert.ok(result.reasons.some((reason) => reason.includes('shell')));
});

test('markdown links to external filesystem locations need adaptation', () => {
  const result = analyzeSkillCompatibility([
    entry('# Skill\n\nSee [parent](../notes.md) and [abs](/tmp/notes.md).\n'),
  ]);
  assert.equal(result.status, 'needs_adaptation');
  assert.ok(result.reasons.some((reason) => reason.includes('链接')));
});

test('https and relative markdown links are compatible', () => {
  const result = analyzeSkillCompatibility([
    entry('# Skill\n\nSee [rules](references/rules.md) and [docs](https://example.com/guide).\n'),
  ]);
  assert.equal(result.status, 'compatible');
});

test('blocked takes precedence over needs_adaptation', () => {
  const result = analyzeSkillCompatibility([
    entry('# Skill\n\nUse functions.exec and then install the plugin.\n'),
    { path: 'scripts/run.sh', content: 'echo hi\n' },
  ]);
  assert.equal(result.status, 'blocked');
  assert.ok(result.reasons.some((reason) => reason.includes('插件')));
  assert.ok(result.reasons.some((reason) => reason.includes('Codex 专用工具')));
});

test('reasons are deduplicated', () => {
  const result = analyzeSkillCompatibility([
    entry('# Skill\n\nCall functions.exec once, then call functions.exec again.\n'),
    { path: 'scripts/a.py', content: 'pass\n' },
    { path: 'scripts/b.py', content: 'pass\n' },
  ]);
  const toolReasons = result.reasons.filter((reason) => reason.includes('Codex 专用工具'));
  assert.equal(toolReasons.length, 1);
  const scriptReasons = result.reasons.filter((reason) => reason.includes('脚本文件'));
  assert.equal(scriptReasons.length, 1);
});
