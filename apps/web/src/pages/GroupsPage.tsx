import { useEffect, useState } from 'react';
import { Alert, Button, Card, CardContent, Chip, Stack, TextField, Typography } from '@mui/material';
import { apiGet, apiSend } from '../api/client';

interface Group {
  id:string; friendlyName:string; canonicalGroupUrl:string; enabled:boolean; baselineStatus:string;
  baselineCompletedAt?:string|null; lastTestStatus?:string|null; lastTestedAt?:string|null; lastSuccessfulMonitorAt?:string|null; lastErrorMessage?:string|null;
  maxPostsPerRun?:number|null; maxScrollActions?:number|null; maxGroupDurationSeconds?:number|null;
}

interface LimitDraft {
  maxPostsPerRun:string;
  maxScrollActions:string;
  maxGroupDurationSeconds:string;
}

function draftFromGroup(group: Group): LimitDraft {
  return {
    maxPostsPerRun: group.maxPostsPerRun?.toString() ?? '',
    maxScrollActions: group.maxScrollActions?.toString() ?? '',
    maxGroupDurationSeconds: group.maxGroupDurationSeconds?.toString() ?? '',
  };
}

function nullableNumber(value: string) {
  const trimmed = value.trim();
  return trimmed === '' ? null : Number(trimmed);
}

