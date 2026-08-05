import { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, CircularProgress, FormControlLabel, MenuItem, Slider, Stack, Switch, TextField, Typography } from '@mui/material';
import type { AppSettings, BrowserCursorCapability, BrowserCursorTestResult } from '@local-group-monitor/shared';
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

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>();
  const [cursorCapability, setCursorCapability] = useState<BrowserCursorCapability>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [cursorTest, setCursorTest] = useState<BrowserCursorTestResult>();
  const [credentialStatus, setCredentialStatus] = useState<Record<string, boolean>>({});
  const [apiKey, setApiKey] = useState('');

  const load = () => {
    setError(undefined);
    Promise.all([
      apiGet<AppSettings>('/settings'),
      apiGet<BrowserCursorCapability>('/browser/cursor-capability'),
      apiGet<Record<string, boolean>>('/settings/ai-credentials'),
    ])
      .then(([nextSettings, nextCapability, nextCredentials]) => {
        setSettings(nextSettings);
        setCursorCapability(nextCapability);
        setCredentialStatus(nextCredentials);
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
      setCredentialStatus(await apiGet<Record<string, boolean>>('/settings/ai-credentials'));
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
      setCredentialStatus(await apiGet<Record<string, boolean>>('/settings/ai-credentials'));
      setMessage(`${providerLabel} API key removed from your macOS Keychain.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

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
  const aiProvider = ai.provider ?? 'ollama';
  const providerLabel = aiProvider === 'openai' ? 'OpenAI' : aiProvider === 'xai' ? 'xAI / Grok' : aiProvider === 'custom' ? (ai.customProviderLabel || 'Custom provider') : 'Ollama';

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
              <FormControlLabel control={<Switch checked={ai.autoStartOllama} disabled={busy} onChange={(event) => void save({ ...settings, ai: { ...ai, autoStartOllama: event.target.checked } })} />} label="Auto-start Ollama" />
              <FormControlLabel control={<Switch checked={ai.requireRealFacebookPermalink} disabled={busy} onChange={(event) => void save({ ...settings, ai: { ...ai, requireRealFacebookPermalink: event.target.checked } })} />} label="Require real permalink" />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField select label="AI provider" size="small" value={aiProvider} disabled={busy} onChange={(event) => void save({ ...settings, ai: { ...ai, provider: event.target.value as AppSettings['ai']['provider'] } })} sx={{ minWidth: 180 }}>
                <MenuItem value="ollama">Ollama (local)</MenuItem>
                <MenuItem value="openai">OpenAI</MenuItem>
                <MenuItem value="xai">xAI / Grok</MenuItem>
                <MenuItem value="custom">Custom compatible API</MenuItem>
              </TextField>
              {aiProvider === 'ollama' ? <>
                <TextField label="Ollama base URL" size="small" value={ai.ollamaBaseUrl} disabled={busy} onChange={(event) => updateAi({ ...ai, ollamaBaseUrl: event.target.value })} onBlur={() => void save(settings)} sx={{ minWidth: 260 }} />
                <TextField label="Local model" size="small" value={ai.ollamaModel} disabled={busy} onChange={(event) => updateAi({ ...ai, ollamaModel: event.target.value })} onBlur={() => void save(settings)} sx={{ minWidth: 180 }} />
              </> : null}
              {aiProvider === 'openai' ? <TextField select label="OpenAI model" size="small" value={ai.openaiModel} disabled={busy} onChange={(event) => void save({ ...settings, ai: { ...ai, openaiModel: event.target.value } })} sx={{ minWidth: 220 }}>
                <MenuItem value="gpt-5.6-luna">GPT-5.6 Luna - efficient</MenuItem>
                <MenuItem value="gpt-5.4-nano">GPT-5.4 nano - lowest cost</MenuItem>
                <MenuItem value="gpt-5.6-terra">GPT-5.6 Terra - balanced</MenuItem>
                <MenuItem value="gpt-5.6-sol">GPT-5.6 Sol - highest quality</MenuItem>
                <MenuItem value="__custom__">Custom OpenAI model ID</MenuItem>
              </TextField> : null}
              {aiProvider === 'openai' && ai.openaiModel === '__custom__' ? <TextField label="Custom OpenAI model ID" size="small" value={ai.openaiCustomModel} disabled={busy} onChange={(event) => updateAi({ ...ai, openaiCustomModel: event.target.value })} onBlur={() => void save(settings)} sx={{ minWidth: 220 }} /> : null}
              {aiProvider === 'xai' ? <TextField select label="Grok model" size="small" value={ai.xaiModel} disabled={busy} onChange={(event) => void save({ ...settings, ai: { ...ai, xaiModel: event.target.value } })} sx={{ minWidth: 220 }}>
                <MenuItem value="grok-4.5">Grok 4.5 - quality</MenuItem>
                <MenuItem value="__custom__">Custom xAI model ID</MenuItem>
              </TextField> : null}
              {aiProvider === 'xai' && ai.xaiModel === '__custom__' ? <TextField label="Custom xAI model ID" size="small" value={ai.xaiCustomModel} disabled={busy} onChange={(event) => updateAi({ ...ai, xaiCustomModel: event.target.value })} onBlur={() => void save(settings)} sx={{ minWidth: 220 }} /> : null}
              {aiProvider === 'custom' ? <>
                <TextField label="Provider label" size="small" value={ai.customProviderLabel} disabled={busy} onChange={(event) => updateAi({ ...ai, customProviderLabel: event.target.value })} onBlur={() => void save(settings)} />
                <TextField label="API base URL" size="small" value={ai.customBaseUrl} disabled={busy} onChange={(event) => updateAi({ ...ai, customBaseUrl: event.target.value })} onBlur={() => void save(settings)} sx={{ minWidth: 260 }} />
                <TextField label="Model ID" size="small" value={ai.customModel} disabled={busy} onChange={(event) => updateAi({ ...ai, customModel: event.target.value })} onBlur={() => void save(settings)} />
              </> : null}
              {numberField('AI post confidence', ai.minExtractionConfidence, (value) => updateAi({ ...ai, minExtractionConfidence: value }), '0.8 = 80%+', 0.05)}
              {numberField('Min match percent', ai.minMatchPercent, (value) => updateAi({ ...ai, minMatchPercent: value }), 'Hide weak matches below this', 1)}
              {numberField('Stale AI seconds', ai.staleRunningSeconds, (value) => updateAi({ ...ai, staleRunningSeconds: value }), 'Requeue running jobs older than this')}
              {numberField('Ollama timeout seconds', ai.ollamaRequestTimeoutSeconds, (value) => updateAi({ ...ai, ollamaRequestTimeoutSeconds: value }), 'Fail one slow AI request after this')}
            </Stack>
            {aiProvider !== 'ollama' ? <Card variant="outlined"><CardContent><Stack spacing={1.5}>
              <Typography variant="subtitle1">{providerLabel} connection</Typography>
              <Typography variant="body2" color="text.secondary">Remote assessments send the post and a short list of locally selected referral candidates to {providerLabel}. Keys are stored in your macOS Keychain and are never shown again.</Typography>
              <Typography variant="body2" color={credentialStatus[aiProvider] ? 'success.main' : 'warning.main'}>{credentialStatus[aiProvider] ? 'API key saved in Keychain' : 'No API key saved'}</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField label="API key" type="password" size="small" value={apiKey} disabled={busy} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" sx={{ minWidth: 320 }} />
                <Button variant="contained" disabled={busy || apiKey.trim().length < 8} onClick={() => void saveApiKey()}>Save key</Button>
                {credentialStatus[aiProvider] ? <Button color="error" disabled={busy} onClick={() => void removeApiKey()}>Remove key</Button> : null}
              </Stack>
              {aiProvider === 'custom' ? <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                {numberField('Input USD / 1M tokens', ai.customInputCostPerMillion, (value) => updateAi({ ...ai, customInputCostPerMillion: value }), 'Used for estimates', 0.01)}
                {numberField('Output USD / 1M tokens', ai.customOutputCostPerMillion, (value) => updateAi({ ...ai, customOutputCostPerMillion: value }), 'Used for estimates', 0.01)}
              </Stack> : null}
            </Stack></CardContent></Card> : null}
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
