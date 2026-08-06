import { useEffect, useState } from 'react';
import type { BrowserSessionStatus, RunEventRecord, RunStartOptions, RunSummary } from '@local-group-monitor/shared';
import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Stack,
  Typography,
} from '@mui/material';
import { apiGet, apiSend } from '../api/client';

function loginLabel(status?: BrowserSessionStatus) {
  if (!status?.lastLoginCheckAt) return 'Not checked';
  return status.loggedIn ? 'Logged in' : 'Login needed';
}

export function DashboardPage() {
  const [status, setStatus] = useState<BrowserSessionStatus>();
  const [summary, setSummary] = useState<RunSummary>();
  const [events, setEvents] = useState<RunEventRecord[]>([]);
  const [busy, setBusy] = useState<string>();
  const [cancelRequested, setCancelRequested] = useState(false);
  const [error, setError] = useState<string>();
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [startOptions, setStartOptions] = useState<RunStartOptions>();

  const load = () => Promise.all([
    apiGet<BrowserSessionStatus>('/browser/status'),
    apiGet<RunSummary>('/runs/summary'),
    apiGet<RunEventRecord[]>('/runs/events'),
  ]).then(([browserStatus, runSummary, runEvents]) => {
    setStatus(browserStatus);
    setSummary(runSummary);
    setEvents(runEvents);
    if (runSummary.runStatus !== 'running') setCancelRequested(false);
  }).catch((err) => setError(err instanceof Error ? err.message : String(err)));

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (summary?.runStatus !== 'running') return;
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [summary?.runStatus]);

  async function run(action: string) {
    setBusy(action);
    setError(undefined);
    try {
      setStatus(await apiSend<BrowserSessionStatus>(`/browser/${action}`, 'POST'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await load();
    } finally {
      setBusy(undefined);
    }
  }

  async function openRunDialog() {
    setBusy('run-options');
    setError(undefined);
    try {
      setStartOptions(await apiGet<RunStartOptions>('/runs/start-options'));
      setRunDialogOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  async function startRun(mode: 'all' | 'remaining') {
    setBusy('run-enabled');
    setCancelRequested(false);
    setError(undefined);
    try {
      await apiSend('/runs/start', 'POST', { mode });
      setRunDialogOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await load();
    } finally {
      setBusy(undefined);
    }
  }

  async function cancelRun() {
    setBusy('cancel-run');
    setCancelRequested(true);
    setError(undefined);
    try {
      await apiSend('/runs/cancel', 'POST');
      await load();
    } catch (err) {
      setCancelRequested(false);
      setError(err instanceof Error ? err.message : String(err));
      await load();
    } finally {
      setBusy(undefined);
    }
  }

  const isRunning = summary?.runStatus === 'running';
  const remainingCount = startOptions?.remainingCount ?? summary?.remainingGroups ?? 0;
  const enabledCount = startOptions?.enabledCount ?? summary?.totalGroups ?? 0;
  const remainingPreview = (startOptions?.remainingGroups ?? []).slice(0, 8);
  const cards: Array<[string, string]> = [
    ['Run status', summary?.runStatus ?? 'Loading'],
    ['Current group', summary?.currentGroup ?? 'Loading'],
    ['Groups completed', `${summary?.groupsCompleted ?? 0}/${summary?.totalGroups ?? 0}`],
    ['Posts inspected', String(summary?.postsInspected ?? 0)],
    ['New posts saved', String(summary?.newPostsSaved ?? 0)],
    ['Scrolls', String(summary?.scrollActions ?? 0)],
    ['Warnings', String(summary?.warnings ?? 0)],
  ];

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
        <Typography variant="h4">Dashboard</Typography>
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            disabled={Boolean(busy) || isRunning || cancelRequested}
            onClick={() => void openRunDialog()}
          >
            {busy === 'run-options' || busy === 'run-enabled' ? 'Starting...' : 'Run Enabled Groups'}
          </Button>
          <Button
            color="warning"
            disabled={Boolean(busy) || !isRunning || cancelRequested}
            onClick={() => void cancelRun()}
          >
            {busy === 'cancel-run' || cancelRequested ? 'Stopping...' : 'Stop Run'}
          </Button>
        </Stack>
      </Stack>

      <Grid container spacing={2}>
        {cards.map(([label, value]) => (
          <Grid item xs={12} md={4} key={label}>
            <Card>
              <CardContent>
                <Typography color="text.secondary">{label}</Typography>
                <Typography variant="h5">{value}</Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="h6">Browser Session</Typography>
              <Chip size="small" label={status?.state ?? 'Loading'} color={status?.isOpen ? 'success' : 'default'} />
              <Chip size="small" label={loginLabel(status)} color={status?.loggedIn ? 'success' : 'warning'} />
            </Stack>
            {error && <Alert severity="error">{error}</Alert>}
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button variant="contained" disabled={Boolean(busy)} onClick={() => void run('open-login')}>
                {busy === 'open-login' ? 'Opening...' : 'Open Facebook Login'}
              </Button>
              <Button disabled={Boolean(busy)} onClick={() => void run('check-login')}>
                {busy === 'check-login' ? 'Checking...' : 'Check Login'}
              </Button>
              <Button disabled={Boolean(busy)} onClick={() => void run('open-home')}>Facebook Home</Button>
              <Button disabled={Boolean(busy) || !status?.isOpen} onClick={() => void run('close')}>Close Browser</Button>
            </Stack>
            <Typography color="text.secondary">Profile: {status?.profileDirectory ?? 'Loading'}</Typography>
            {status?.currentUrl && <Typography color="text.secondary">Current URL: {status.currentUrl}</Typography>}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">Live Activity</Typography>
            {events.length === 0 ? (
              <Typography color="text.secondary">No run events yet.</Typography>
            ) : events.map((event) => (
              <Stack key={event.id} spacing={0.5}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip size="small" label={event.level} color={event.level === 'error' ? 'error' : event.level === 'warn' ? 'warning' : 'default'} />
                  <Typography color="text.secondary">{new Date(event.createdAt).toLocaleString()}</Typography>
                </Stack>
                <Typography>{event.message}</Typography>
              </Stack>
            ))}
          </Stack>
        </CardContent>
      </Card>

      <Dialog open={runDialogOpen} onClose={() => setRunDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Run Enabled Groups</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography>
              Choose whether to resume groups that still need a successful run, or process every enabled group again.
            </Typography>

            <Card variant="outlined">
              <CardContent>
                <Stack spacing={1}>
                  <Typography variant="subtitle1">Not completed yet ({remainingCount})</Typography>
                  <Typography color="text.secondary">
                    {remainingCount === 0
                      ? 'All enabled groups already completed successfully since the last full run.'
                      : `Skip groups that finished since the last “Run all” (${enabledCount - remainingCount} done).`}
                  </Typography>
                  {remainingPreview.length > 0 && (
                    <Typography variant="body2" color="text.secondary">
                      Next up: {remainingPreview.map((group) => group.friendlyName).join(', ')}
                      {remainingCount > remainingPreview.length ? ` (+${remainingCount - remainingPreview.length} more)` : ''}
                    </Typography>
                  )}
                  <Button
                    variant="contained"
                    disabled={Boolean(busy) || remainingCount === 0}
                    onClick={() => void startRun('remaining')}
                  >
                    {busy === 'run-enabled' ? 'Starting...' : `Run ${remainingCount} incomplete group(s)`}
                  </Button>
                </Stack>
              </CardContent>
            </Card>

            <Card variant="outlined">
              <CardContent>
                <Stack spacing={1}>
                  <Typography variant="subtitle1">All enabled groups ({enabledCount})</Typography>
                  <Typography color="text.secondary">
                    Run every enabled group from the start, including ones that already completed.
                  </Typography>
                  <Button
                    variant="outlined"
                    disabled={Boolean(busy) || enabledCount === 0}
                    onClick={() => void startRun('all')}
                  >
                    {busy === 'run-enabled' ? 'Starting...' : `Run all ${enabledCount} group(s)`}
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRunDialogOpen(false)}>Cancel</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
