import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SERVICE_NAME = 'com.local-group-monitor.ai-provider';
const supportedProviders = new Set(['openai', 'xai', 'custom']);

function assertProvider(provider: string) {
  if (!supportedProviders.has(provider)) throw new Error('This provider does not use an API key.');
}

export async function saveProviderApiKey(provider: string, apiKey: string) {
  assertProvider(provider);
  if (apiKey.trim().length < 8) throw new Error('Enter a valid API key.');
  await execFileAsync('security', ['add-generic-password', '-U', '-s', SERVICE_NAME, '-a', provider, '-w', apiKey.trim()]);
}

export async function getProviderApiKey(provider: string) {
  assertProvider(provider);
  try {
    const { stdout } = await execFileAsync('security', ['find-generic-password', '-s', SERVICE_NAME, '-a', provider, '-w']);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function deleteProviderApiKey(provider: string) {
  assertProvider(provider);
  try {
    await execFileAsync('security', ['delete-generic-password', '-s', SERVICE_NAME, '-a', provider]);
  } catch {
    // A missing key is already the desired state.
  }
}

export async function getProviderCredentialStatus() {
  const providers = ['openai', 'xai', 'custom'] as const;
  const values = await Promise.all(providers.map(async (provider) => [provider, Boolean(await getProviderApiKey(provider))] as const));
  return Object.fromEntries(values) as Record<(typeof providers)[number], boolean>;
}
