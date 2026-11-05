import { useEffect, useState } from 'react';
import { Alert, Button, Card, CardContent, CircularProgress, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import type {
  AppSettings,
  BrowserCursorCapability,
  BrowserCursorTestResult,
  AiCredentialStatus,
  AiCuratedModel,
} from '@local-group-monitor/shared';
import { CUSTOM_MODEL_SENTINEL, OPENAI_CURATED_MODELS, XAI_CURATED_MODELS } from '@local-group-monitor/shared';
import { OperationsSettings } from '../components/OperationsSettings';
import { apiGet, apiSend } from '../api/client';

function formatAiActionMessage(label: string, result: Record<string, unknown>) {
  if (result.started === true) return `${label}: processor started and will drain the queue.`;
  if (result.reason === 'processor_already_running') return `${label}: processor is already running.`;
  if (typeof result.processed === 'number') return `${label}: processed ${result.processed} queue item(s).`;
  const queued = (result.queued && typeof result.queued === 'object') ? result.queued as Record<string, unknown> : result;
  const queuedCount = typeof queued.queued === 'number' ? queued.queued : 0;
  const inspected = typeof queued.inspected === 'number' ? queued.inspected : 0;
  const skipped = typeof queued.skipped === 'number' ? queued.skipped : 0;
  return `${label}: queued ${queuedCount}, inspected ${inspected}, skipped ${skipped}.`;
}

function priceLabel(model: AiCuratedModel) {
  return `$${model.inputCostPerMillion}/$${model.outputCostPerMillion} per 1M in/out`;
}

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>();
  const [cursorCapability, setCursorCapability] = useState<BrowserCursorCapability>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [cursorTest, setCursorTest] = useState<BrowserCursorTestResult>();
  const [credentialStatus, setCredentialStatus] = useState<AiCredentialStatus>({ openai: false, xai: false, custom: false });
  const [apiKey, setApiKey] = useState('');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);

  const load = () => {
    setError(undefined);
    Promise.all([
      apiGet<AppSettings>('/settings'),
      apiGet<BrowserCursorCapability>('/browser/cursor-capability'),
      apiGet<AiCredentialStatus>('/settings/ai-credentials'),
      apiGet<{ ollamaModels?: string[] }>('/settings/ai-models').catch(() => ({ ollamaModels: [] })),
    ])
      .then(([nextSettings, nextCapability, nextCredentials, models]) => {
        setSettings(nextSettings);
        setCursorCapability(nextCapability);
        setCredentialStatus(nextCredentials);
        setOllamaModels(models.ollamaModels ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(load, []);

  async function save(nextSettings: AppSettings) {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      setSettings(await apiSend<AppSettings>('/settings', 'PATCH', nextSettings));
      setCursorCapability(await apiGet<BrowserCursorCapability>('/browser/cursor-capability'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function testCursor() {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      setCursorTest(await apiSend<BrowserCursorTestResult>('/browser/test-cursor', 'POST'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function aiAction(path: string, label: string) {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await apiSend<Record<string, unknown>>(path, 'POST', {});
      setMessage(formatAiActionMessage(label, result));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveApiKey() {
    if (!['openai', 'xai', 'custom'].includes(aiProvider)) return;
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await apiSend(`/settings/ai-credentials/${aiProvider}`, 'PUT', { apiKey });
      setApiKey('');
      setCredentialStatus(await apiGet<AiCredentialStatus>('/settings/ai-credentials'));
      setMessage(`${providerLabel} API key saved in your macOS Keychain.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeApiKey() {
    if (!['openai', 'xai', 'custom'].includes(aiProvider)) return;
    setBusy(true);
    setError(undefined);
    try {
      await apiSend(`/settings/ai-credentials/${aiProvider}`, 'DELETE');
      setCredentialStatus(await apiGet<AiCredentialStatus>('/settings/ai-credentials'));
      setMessage(`${providerLabel} API key removed from your macOS Keychain.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await apiSend<Record<string, unknown>>('/settings/ai-credentials/test', 'POST');
      setMessage(`${providerLabel} connection test succeeded${result.model ? ` for ${String(result.model)}` : ''}.`);
      if (Array.isArray(result.models)) setOllamaModels(result.models as string[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const aiProvider = settings?.ai.provider ?? 'ollama';
  const curatedModels = aiProvider === 'openai' ? OPENAI_CURATED_MODELS : aiProvider === 'xai' ? XAI_CURATED_MODELS : [];

  if (!settings) {
    return (
      <Card>
        <CardContent>
          <CircularProgress size={24} />
        </CardContent>
      </Card>
    );
  }

  const browser = settings.browser;
  const monitoring = settings.monitoring;
  const ai = settings.ai;
  const providerLabel = aiProvider === 'openai'
    ? 'OpenAI'
    : aiProvider === 'xai'
      ? 'xAI / Grok'
      : aiProvider === 'custom'
        ? (ai.customProviderLabel || 'Custom provider')
        : 'Ollama';

  function updateBrowser(nextBrowser: AppSettings['browser']) {
    if (!settings) return;
    setSettings({ ...settings, browser: nextBrowser });
  }

  function updateMonitoring(nextMonitoring: AppSettings['monitoring']) {
    if (!settings) return;
    setSettings({ ...settings, monitoring: nextMonitoring });
  }

  function updateAi(nextAi: AppSettings['ai']) {
    if (!settings) return;
    setSettings({ ...settings, ai: nextAi });
  }

  const numberField = (
    label: string,
    value: number,
    onChange: (value: number) => void,
    helperText?: string,
    step = 1,
  ) => (
    <TextField
      label={label}
      type="number"
      value={value}
      disabled={busy}
      inputProps={{ step }}
      onChange={(event) => onChange(Number(event.target.value) || 0)}
      onBlur={() => void save(settings)}
      helperText={helperText}
      size="small"
    />
  );

  return (
    <Stack spacing={2}>
      <OperationsSettings />
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h4">Settings</Typography>
            {error ? <Alert severity="error">{error}</Alert> : null}
            {message ? <Alert severity="success">{message}</Alert> : null}
            {cursorCapability ? (
              <Alert severity={cursorCapability.supported ? 'success' : 'warning'}>
                {cursorCapability.message}
                {cursorCapability.command ? ` Command: ${cursorCapability.command}` : ''}
              </Alert>
            ) : null}
            {cursorTest ? (
              <Alert severity={cursorTest.moved ? 'success' : 'error'}>
                {cursorTest.message}
              </Alert>
            ) : null}

            <Typography variant="h6">Permalink Capture</Typography>
            <FormControlLabel
              control={<Switch checked={browser.useRealCursorForPermalinks} disabled={busy} onChange={(event) => void save({ ...settings, browser: { ...browser, useRealCursorForPermalinks: event.target.checked } })} />}
              label="Use real macOS cursor"
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              {numberField('Cursor offset X', browser.realCursorOffsetX, (value) => updateBrowser({ ...browser, realCursorOffsetX: value }), 'Positive moves right')}
              {numberField('Cursor offset Y', browser.realCursorOffsetY, (value) => updateBrowser({ ...browser, realCursorOffsetY: value }), 'Positive moves down')}
              {numberField('Probe limit', browser.permalinkProbeLimit, (value) => updateBrowser({ ...browser, permalinkProbeLimit: value }), 'Links checked per post')}
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              {numberField('Cursor dwell ms', browser.realCursorMoveDurationMs, (value) => updateBrowser({ ...browser, realCursorMoveDurationMs: value }), 'Mouse hover hold time', 50)}
              {numberField('Probe dwell ms', browser.permalinkProbeDwellMs, (value) => updateBrowser({ ...browser, permalinkProbeDwellMs: value }), 'Wait before re-reading href', 50)}
              {numberField('Probe pause ms', browser.permalinkProbePauseMs, (value) => updateBrowser({ ...browser, permalinkProbePauseMs: value }), 'Overlay pause after probe', 50)}
            </Stack>

            <Typography variant="h6">Run Limits</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              {numberField('Max posts', monitoring.baselineMaxPosts, (value) => updateMonitoring({ ...monitoring, baselineMaxPosts: value }), 'Default posts per run')}
              {numberField('Max group seconds', monitoring.baselineMaxGroupDurationSeconds, (value) => updateMonitoring({ ...monitoring, baselineMaxGroupDurationSeconds: value }), 'Per-group time cap')}
              {numberField('Known post stop', monitoring.incrementalConsecutiveKnownPosts, (value) => updateMonitoring({ ...monitoring, incrementalConsecutiveKnownPosts: value }), 'Stop after this many known posts')}
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              {numberField('Scroll delay seconds', monitoring.delayBetweenScrollsSeconds, (value) => updateMonitoring({ ...monitoring, delayBetweenScrollsSeconds: value }), 'Delay after each scroll', 0.1)}
              {numberField('Group delay seconds', monitoring.delayBetweenGroupsSeconds, (value) => updateMonitoring({ ...monitoring, delayBetweenGroupsSeconds: value }), 'Delay between groups', 0.1)}
              {numberField('Incremental max seconds', monitoring.incrementalMaxGroupDurationSeconds, (value) => updateMonitoring({ ...monitoring, incrementalMaxGroupDurationSeconds: value }), 'Future incremental cap')}
            </Stack>

            <Typography variant="h6">AI Analysis</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <FormControlLabel control={<Switch checked={ai.enabled} disabled={busy} onChange={(event) => void save({ ...settings, ai: { ...ai, enabled: event.target.checked } })} />} label="Enable AI" />
              <FormControlLabel control={<Switch checked={ai.autoAnalyse} disabled={busy} onChange={(event) => void save({ ...settings, ai: { ...ai, autoAnalyse: event.target.checked } })} />} label="Auto-analyse scraped posts" />
              {aiProvider === 'ollama' ? (
                <FormControlLabel control={<Switch checked={ai.autoStartOllama} disabled={busy} onChange={(event) => void save({ ...settings, ai: { ...ai, autoStartOllama: event.target.checked } })} />} label="Auto-start Ollama" />
              ) : null}
              <FormControlLabel
                control={<Switch checked={ai.requireRealFacebookPermalink} disabled={busy} onChange={(event) => void save({ ...settings, ai: { ...ai, requireRealFacebookPermalink: event.target.checked } })} />}
                label="Require real permalink for non-fallback posts"
              />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Missing direct Facebook links are a navigation issue, not an AI blocker. Posts without a permalink still run the trigger-phrase prefilter and get a “Search Facebook” link so you can find and paste the real URL later.
            </Typography>

            <Card variant="outlined">
              <CardContent>
                <Stack spacing={1.5}>
                  <Typography variant="subtitle1">Active provider</Typography>
                  <Typography variant="body2" color="text.secondary">
                    One provider is active at a time. The queue uses that provider for newly queued assessments. There is no automatic fallback.
                  </Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField
                      select
                      label="AI provider"
                      size="small"
                      value={aiProvider}
                      disabled={busy}
                      onChange={(event) => void save({ ...settings, ai: { ...ai, provider: event.target.value as AppSettings['ai']['provider'] } })}
                      sx={{ minWidth: 220 }}
                    >
                      <MenuItem value="ollama">Ollama (local)</MenuItem>
                      <MenuItem value="openai">OpenAI</MenuItem>
                      <MenuItem value="xai">xAI / Grok</MenuItem>
                      <MenuItem value="custom">Custom compatible API</MenuItem>
                    </TextField>
                    {numberField('Request timeout seconds', ai.requestTimeoutSeconds, (value) => updateAi({ ...ai, requestTimeoutSeconds: value }), 'Fail one slow AI request after this')}
                    {aiProvider !== 'ollama' ? numberField('Remote concurrency', ai.remoteConcurrency ?? 5, (value) => updateAi({ ...ai, remoteConcurrency: value }), 'Parallel remote API assessments (1-20). Ollama always uses 1.', 1) : null}
                    {numberField('AI post confidence', ai.minExtractionConfidence, (value) => updateAi({ ...ai, minExtractionConfidence: value }), '0.8 = 80%+', 0.05)}
                    {numberField('Min match percent', ai.minMatchPercent, (value) => updateAi({ ...ai, minMatchPercent: value }), 'Hide weak matches below this', 1)}
                    {numberField('Stale AI seconds', ai.staleRunningSeconds, (value) => updateAi({ ...ai, staleRunningSeconds: value }), 'Requeue running jobs older than this')}
                  </Stack>

                  {aiProvider === 'ollama' ? (
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                      <TextField label="Ollama base URL" size="small" value={ai.ollamaBaseUrl} disabled={busy} onChange={(event) => updateAi({ ...ai, ollamaBaseUrl: event.target.value })} onBlur={() => void save(settings)} sx={{ minWidth: 260 }} />
                      {ollamaModels.length > 0 ? (
                        <TextField
                          select
                          label="Installed Ollama model"
                          size="small"
                          value={ollamaModels.includes(ai.ollamaModel) ? ai.ollamaModel : ollamaModels[0]}
                          disabled={busy}
                          onChange={(event) => void save({ ...settings, ai: { ...ai, ollamaModel: event.target.value } })}
                          sx={{ minWidth: 220 }}
                        >
                          {ollamaModels.map((model) => <MenuItem key={model} value={model}>{model}</MenuItem>)}
                        </TextField>
                      ) : null}
                      <TextField
                        label="Local model ID"
                        size="small"
                        value={ai.ollamaModel}
                        disabled={busy}
                        onChange={(event) => updateAi({ ...ai, ollamaModel: event.target.value })}
                        onBlur={() => void save(settings)}
                        sx={{ minWidth: 220 }}
                        helperText="Type any model ID, such as qwen3:8b"
                      />
                    </Stack>
                  ) : null}

                  {aiProvider === 'openai' || aiProvider === 'xai' ? (
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                      <TextField
                        select
                        label={aiProvider === 'openai' ? 'OpenAI model' : 'Grok model'}
                        size="small"
                        value={aiProvider === 'openai' ? ai.openaiModel : ai.xaiModel}
                        disabled={busy}
                        onChange={(event) => void save({
                          ...settings,
                          ai: aiProvider === 'openai'
                            ? { ...ai, openaiModel: event.target.value }
                            : { ...ai, xaiModel: event.target.value },
                        })}
                        sx={{ minWidth: 280 }}
                      >
                        {curatedModels.map((model) => (
                          <MenuItem key={model.id} value={model.id}>
                            {model.label}{model.recommended ? ' · recommended' : ''} · {priceLabel(model)}
                          </MenuItem>
                        ))}
                        <MenuItem value={CUSTOM_MODEL_SENTINEL}>Custom model ID</MenuItem>
                      </TextField>
                      {(aiProvider === 'openai' ? ai.openaiModel : ai.xaiModel) === CUSTOM_MODEL_SENTINEL ? (
                        <TextField
                          label={`Custom ${aiProvider === 'openai' ? 'OpenAI' : 'xAI'} model ID`}
                          size="small"
                          value={aiProvider === 'openai' ? ai.openaiCustomModel : ai.xaiCustomModel}
                          disabled={busy}
                          onChange={(event) => updateAi(
                            aiProvider === 'openai'
                              ? { ...ai, openaiCustomModel: event.target.value }
                              : { ...ai, xaiCustomModel: event.target.value },
                          )}
                          onBlur={() => void save(settings)}
                          sx={{ minWidth: 240 }}
                        />
                      ) : null}
                    </Stack>
                  ) : null}

                  {aiProvider === 'custom' ? (
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                      <TextField label="Provider label" size="small" value={ai.customProviderLabel} disabled={busy} onChange={(event) => updateAi({ ...ai, customProviderLabel: event.target.value })} onBlur={() => void save(settings)} />
                      <TextField label="API base URL" size="small" value={ai.customBaseUrl} disabled={busy} onChange={(event) => updateAi({ ...ai, customBaseUrl: event.target.value })} onBlur={() => void save(settings)} sx={{ minWidth: 280 }} helperText="OpenAI-compatible /v1 base URL" />
                      <TextField label="Model ID" size="small" value={ai.customModel} disabled={busy} onChange={(event) => updateAi({ ...ai, customModel: event.target.value })} onBlur={() => void save(settings)} />
                    </Stack>
                  ) : null}

                  {aiProvider !== 'ollama' ? (
                    <Alert severity="warning">
                      Remote assessments send the Facebook post text and every active referral-member profile to {providerLabel}. ChatGPT Plus is separate from the OpenAI API and does not cover these charges.
                    </Alert>
                  ) : (
                    <Alert severity="info">Local Ollama assessments stay on this Mac. Estimated cost is always $0.</Alert>
                  )}

                  {aiProvider !== 'ollama' ? (
                    <Card variant="outlined">
                      <CardContent>
                        <Stack spacing={1.5}>
                          <Typography variant="subtitle1">{providerLabel} connection</Typography>
                          <Typography variant="body2" color="text.secondary">
                            API keys are stored in your macOS Keychain and are never shown again after saving.
                          </Typography>
                          <Typography variant="body2" color={credentialStatus[aiProvider as keyof AiCredentialStatus] ? 'success.main' : 'warning.main'}>
                            {credentialStatus[aiProvider as keyof AiCredentialStatus] ? 'API key saved in Keychain' : 'No API key saved'}
                          </Typography>
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                            <TextField label="API key" type="password" size="small" value={apiKey} disabled={busy} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" sx={{ minWidth: 320 }} />
                            <Button variant="contained" disabled={busy || apiKey.trim().length < 8} onClick={() => void saveApiKey()}>Save key</Button>
                            {credentialStatus[aiProvider as keyof AiCredentialStatus] ? <Button color="error" disabled={busy} onClick={() => void removeApiKey()}>Remove key</Button> : null}
                            <Button variant="outlined" disabled={busy} onClick={() => void testConnection()}>Test connection</Button>
                          </Stack>
                          {(aiProvider === 'custom' || (aiProvider === 'openai' && ai.openaiModel === CUSTOM_MODEL_SENTINEL) || (aiProvider === 'xai' && ai.xaiModel === CUSTOM_MODEL_SENTINEL)) ? (
                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                              {aiProvider === 'openai' ? <>
                                {numberField('Input USD / 1M', ai.openaiCustomInputCostPerMillion, (value) => updateAi({ ...ai, openaiCustomInputCostPerMillion: value }), 'Used for estimates', 0.01)}
                                {numberField('Cached input USD / 1M', ai.openaiCustomCachedInputCostPerMillion, (value) => updateAi({ ...ai, openaiCustomCachedInputCostPerMillion: value }), 'Used for estimates', 0.01)}
                                {numberField('Output USD / 1M', ai.openaiCustomOutputCostPerMillion, (value) => updateAi({ ...ai, openaiCustomOutputCostPerMillion: value }), 'Used for estimates', 0.01)}
                              </> : null}
                              {aiProvider === 'xai' ? <>
                                {numberField('Input USD / 1M', ai.xaiCustomInputCostPerMillion, (value) => updateAi({ ...ai, xaiCustomInputCostPerMillion: value }), 'Used for estimates', 0.01)}
                                {numberField('Cached input USD / 1M', ai.xaiCustomCachedInputCostPerMillion, (value) => updateAi({ ...ai, xaiCustomCachedInputCostPerMillion: value }), 'Used for estimates', 0.01)}
                                {numberField('Output USD / 1M', ai.xaiCustomOutputCostPerMillion, (value) => updateAi({ ...ai, xaiCustomOutputCostPerMillion: value }), 'Used for estimates', 0.01)}
                              </> : null}
                              {aiProvider === 'custom' ? <>
                                {numberField('Input USD / 1M', ai.customInputCostPerMillion, (value) => updateAi({ ...ai, customInputCostPerMillion: value }), 'Used for estimates', 0.01)}
                                {numberField('Cached input USD / 1M', ai.customCachedInputCostPerMillion, (value) => updateAi({ ...ai, customCachedInputCostPerMillion: value }), 'Used for estimates', 0.01)}
                                {numberField('Output USD / 1M', ai.customOutputCostPerMillion, (value) => updateAi({ ...ai, customOutputCostPerMillion: value }), 'Used for estimates', 0.01)}
                              </> : null}
                            </Stack>
                          ) : null}
                        </Stack>
                      </CardContent>
                    </Card>
                  ) : (
                    <Button variant="outlined" disabled={busy} onClick={() => void testConnection()} sx={{ alignSelf: 'flex-start' }}>Test Ollama connection</Button>
                  )}
                </Stack>
              </CardContent>
            </Card>

            <Card variant="outlined">
              <CardContent>
                <Stack spacing={1.5}>
                  <Typography variant="subtitle1">AI pre-filter</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Cheap local screening before any LLM call. A post is queued only if its text contains at least one phrase below. This cuts cost by skipping adverts and general chat.
                  </Typography>
                  <FormControlLabel
                    control={(
                      <Switch
                        checked={ai.prefilterEnabled ?? true}
                        disabled={busy}
                        onChange={(event) => void save({ ...settings, ai: { ...ai, prefilterEnabled: event.target.checked } })}
                      />
                    )}
                    label="Only queue posts that match a pre-filter phrase"
                  />
                  <TextField
                    label="Pre-filter phrases"
                    value={ai.prefilterPhrases ?? ''}
                    disabled={busy || !(ai.prefilterEnabled ?? true)}
                    multiline
                    minRows={8}
                    onChange={(event) => updateAi({ ...ai, prefilterPhrases: event.target.value })}
                    onBlur={() => void save(settings)}
                    helperText="One phrase per line, or comma-separated. Matching is case-insensitive. Examples: looking for, can anyone, recommend"
                  />
                </Stack>
              </CardContent>
            </Card>

            <TextField
              label="AI prompt template"
              value={ai.promptTemplate}
              disabled={busy}
              multiline
              minRows={12}
              onChange={(event) => updateAi({ ...ai, promptTemplate: event.target.value })}
              onBlur={() => void save(settings)}
            />
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button variant="outlined" disabled={busy} onClick={() => void aiAction('/ai/queue', 'Queued eligible posts')}>Queue eligible posts</Button>
              <Button variant="contained" disabled={busy} onClick={() => void aiAction('/ai/process', 'Processed queue')}>Process queue</Button>
              <Button color="warning" disabled={busy} onClick={() => void aiAction('/ai/rerun-all', 'Queued rerun')}>Rerun current prompt</Button>
            </Stack>

            <Typography variant="h6">Browser</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Chrome channel" size="small" value={browser.chromeChannel} disabled={busy} onChange={(event) => updateBrowser({ ...browser, chromeChannel: event.target.value })} onBlur={() => void save(settings)} />
              {numberField('Page timeout ms', browser.pageLoadTimeoutMs, (value) => updateBrowser({ ...browser, pageLoadTimeoutMs: value }), 'Navigation/load timeout', 500)}
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <FormControlLabel control={<Switch checked={browser.headed} disabled={busy} onChange={(event) => void save({ ...settings, browser: { ...browser, headed: event.target.checked } })} />} label="Headed Chrome" />
              <FormControlLabel control={<Switch checked={browser.saveScreenshotsOnError} disabled={busy} onChange={(event) => void save({ ...settings, browser: { ...browser, saveScreenshotsOnError: event.target.checked } })} />} label="Save screenshots on error" />
              <FormControlLabel control={<Switch checked={browser.saveTracesOnFailure} disabled={busy} onChange={(event) => void save({ ...settings, browser: { ...browser, saveTracesOnFailure: event.target.checked } })} />} label="Save traces on failure" />
            </Stack>
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" onClick={load} disabled={busy}>Refresh</Button>
              <Button variant="contained" onClick={testCursor} disabled={busy || !cursorCapability?.supported}>Test real cursor</Button>
              <Button variant="outlined" color="warning" onClick={() => void save(settings)} disabled={busy}>Save all</Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Typography variant="h6">Raw Settings</Typography>
          <pre>{JSON.stringify(settings, null, 2)}</pre>
        </CardContent>
      </Card>
    </Stack>
  );
}
