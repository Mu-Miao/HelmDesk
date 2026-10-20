import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { dataDirectory } from './config.js';
import { detectAgent, listModels } from './qoder.js';
import { checkIsolation } from './isolation.js';
import { safeJson, errorText } from './redact.js';
import { Store } from './store.js';
import { Scheduler } from './scheduler.js';
import { QoderExecutor } from './executor.js';

const { values, positionals } = parseArgs({ options: { 'data-dir': { type: 'string' },'autostart-service':{type:'boolean'}, port: { type: 'string' }, concurrency:{type:'string'}, model:{type:'string'}, help: { type: 'boolean' } }, allowPositionals: true });
if (values['data-dir']) process.env.HELMDESK_DATA_DIR = resolve(values['data-dir']);
const command = positionals[0] ?? 'serve';
try {
  if (values.help || command === 'help') console.log('HelmDesk 领航台\n  serve [--port 4317] [--concurrency 1|2]   启动本地服务，默认单并发\n  browser              交互终端生成一次性网页入口\n  doctor               探测 CLI、模型及沙箱（不发起模型请求）\n  probe [--model Qwen3.8-Flash]   受限问候与官方用量验证（消耗账号 Credits）\n  mcp [--autostart-service] [--concurrency 1|2]   stdio MCP；显式允许时按需启动本地服务\n  --data-dir <目录>    数据目录，默认 macOS Application Support/HelmDesk');
  else if (command === 'browser') {
    if(!process.stdout.isTTY)throw Error('网页入口只在交互终端显示；也可使用 Mac 应用的“浏览器”按钮');
    const directory=dataDirectory();
    const {ensureLocalService}=await import('./local-service.js');
    await ensureLocalService(directory,Number(values.concurrency??1),true);
    const {browserEntryURL}=await import('./browser-entry.js');
    console.log('请在 60 秒内打开此一次性本机网页入口（勿转发）：');
    console.log(await browserEntryURL(directory));
  } else if (command === 'doctor') {
    const directory = dataDirectory();
    const [agent, models, isolation] = await Promise.allSettled([detectAgent(), listModels(), checkIsolation(directory)]);
    const result = { at: new Date().toISOString(), agent, models, isolation };
    writeFileSync(join(directory, 'doctor.json'), safeJson(result), { mode: 0o600 });
    console.log(safeJson(result));
  } else if (command === 'probe') {
    const directory = dataDirectory(), projectPath = join(directory, 'probe-project');
    if (existsSync(join(directory, 'service.lock'))) throw new Error('同一数据目录的服务正在运行；请使用 MCP 派发探测或先停止服务');
    mkdirSync(projectPath, { recursive: true });
    const store = new Store(directory); store.recover();
    const scheduler = new Scheduler(store, new QoderExecutor(directory));
    const task = scheduler.submit({ title: 'P0 受限接入验证', prompt: '仅回复：你好 Codex，领航台连通性测试通过。不要调用工具，不要修改文件。', projectPath, model: values.model??'Qwen3.8-Flash', mode: 'probe', allowedFiles: [], acceptanceCriteria: ['取得结构化成功响应', '保留 CLI 原始 Credits 字段与来源；缺失字段保持为空'], dependencies: [], timeoutSeconds: 60 });
    const result = await scheduler.wait(task.id, 0, 65000);
    console.log(safeJson({ ...result, quota: store.snapshot('quota') }));
    writeFileSync(join(directory, 'p0-evidence.json'), safeJson({ ...result, quota: store.snapshot('quota') }), { mode: 0o600 });
    scheduler.stop(); store.close();
    if (result.task.state !== 'completed') process.exitCode = 1;
  } else if (command === 'serve') {
    const { serve } = await import('./server.js'); await serve(dataDirectory(), Number(values.port ?? 4317),Number(values.concurrency??1));
  } else if (command === 'app-service') {
    const { ensureLocalService } = await import('./local-service.js');
    await ensureLocalService(dataDirectory(), Number(values.concurrency ?? 1), true,values.port?Number(values.port):undefined);
    console.log('领航台后台服务已就绪');
  } else if (command === 'mcp') {
    const { startMcp } = await import('./mcp.js'); await startMcp(dataDirectory(),values['autostart-service']??false,Number(values.concurrency??1));
  } else throw new Error('未知命令；使用 --help 查看用法');
} catch (error) { console.error(errorText(error)); process.exitCode = 1; }
