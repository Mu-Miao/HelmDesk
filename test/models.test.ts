import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseModelOptions } from '../src/qoder.js';
import { modelPreference, saveModelPreference, selectModel } from '../src/model-selection.js';
import { Store } from '../src/store.js';
import { providerModelOptions, selectedProviderSettings } from '../src/provider-models.js';

test('truncated custom provider rows resolve to one exact full ID or are excluded', () => {
  const id = 'qoder-custom-11111111-2222-4333-8444-555555555555/model-v1';
  const option = {id,label:'Test model',kind:'custom' as const};
  const row = `Test model (${id.slice(0,39)}…)`;
  assert.deepEqual(parseModelOptions([row], [option]), [option]);
  assert.deepEqual(parseModelOptions([row]), []);
  assert.deepEqual(parseModelOptions([row], [option,{...option,id:id+'-other'}]), []);
  assert.equal(parseModelOptions([`Test model (${id})`])[0]?.kind, 'custom');
});

test('provider projection selects one model without inheriting settings or persisting its credential', () => {
  const root = mkdtempSync(join(tmpdir(),'helm-provider-')), path = join(root,'settings.json');
  const id = 'qoder-custom-11111111-2222-4333-8444-555555555555';
  try {
    writeFileSync(path,JSON.stringify({hooks:{dangerous:true},enabledPlugins:{bad:true},providers:{[id]:{baseUrl:'https://provider.invalid/v1',apiKey:'FAKE_PROVIDER_SECRET',type:'openai-compatible',protocol:'openai',models:[{model:'first',displayName:'First'},{model:'second',displayName:'Second'}]}}}));
    const options = providerModelOptions(path);
    assert.equal(options.length,2);
    assert.ok(!JSON.stringify(options).includes('FAKE_PROVIDER_SECRET'));
    const selected=selectedProviderSettings(path,`${id}/second`);
    assert.deepEqual(Object.keys(selected.settings),['providers']);
    assert.equal(selected.settings.providers[id]!.models.length,1);
    assert.equal(selected.settings.providers[id]!.models[0]!.model,'second');
    assert.equal(selected.env.HELMDESK_PROVIDER_KEY,'FAKE_PROVIDER_SECRET');
    assert.ok(!JSON.stringify(selected.settings).includes('FAKE_PROVIDER_SECRET'));
    assert.throws(()=>selectedProviderSettings(path,`${id}/missing`),/不存在/);
    writeFileSync(path,'invalid PRIVATE CONFIG');
    assert.throws(()=>providerModelOptions(path),error=>!String(error).includes('PRIVATE CONFIG'));
  } finally {rmSync(root,{recursive:true,force:true});}
});

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
