import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseModelOptions } from '../src/qoder.js';
import { modelPreference, saveModelPreference, selectModel } from '../src/model-selection.js';
import { Store } from '../src/store.js';

test('CLI model labels preserve platform names and map existing custom labels to modelID', () => {
  const id = '11111111-2222-4333-8444-555555555555'; // Synthetic custom-model ID.
  const options = parseModelOptions(['Auto', 'Qwen3.8-Max', `Qwen-3.8-Flash (${id})`]);
  assert.equal(selectModel(options, 'Qwen3.8-Max').id, 'Qwen3.8-Max');
  assert.equal(selectModel(options, `Qwen-3.8-Flash (${id})`).id, id);
  assert.equal(selectModel(options, id).kind, 'custom');
  assert.throws(() => selectModel(options, 'Unavailable'), /不会自动改用 Auto/);
});
test('default model survives restart and an explicit task selection takes precedence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'helmdesk-models-'));
  let store = new Store(directory);
  try {
    const options = parseModelOptions(['Auto', 'Qwen3.8-Max']);
    assert.equal(modelPreference(store).model, 'Auto');
    saveModelPreference(store, options, 'Qwen3.8-Max'); store.close(); store = new Store(directory);
    assert.equal(modelPreference(store).model, 'Qwen3.8-Max');
    assert.equal(selectModel(options, 'Auto').id, 'Auto');
    assert.throws(() => saveModelPreference(store, options, 'Unavailable'));
    assert.equal(modelPreference(store).model, 'Qwen3.8-Max');
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
