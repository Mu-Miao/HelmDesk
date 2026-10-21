import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { QoderExecutor } from '../src/executor.js';
import { Store } from '../src/store.js';
import { Sharing } from '../src/sharing.js';
import { verifyInputIsolation } from '../src/isolation.js';

test('custom models use the existing official registry read-only without copying its contents', { skip: process.platform !== 'darwin' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'helm-custom-model-'));
  const directory = join(root, 'data'), login = join(root, 'login');
  mkdirSync(directory); mkdirSync(join(login, '.auth'), { recursive: true }); mkdirSync(join(login, '.models'));
  writeFileSync(join(login, '.auth/user'), 'FAKE_AUTH_FIXTURE');
  const registry = join(login, '.models/customs'); writeFileSync(registry, 'FAKE_MODEL_FIXTURE');
  const previous = process.env.HELMDESK_QODER_LOGIN_DIR;
  process.env.HELMDESK_QODER_LOGIN_DIR = login;
  const store = new Store(directory), sharing = new Sharing(store, 'http://127.0.0.1:14317');
  try {
    const task = store.create({ title: 'Custom registry fixture', prompt: 'fixture', projectPath: root, allowedFiles: [], acceptanceCriteria: ['fixture'], dependencies: [], model: '11111111-2222-3333-4444-555555555555', mode: 'probe', timeoutSeconds: 10 });
    const prepared = await new QoderExecutor(directory, sharing).prepare(task);
    assert.deepEqual(prepared.capabilityRun?.modelConfiguration, { mode: 'read-only-existing-models', verified: true });
    const alias = join(prepared.capabilityRun!.configDirectory!, '.models');
    assert.equal(realpathSync(alias), realpathSync(join(login, '.models')));
    assert.equal(await verifyInputIsolation(join(directory, 'tasks', task.id), [alias], [registry, join(alias, 'customs')], sharing.roots()), true);
    assert.equal(readFileSync(registry, 'utf8'), 'FAKE_MODEL_FIXTURE');
    assert.ok(!JSON.stringify(prepared).includes('FAKE_MODEL_FIXTURE'));
  } finally {
    await sharing.shutdown(); store.close(); rmSync(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.HELMDESK_QODER_LOGIN_DIR; else process.env.HELMDESK_QODER_LOGIN_DIR = previous;
  }
});

test('provider models reference settings read-only and never copy user secrets into the task', {skip:process.platform!=='darwin'},async()=>{
  const root=mkdtempSync(join(tmpdir(),'helm-provider-reference-')),directory=join(root,'data'),login=join(root,'login');
  mkdirSync(directory);mkdirSync(join(login,'.auth'),{recursive:true});writeFileSync(join(login,'.auth/user'),'FAKE_AUTH_FIXTURE');
  const providerId='qoder-custom-11111111-2222-4333-8444-555555555555';
  const source=join(login,'settings.json');writeFileSync(source,JSON.stringify({providers:{[providerId]:{apiKey:'FAKE_PROVIDER_SECRET',models:[{model:'fixture'}]}}}));
  const previous=process.env.HELMDESK_QODER_LOGIN_DIR;process.env.HELMDESK_QODER_LOGIN_DIR=login;
  const store=new Store(directory),sharing=new Sharing(store,'http://127.0.0.1:14317');
  try {
    const task=store.create({title:'provider fixture',prompt:'fixture',projectPath:root,allowedFiles:[],acceptanceCriteria:['fixture'],dependencies:[],model:`${providerId}/fixture`,mode:'probe',timeoutSeconds:10});
    const prepared=await new QoderExecutor(directory,sharing).prepare(task);
    assert.deepEqual(prepared.capabilityRun?.modelConfiguration,{mode:'read-only-existing-provider',verified:true});
    const alias=join(prepared.capabilityRun!.configDirectory!,'provider-settings.json');
    assert.equal(realpathSync(alias),realpathSync(source));
    assert.equal(await verifyInputIsolation(join(directory,'tasks',task.id),[login],[source,alias],sharing.roots()),true);
    assert.ok(!JSON.stringify(prepared).includes('FAKE_PROVIDER_SECRET'));
  } finally {await sharing.shutdown();store.close();rmSync(root,{recursive:true,force:true});if(previous===undefined)delete process.env.HELMDESK_QODER_LOGIN_DIR;else process.env.HELMDESK_QODER_LOGIN_DIR=previous;}
});
