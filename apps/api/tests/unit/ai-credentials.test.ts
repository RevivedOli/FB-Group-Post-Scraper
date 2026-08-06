import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFileAsync = vi.fn();

vi.mock('node:util', async () => {
  const actual = await vi.importActual<typeof import('node:util')>('node:util');
  return {
    ...actual,
    promisify: () => execFileAsync,
  };
});

describe('AI credentials Keychain boundaries', () => {
  beforeEach(() => {
    execFileAsync.mockReset();
    vi.resetModules();
  });

  it('saves keys through the macOS security command and never returns the secret from status', async () => {
    execFileAsync.mockResolvedValue({ stdout: '' });
    const { saveProviderApiKey, getProviderCredentialStatus } = await import('../../src/services/ai-credentials.service.js');
    await saveProviderApiKey('openai', 'sk-test-key-123456');
    expect(execFileAsync).toHaveBeenCalledWith('security', [
      'add-generic-password',
      '-U',
      '-s',
      'com.local-group-monitor.ai-provider',
      '-a',
      'openai',
      '-w',
      'sk-test-key-123456',
    ]);

    execFileAsync.mockResolvedValueOnce({ stdout: 'sk-test-key-123456\n' });
    execFileAsync.mockRejectedValueOnce(new Error('missing'));
    execFileAsync.mockRejectedValueOnce(new Error('missing'));
    const status = await getProviderCredentialStatus();
    expect(status).toEqual({ openai: true, xai: false, custom: false });
    expect(JSON.stringify(status)).not.toContain('sk-test');
  });

  it('rejects Ollama as a Keychain provider', async () => {
    const { saveProviderApiKey } = await import('../../src/services/ai-credentials.service.js');
    await expect(saveProviderApiKey('ollama', 'not-a-key')).rejects.toThrow('does not use an API key');
  });
});
