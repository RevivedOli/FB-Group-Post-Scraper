import { useEffect, useState } from 'react';
import { Alert, Button, Stack, Typography } from '@mui/material';
import { apiGet, apiSend } from '../api/client';

type Status = { connected:boolean; sourcePosts:number; imported:number; lastSyncAt:string|null; error:string|null };
export function CollectorStatus({ onSync }: { onSync:()=>void }) {
  const [status,setStatus] = useState<Status>();
  const [error,setError] = useState<string>();
  const [busy,setBusy] = useState(false);
  async function load() {
    try { setStatus(await apiGet<Status>('/collector/status')); setError(undefined); }
    catch { setError('Cannot reach the collector handoff. Check that the local API is running.'); }
  }
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 10000); return () => window.clearInterval(timer); }, []);
  async function sync() {
    setBusy(true);
    try { setStatus(await apiSend<Status>('/collector/sync','POST')); setError(undefined); onSync(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Collector handoff failed.'); await load(); }
    finally { setBusy(false); }
  }
  return <Alert severity={error || status?.error ? 'error' : status?.connected ? 'success' : 'info'}>
    <Stack spacing={1}>
      <Typography variant="body2">{error || status?.error || (status?.connected
        ? `Collector connected · ${status.sourcePosts} saved text posts · last handoff ${status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleTimeString() : 'pending'}`
        : 'Waiting for the local collector database.')}</Typography>
      <Typography variant="body2">Saved collector posts are copied into this view every 30 seconds. This reads local data; Facebook collection runs separately in the CLI.</Typography>
      <Button size="small" disabled={busy} onClick={() => void sync()} sx={{ alignSelf:'flex-start' }}>{busy ? 'Updating…' : 'Update from collector'}</Button>
    </Stack>
  </Alert>;
}
