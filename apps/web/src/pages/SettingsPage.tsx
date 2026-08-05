import { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, CircularProgress, FormControlLabel, Slider, Stack, Switch, TextField, Typography } from '@mui/material';
import type { AppSettings, BrowserCursorCapability, BrowserCursorTestResult } from '@local-group-monitor/shared';
import { apiGet, apiSend } from '../api/client';

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>();
  const [cursorCapability, setCursorCapability] = useState<BrowserCursorCapability>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [cursorTest, setCursorTest] = useState<BrowserCursorTestResult>();

  const load = () => {
    setError(undefined);
    Promise.all([
      apiGet<AppSettings>('/settings'),
      apiGet<BrowserCursorCapability>('/browser/cursor-capability'),
    ])
      .then(([nextSettings, nextCapability]) => {
        setSettings(nextSettings);
        setCursorCapability(nextCapability);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(load, []);

  async function save(nextSettings: AppSettings) {
    setBusy(true);
    setError(undefined);
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
    try {
      setCursorTest(await apiSend<BrowserCursorTestResult>('/browser/test-cursor', 'POST'));
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

  function updateBrowser(nextBrowser: AppSettings['browser']) {
    if (!settings) return;
    setSettings({ ...settings, browser: nextBrowser });
  }

  function updateMonitoring(nextMonitoring: AppSettings['monitoring']) {
    if (!settings) return;
    setSettings({ ...settings, monitoring: nextMonitoring });
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
