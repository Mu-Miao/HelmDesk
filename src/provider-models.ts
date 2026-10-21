import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ModelOption } from './model-types.js';

export function providerSettingsPath() {
  return join(process.env.HELMDESK_QODER_LOGIN_DIR ?? join(homedir(), '.qoder-cn'), 'settings.json');
}

function providersAt(path: string): Record<string, any> {
  if (!existsSync(path)) return {};
  try {
    const content = readFileSync(path, 'utf8');
    if (content.length > 4_000_000) throw Error();
    const value = JSON.parse(content).providers;
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { throw new Error('官方自定义供应商配置无法解析；未输出配置内容'); }
}

export function providerModelOptions(path = providerSettingsPath()): ModelOption[] {
  return Object.entries(providersAt(path)).flatMap(([providerId, provider]) => {
    if (!/^qoder-custom-[0-9a-f-]{36}$/i.test(providerId) || !Array.isArray(provider?.models)) return [];
    return provider.models.flatMap((model: any) => typeof model?.model === 'string' && model.model.length > 0
      ? [{ id: `${providerId}/${model.model}`, label: typeof model.displayName === 'string' ? model.displayName : model.model, kind: 'custom' as const }]
      : []);
  });
}

/** Only the selected provider/model reaches the SDK. Its generated settings contain an env reference, never the key. */
export function selectedProviderSettings(path: string, modelId: string) {
  const providerId = modelId.slice(0, modelId.indexOf('/'));
  const provider = providersAt(path)[providerId];
  const model = provider?.models?.find((item: any) => `${providerId}/${item.model}` === modelId);
  if (!model || typeof provider.apiKey !== 'string' || !provider.apiKey) throw new Error('所选自定义模型配置不存在或缺少认证');
  // Reject unresolved environment references rather than forwarding parent-provider environment variables.
  if (/\$\{|\$[A-Za-z_]/.test(provider.apiKey)) throw new Error('供应商密钥使用环境引用；当前受限执行不继承该环境');
  const settings = { providers: { [providerId]: {
    baseUrl: provider.baseUrl, type: provider.type, protocol: provider.protocol, authType: provider.authType,
    apiKey: '${HELMDESK_PROVIDER_KEY}', model: model.model, models: [{
      model: model.model, displayName: model.displayName, contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens, capabilities: model.capabilities
    }]
  } } };
  return { settings, env: { HELMDESK_PROVIDER_KEY: provider.apiKey as string, QODER_SDK_CUSTOM_BASE_URL_BYOK: '1' } };
}
