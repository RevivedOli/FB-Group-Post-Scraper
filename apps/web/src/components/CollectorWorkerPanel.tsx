import { useEffect, useState } from 'react';
import { Alert, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import { apiGet, apiSend } from '../api/client';
type Worker = {startedAt:string|null;finishedAt:string|null;state:string;mode:string;currentGroup:string|null;accountId:string|null;profileId:string|null;completed:number;total:number;events:{type:string;name?:string;status?:string;message?:string;reason?:string;at:string;result?:{posts_fetched?:number;new_posts?:number;pages?:number;sample_posts?:number;stop_reason?:string}}[]};
export function CollectorWorkerPanel() {
  const [worker,setWorker]=useState<Worker>();
  const [error,setError]=useState<string>();
  const [busy,setBusy]=useState(false);
  const [age,setAge]=useState('7'),[pages,setPages]=useState('5'),[limit,setLimit]=useState('50');
  async function load() { try {setWorker(await apiGet<Worker>('/collector/worker'));} catch {setError('Cannot reach the collector worker.');} }
  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),2000);return()=>window.clearInterval(timer);},[]);
  async function start(mode:'test'|'run') {
    setBusy(true);setError(undefined);
    try {setWorker(await apiSend<Worker>('/collector/worker/start','POST',{mode,maxAgeHours:Number(age),maxPages:Number(pages),limit:Number(limit)}));}
    catch(err){setError(err instanceof Error?err.message:String(err));}finally{setBusy(false);}
  }
  const running=worker?.state==='running'||worker?.state==='stopping';
  return <Card><CardContent><Stack spacing={2}>
    <Typography variant="h5">Collector — one group at a time</Typography>
    <Typography>Use your saved collector login. Test access first, then collect enabled groups. New text posts flow through the phrase filter and AI queue using your existing settings.</Typography>
    <Typography color="text.secondary">Uses the request, page and group pause ranges, shuffle option and time budget saved in Settings. Named group URLs currently need a numeric group ID. An access test checks a small sample; it does not save that sample as collected posts.</Typography>
    <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
      <TextField size="small" label="Look back (hours)" type="number" value={age} disabled={running} onChange={e=>setAge(e.target.value)} sx={{width:170}} />
      <TextField size="small" label="Max pages / group" type="number" value={pages} disabled={running} onChange={e=>setPages(e.target.value)} sx={{width:170}} />
      <TextField size="small" label="Max posts / group" type="number" value={limit} disabled={running} onChange={e=>setLimit(e.target.value)} sx={{width:170}} />
    </Stack>
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      <Button variant="outlined" disabled={busy||running} onClick={()=>void start('test')}>Test Enabled Groups</Button>
      <Button variant="contained" disabled={busy||running} onClick={()=>void start('run')}>Collect Enabled Groups</Button>
      <Button disabled={!running||busy} onClick={()=>void apiSend<Worker>('/collector/worker/stop','POST').then(setWorker).catch(err=>setError(String(err)))}>Stop</Button>
    </Stack>
    {error&&<Alert severity="error">{error}</Alert>}
    <Typography>Status: {worker?.state ?? 'loading'} · {worker?.completed ?? 0}/{worker?.total ?? 0} groups · {worker?.currentGroup ?? 'Idle'}</Typography>
    {worker?.startedAt&&<Typography variant="body2">Started {new Date(worker.startedAt).toLocaleString('en-GB')} · Ended {worker.finishedAt?new Date(worker.finishedAt).toLocaleString('en-GB'):'In progress'} · Duration {Math.floor(((worker.finishedAt?Date.parse(worker.finishedAt):Date.now())-Date.parse(worker.startedAt))/60000)}m {Math.floor(((worker.finishedAt?Date.parse(worker.finishedAt):Date.now())-Date.parse(worker.startedAt))/1000)%60}s</Typography>}
    {worker?.accountId&&<Typography>Collector login: {worker.accountId} · Facebook profile: {worker.profileId ?? 'unknown'}</Typography>}
    {worker?.events.slice(0,20).map((event,index)=><Typography key={`${event.at}-${index}`} variant="body2">
      {new Date(event.at).toLocaleTimeString()} · {event.name ? `${event.name}: ` : ''}{event.status ?? event.reason ?? event.type}
      {event.message ? ` — ${event.message}` : ''}
      {event.result ? ` · posts ${event.result.posts_fetched ?? event.result.sample_posts ?? 0} · pages ${event.result.pages ?? 1} · new ${event.result.new_posts ?? 0}${event.result.stop_reason ? ` · ${event.result.stop_reason}` : ''}` : ''}
    </Typography>)}
  </Stack></CardContent></Card>;
}
