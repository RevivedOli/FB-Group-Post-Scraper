import { useEffect, useState } from 'react';
import type { ReferralDirectoryResponse } from '@local-group-monitor/shared';
import { Alert, Button, Card, CardContent, Chip, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import { apiGet, apiSend } from '../api/client';

interface ReferralMember {
  id: string;
  name: string;
  businessName?: string | null;
  category: string;
  keywords: string;
  notes?: string | null;
  active: boolean;
}

interface ReferralMatch {
  id: string;
  score: number;
  matchedKeywords?: string[];
  status: string;
  referralMember: ReferralMember;
  post: {
    latestCapturedText?: string | null;
    canonicalPostUrl: string;
    authorName?: string | null;
    group?: { friendlyName: string };
  };
}

interface MatchResponse {
  items: ReferralMatch[];
  total: number;
}

const emptyDraft = { name: '', businessName: '', category: '', keywords: '', notes: '' };

export function ReferralDirectoryPage(){
const [members,setMembers]=useState<ReferralMember[]>([]); const [matches,setMatches]=useState<ReferralMatch[]>([]); const [matchTotal,setMatchTotal]=useState(0); const [matchStatus,setMatchStatus]=useState('suggested'); const [counts,setCounts]=useState<ReferralDirectoryResponse['matchCounts']>(); const [draft,setDraft]=useState(emptyDraft); const [busy,setBusy]=useState<string>(); const [message,setMessage]=useState<string>(); const [error,setError]=useState<string>();
const loadDirectory=()=>apiGet<ReferralDirectoryResponse>('/referrals').then(result=>{setMembers(result.members as ReferralMember[]); setCounts(result.matchCounts);}).catch(err=>setError(err instanceof Error ? err.message : String(err)));
const loadMatches=()=>apiGet<MatchResponse>(`/referrals/matches?status=${matchStatus}`).then(result=>{setMatches(result.items); setMatchTotal(result.total);}).catch(err=>setError(err instanceof Error ? err.message : String(err)));
useEffect(()=>{void loadDirectory();},[]);
useEffect(()=>{void loadMatches();},[matchStatus]);
async function addMember(){setBusy('add'); setMessage(undefined); setError(undefined); try{await apiSend('/referrals','POST',draft); setDraft(emptyDraft); setMessage('Referral member added.'); await loadDirectory();}catch(err){setError(err instanceof Error ? err.message : String(err));}finally{setBusy(undefined);}}
async function toggleMember(member:ReferralMember){setBusy(member.id); setMessage(undefined); setError(undefined); try{await apiSend(`/referrals/${member.id}`,'PATCH',{active:!member.active}); await loadDirectory();}catch(err){setError(err instanceof Error ? err.message : String(err));}finally{setBusy(undefined);}}
async function removeMember(member:ReferralMember){if(!window.confirm(`Delete ${member.name} from the referral directory?`)) return; setBusy(member.id); setMessage(undefined); setError(undefined); try{await apiSend(`/referrals/${member.id}`,'DELETE'); setMessage('Referral member deleted.'); await loadDirectory(); await loadMatches();}catch(err){setError(err instanceof Error ? err.message : String(err));}finally{setBusy(undefined);}}
async function generateMatches(){setBusy('generate'); setMessage(undefined); setError(undefined); try{const result=await apiSend<{created:number;updated:number}>('/referrals/matches/generate','POST'); setMessage(`Generated ${result.created} new match(es), updated ${result.updated}.`); await loadDirectory(); await loadMatches();}catch(err){setError(err instanceof Error ? err.message : String(err));}finally{setBusy(undefined);}}
async function updateMatch(match:ReferralMatch,status:string){setBusy(match.id); setMessage(undefined); setError(undefined); try{await apiSend(`/referrals/matches/${match.id}`,'PATCH',{status}); setMessage(`Match ${status}.`); await loadDirectory(); await loadMatches();}catch(err){setError(err instanceof Error ? err.message : String(err));}finally{setBusy(undefined);}}
return <Stack spacing={3}><Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap><Typography variant="h4">Referral Directory</Typography><Button variant="contained" disabled={busy==='generate'||members.length===0} onClick={()=>void generateMatches()}>{busy==='generate'?'Matching...':'Generate Matches'}</Button></Stack>{message&&<Alert severity="success">{message}</Alert>}{error&&<Alert severity="error">{error}</Alert>}<Card><CardContent><Stack spacing={2}><Typography variant="h6">Add Referral Member</Typography><Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap><TextField size="small" label="Name" value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})}/><TextField size="small" label="Business" value={draft.businessName} onChange={event=>setDraft({...draft,businessName:event.target.value})}/><TextField size="small" label="Category" value={draft.category} onChange={event=>setDraft({...draft,category:event.target.value})}/><TextField size="small" label="Keywords" value={draft.keywords} onChange={event=>setDraft({...draft,keywords:event.target.value})} sx={{minWidth:280}}/><TextField size="small" label="Notes" value={draft.notes} onChange={event=>setDraft({...draft,notes:event.target.value})}/><Button variant="contained" disabled={busy==='add'} onClick={()=>void addMember()}>{busy==='add'?'Adding...':'Add'}</Button></Stack></Stack></CardContent></Card><Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap><Chip label={`${members.length} member(s)`}/><Chip label={`${counts?.suggested ?? 0} suggested`}/><Chip label={`${counts?.accepted ?? 0} accepted`} color="success"/><Chip label={`${counts?.dismissed ?? 0} dismissed`}/></Stack><Stack spacing={2}>{members.length===0?<Card><CardContent><Typography color="text.secondary">Add referral members with comma-separated keywords to start local matching.</Typography></CardContent></Card>:members.map(member=><Card key={member.id}><CardContent><Stack direction="row" spacing={2} justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" useFlexGap><Stack spacing={0.75}><Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap><Typography variant="h6">{member.name}</Typography><Chip size="small" label={member.category}/><Chip size="small" label={member.active?'Active':'Paused'} color={member.active?'success':'default'}/></Stack>{member.businessName&&<Typography>{member.businessName}</Typography>}<Typography color="text.secondary">{member.keywords}</Typography>{member.notes&&<Typography color="text.secondary">{member.notes}</Typography>}</Stack><Stack direction="row" spacing={1} alignItems="center"><Switch checked={member.active} disabled={busy===member.id} onChange={()=>void toggleMember(member)}/><Button color="error" disabled={busy===member.id} onClick={()=>void removeMember(member)}>Delete</Button></Stack></Stack></CardContent></Card>)}</Stack><Card><CardContent><Stack spacing={2}><Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap><Typography variant="h6">Post Matches</Typography><TextField select size="small" label="Status" value={matchStatus} onChange={event=>setMatchStatus(event.target.value)} sx={{width:170}}><MenuItem value="suggested">Suggested</MenuItem><MenuItem value="accepted">Accepted</MenuItem><MenuItem value="dismissed">Dismissed</MenuItem><MenuItem value="all">All</MenuItem></TextField></Stack><Typography color="text.secondary">{matchTotal} match(es) in this view.</Typography>{matches.length===0?<Typography color="text.secondary">No matches yet.</Typography>:matches.map(match=><Card key={match.id} variant="outlined"><CardContent><Stack spacing={1.25}><Stack direction="row" justifyContent="space-between" spacing={1} flexWrap="wrap" useFlexGap><Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap><Chip size="small" label={match.referralMember.name}/><Chip size="small" label={match.referralMember.category}/><Chip size="small" label={`Score ${Math.round(match.score*100)}%`}/>{match.matchedKeywords?.map(keyword=><Chip key={keyword} size="small" label={keyword}/>)}</Stack><Stack direction="row" spacing={1}><Button size="small" disabled={Boolean(busy)} onClick={()=>void updateMatch(match,'accepted')}>Accept</Button><Button size="small" color="inherit" disabled={Boolean(busy)} onClick={()=>void updateMatch(match,'dismissed')}>Dismiss</Button></Stack></Stack><Typography>{match.post.latestCapturedText || 'No text captured.'}</Typography><Typography color="text.secondary">{match.post.group?.friendlyName ?? 'Group'} · {match.post.authorName ?? 'Unknown author'}</Typography><Typography color="text.secondary">{match.post.canonicalPostUrl}</Typography></Stack></CardContent></Card>)}</Stack></CardContent></Card></Stack>}