export function GroupsPage(){
const [groups,setGroups]=useState<Group[]>([]); const [drafts,setDrafts]=useState<Record<string,LimitDraft>>({}); const [url,setUrl]=useState(''); const [name,setName]=useState(''); const [busy,setBusy]=useState<string>(); const [message,setMessage]=useState<string>(); const [error,setError]=useState<string>();
const load=()=>apiGet<Group[]>('/groups').then(nextGroups=>{setGroups(nextGroups); setDrafts(Object.fromEntries(nextGroups.map(group=>[group.id,draftFromGroup(group)])));}).catch(()=>setGroups([]));
useEffect(()=>{void load();},[]);
async function add(){await apiSend('/groups','POST',{facebookGroupUrl:url,friendlyName:name}); setUrl(''); setName(''); void load();}
async function action(group:Group,kind:'test'|'run'){setBusy(`${kind}:${group.id}`); setError(undefined); setMessage(undefined); try{const result=await apiSend<any>(`/groups/${group.id}/${kind}`,'POST'); setMessage(kind==='test'?`Test result: ${result.status}`:`Run result: ${result.run?.status ?? 'complete'} · posts ${result.postsInspected ?? 0} · new ${result.newPostsSaved ?? 0}`); await load();}catch(err){setError(err instanceof Error ? err.message : String(err));}finally{setBusy(undefined);}}
async function saveLimits(group:Group){const draft=drafts[group.id]??draftFromGroup(group); setBusy(`limits:${group.id}`); setError(undefined); try{await apiSend(`/groups/${group.id}`,'PATCH',{maxPostsPerRun:nullableNumber(draft.maxPostsPerRun),maxScrollActions:nullableNumber(draft.maxScrollActions),maxGroupDurationSeconds:nullableNumber(draft.maxGroupDurationSeconds)}); setMessage('Crawl limits saved.'); await load();}catch(err){setError(err instanceof Error ? err.message : String(err));}finally{setBusy(undefined);}}
async function clearData(group:Group){if(!window.confirm(`Delete collected posts and run history for ${group.friendlyName}? The group will stay configured.`)) return; setBusy(`clear:${group.id}`); setError(undefined); setMessage(undefined); try{const result=await apiSend<any>(`/groups/${group.id}/clear-data`,'POST'); setMessage(`Cleared ${result.deletedPosts ?? 0} post(s), ${result.deletedRuns ?? 0} run(s), and ${result.deletedEvents ?? 0} event(s).`); await load();}catch(err){setError(err instanceof Error ? err.message : String(err));}finally{setBusy(undefined);}}
async function markRebaseline(group:Group){setBusy(`rebaseline:${group.id}`); setError(undefined); setMessage(undefined); try{await apiSend(`/groups/${group.id}/rebaseline`,'POST'); setMessage(`${group.friendlyName} will run as a baseline next time.`); await load();}catch(err){setError(err instanceof Error ? err.message : String(err));}finally{setBusy(undefined);}}
async function removeGroup(group:Group){if(!window.confirm(`Delete ${group.friendlyName} and its collected posts?`)) return; setBusy(`delete:${group.id}`); setError(undefined); setMessage(undefined); try{await apiSend(`/groups/${group.id}`,'DELETE'); setMessage('Group deleted.'); await load();}catch(err){setError(err instanceof Error ? err.message : String(err));}finally{setBusy(undefined);}}
function setLimit(groupId:string,key:keyof LimitDraft,value:string){setDrafts(current=>({...current,[groupId]:{...(current[groupId]??{maxPostsPerRun:'',maxScrollActions:'',maxGroupDurationSeconds:''}),[key]:value}}));}
return <Stack spacing={3}><Typography variant="h4">Groups</Typography>{message&&<Alert severity="success">{message}</Alert>}{error&&<Alert severity="error">{error}</Alert>}<Card><CardContent><Stack spacing={2}><TextField label="Facebook group URL" value={url} onChange={e=>setUrl(e.target.value)}/><TextField label="Friendly name" value={name} onChange={e=>setName(e.target.value)}/><Button variant="contained" onClick={add}>Add Group</Button></Stack></CardContent></Card>{groups.map(g=>{const draft=drafts[g.id]??draftFromGroup(g); const isBaselineRun=['never_scanned','needs_rebaseline','baseline_failed'].includes(g.baselineStatus); return <Card key={g.id}><CardContent><Stack spacing={1.5}><Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap><Typography variant="h6">{g.friendlyName}</Typography><Chip size="small" label={g.enabled?'Enabled':'Disabled'}/><Chip size="small" label={`Access: ${g.lastTestStatus ?? 'untested'}`} color={g.lastTestStatus==='accessible'?'success':g.lastTestStatus?'warning':'default'}/></Stack><Typography>{g.canonicalGroupUrl}</Typography><Typography color="text.secondary">Baseline: {g.baselineStatus}{g.baselineCompletedAt ? ` (${new Date(g.baselineCompletedAt).toLocaleString()})` : ''} · Last test: {g.lastTestedAt ? new Date(g.lastTestedAt).toLocaleString() : 'Never'} · Last run: {g.lastSuccessfulMonitorAt ? new Date(g.lastSuccessfulMonitorAt).toLocaleString() : 'Never'}</Typography>{g.lastErrorMessage&&<Typography color="error">{g.lastErrorMessage}</Typography>}<Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap><TextField size="small" type="number" label="Max posts" value={draft.maxPostsPerRun} onChange={e=>setLimit(g.id,'maxPostsPerRun',e.target.value)} sx={{width:130}}/><TextField size="small" type="number" label="Max scrolls" value={draft.maxScrollActions} onChange={e=>setLimit(g.id,'maxScrollActions',e.target.value)} sx={{width:130}}/><TextField size="small" type="number" label="Max seconds" value={draft.maxGroupDurationSeconds} onChange={e=>setLimit(g.id,'maxGroupDurationSeconds',e.target.value)} sx={{width:140}}/><Button disabled={Boolean(busy)} onClick={()=>void saveLimits(g)}>{busy===`limits:${g.id}`?'Saving...':'Save Limits'}</Button></Stack><Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap><Button variant="outlined" disabled={Boolean(busy)} onClick={()=>void action(g,'test')}>{busy===`test:${g.id}`?'Testing...':'Test Access'}</Button><Button variant="contained" disabled={Boolean(busy)||!g.enabled} onClick={()=>void action(g,'run')}>{busy===`run:${g.id}`?'Running...':isBaselineRun?'Run Baseline':'Run Group'}</Button><Button color="secondary" disabled={Boolean(busy)} onClick={()=>void markRebaseline(g)}>{busy===`rebaseline:${g.id}`?'Marking...':'Rebaseline Next'}</Button><Button color="warning" disabled={Boolean(busy)} onClick={()=>void clearData(g)}>{busy===`clear:${g.id}`?'Clearing...':'Clear Data'}</Button><Button color="error" disabled={Boolean(busy)} onClick={()=>void removeGroup(g)}>{busy===`delete:${g.id}`?'Deleting...':'Delete Group'}</Button></Stack></Stack></CardContent></Card>})}</Stack>}
