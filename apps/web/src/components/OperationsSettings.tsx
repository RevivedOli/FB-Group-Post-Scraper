import { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material';
import { apiGet,apiSend } from '../api/client';
type Schedule={enabled:boolean;intervalMinutes:number;intervalMinMinutes:number;intervalMaxMinutes:number;requestMinSeconds:number;requestMaxSeconds:number;pageMinSeconds:number;pageMaxSeconds:number;groupMinSeconds:number;groupMaxSeconds:number;groupDeadlineSeconds:number;shuffleGroups:boolean;maxAgeHours:number;maxPages:number;limit:number;nextRunAt:string|null;lastError:string|null};
type Estimate={enabledGroups:number;processableGroups:number;skippedGroups:number;measuredGroups:number;sampleCount:number;lowerMinutes:number;upperMinutes:number;estimatedSeconds:number;basis:string};
type Config={enabled:boolean;chatId:string;minMatchPercent:number;enabledAt:string|null};
type Status={config:Config;hasToken:boolean;recent:{id:string;status:string;attempts:number;errorMessage:string|null;sentAt:string|null}[];counts:{status:string;_count:number}[]};
export function OperationsSettings(){
 const [status,setStatus]=useState<Status>();const [config,setConfig]=useState<Config>();const [schedule,setSchedule]=useState<Schedule>();
 const [estimate,setEstimate]=useState<Estimate>();
 useEffect(()=>{setEstimate(undefined);if(!schedule)return;let cancelled=false;const timer=window.setTimeout(()=>{void apiGet<Estimate>(`/collector/schedule/estimate?maxPages=${schedule.maxPages}&limit=${schedule.limit}&${new URLSearchParams(Object.fromEntries(['requestMinSeconds','requestMaxSeconds','pageMinSeconds','pageMaxSeconds','groupMinSeconds','groupMaxSeconds','groupDeadlineSeconds'].map(key=>[key,String(schedule[key as keyof Schedule])])))}`).then(value=>{if(!cancelled)setEstimate(value);}).catch(()=>{});},300);return()=>{cancelled=true;window.clearTimeout(timer);};},[schedule?.maxPages,schedule?.limit,schedule?.requestMinSeconds,schedule?.requestMaxSeconds,schedule?.pageMinSeconds,schedule?.pageMaxSeconds,schedule?.groupMinSeconds,schedule?.groupMaxSeconds,schedule?.groupDeadlineSeconds]);
 const [section,setSection]=useState<'notifications'|'schedule'>('notifications');
 const [token,setToken]=useState('');const [message,setMessage]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 async function load(){try{const [notifications,recurring]=await Promise.all([apiGet<Status>('/notifications'),apiGet<Schedule>('/collector/schedule')]);setStatus(notifications);setConfig(notifications.config);setSchedule(recurring);}catch(err){setError(String(err));}}
 useEffect(()=>{void load();},[]);
 async function action(work:()=>Promise<unknown>,success:string,target:'notifications'|'schedule'='notifications'){setSection(target);setBusy(true);setError('');setMessage('');try{await work();setMessage(success);await load();}catch(err){setError(err instanceof Error?err.message:String(err));}finally{setBusy(false);}}
 return <Stack spacing={3}>
 <Card><CardContent><Stack spacing={2}>
 <Typography variant="h5">Telegram referral alerts</Typography>
 {section==='notifications'&&error&&<Alert severity="error">{error}</Alert>}{section==='notifications'&&message&&<Alert severity="success">{message}</Alert>}
 <Typography>Create a bot with Telegram’s @BotFather using /newbot. Save its token here, then open your bot in Telegram and send /start. Select your private chat below, save it, and send a test notification before enabling alerts.</Typography>
 <TextField label={status?.hasToken?'Bot token (saved in macOS Keychain; enter to replace)':'Bot token'} type="password" value={token} autoComplete="new-password" onChange={e=>setToken(e.target.value)} />
 <Button disabled={busy||!token} onClick={()=>void action(async()=>{await apiSend('/notifications/token','PUT',{token});setToken('');},'Bot token saved in Keychain.')}>Save Bot Token</Button>
 <TextField label="Private chat ID" value={config?.chatId ?? ''} onChange={e=>config&&setConfig({...config,chatId:e.target.value})} />
 <Button disabled={busy||!status?.hasToken} onClick={()=>void action(async()=>{const chats=await apiSend<{id:string;name:string}[]>('/notifications/chats','POST');if(chats.length!==1)throw new Error(chats.length?'Multiple private chats found; enter your own private chat ID explicitly.':'No /start found. Send /start to your bot in Telegram first.');await apiSend('/notifications','PATCH',{...config,enabled:false,chatId:chats[0].id});},'Private chat selected. Alerts remain off until enabled.')}>Find My Private Chat</Button>
 <TextField label="Minimum model match score (%)" type="number" value={config?.minMatchPercent ?? 80} onChange={e=>config&&setConfig({...config,minMatchPercent:Number(e.target.value)})} />
 <FormControlLabel label="Notify me about new referral matches" control={<Switch checked={config?.enabled ?? false} onChange={e=>config&&setConfig({...config,enabled:e.target.checked})}/>} />
 <Typography variant="body2">Alerts include post text, group, publication time, matched member and a Facebook link. They start from enablement time; old saved posts are not backfilled. Match percentages are model scores. The app must remain running.</Typography>
 <Stack direction="row" spacing={1}><Button disabled={busy||!config} variant="contained" onClick={()=>void action(()=>apiSend('/notifications','PATCH',config),'Notification settings saved.')}>Save Notification Settings</Button><Button disabled={busy||!status?.config.chatId} onClick={()=>void action(()=>apiSend('/notifications/test','POST'),'Test notification sent to your saved private chat.')}>Send Test Notification</Button></Stack>
 <Typography>Delivery: {status?.counts.map(item=>`${item.status}: ${item._count}`).join(' · ')||'No alerts queued yet.'}</Typography>
 {status?.recent.map(item=><Typography key={item.id} variant="body2">{item.status} · {item.attempts} attempt(s){item.errorMessage?` · ${item.errorMessage}`:''}</Typography>)}
 <Stack direction="row" spacing={1}><Button disabled={busy} onClick={()=>void load()}>Refresh Delivery Status</Button><Button disabled={busy} onClick={()=>void action(()=>apiSend('/notifications/retry','POST'),'Failed deliveries scheduled for retry.')}>Retry Failed Deliveries</Button></Stack>
 </Stack></CardContent></Card>
 <Card><CardContent><Stack spacing={2}>
 <Typography variant="h5">Recurring group collection</Typography>
 {section==='schedule'&&error&&<Alert severity="error">{error}</Alert>}{section==='schedule'&&message&&<Alert severity="success">{message}</Alert>}
 <Typography>One sequential worker checks enabled groups while this app and Mac are running. Login/security failures pause the schedule. Stop on Dashboard also pauses recurring collection.</Typography>
 {schedule?.lastError&&<Alert severity="warning">{schedule.lastError}</Alert>}
 <FormControlLabel label="Enable recurring collection" control={<Switch checked={schedule?.enabled ?? false} onChange={e=>schedule&&setSchedule({...schedule,enabled:e.target.checked})}/>} />
 <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',sm:'repeat(2, minmax(0, 1fr))',lg:'repeat(4, minmax(0, 1fr))'},gap:2}}>
 {(['maxAgeHours','maxPages','limit','groupDeadlineSeconds'] as const).map((key,index)=><TextField key={key} size="small" label={['Look back (hours)','Max pages per group','Max posts per group','Time budget / group (seconds)'][index]} type="number" inputProps={{min:[0.01,1,1,30][index],max:[8760,20,500,600][index],step:index===0?'any':1}} helperText={['Greater than 0, up to 8,760 hours','Whole number: 1–20','Whole number: 1–500','30–600 seconds; a cap, not a pause'][index]} value={schedule?.[key] ?? ''} onChange={e=>schedule&&setSchedule({...schedule,[key]:Number(e.target.value)})}/>)}
 </Box>
 <FormControlLabel label="Shuffle group order for each cycle" control={<Switch checked={schedule?.shuffleGroups ?? true} onChange={e=>schedule&&setSchedule({...schedule,shuffleGroups:e.target.checked})}/>} />
 <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',sm:'repeat(2,minmax(0,1fr))'},gap:2}}>
 {([
 ['Cycle interval (minutes)','intervalMinMinutes','intervalMaxMinutes',15,10080],
 ['Request spacing (seconds)','requestMinSeconds','requestMaxSeconds',2,120],
 ['Pause between pages (seconds)','pageMinSeconds','pageMaxSeconds',2,300],
 ['Pause between groups (seconds)','groupMinSeconds','groupMaxSeconds',2,600],
 ] as const).map(([label,minKey,maxKey,floor,ceiling])=><Box key={minKey}>
 <Typography variant="subtitle2" sx={{mb:1}}>{label}</Typography>
 <Stack direction="row" spacing={1}>
 <TextField fullWidth size="small" label="Minimum" type="number" value={schedule?.[minKey] ?? ''} inputProps={{min:floor,max:ceiling,step:'any'}} onChange={e=>schedule&&setSchedule({...schedule,[minKey]:Number(e.target.value)})}/>
 <TextField fullWidth size="small" label="Maximum" type="number" value={schedule?.[maxKey] ?? ''} inputProps={{min:floor,max:ceiling,step:'any'}} onChange={e=>schedule&&setSchedule({...schedule,[maxKey]:Number(e.target.value)})}/>
 </Stack></Box>)}
 </Box>
 <Typography variant="body2" color="text.secondary">Each cycle draws a new pause after collection finishes; each request/page/group pause draws a fresh duration within its range. Equal bounds give a fixed delay. Variable pacing does not guarantee avoidance of automation detection.</Typography>
 {estimate&&<Alert severity={schedule&&estimate.estimatedSeconds>schedule.intervalMinMinutes*60?'warning':'info'}>
   Estimated collection cycle: <strong>{estimate.lowerMinutes}–{estimate.upperMinutes} minutes</strong> for {estimate.enabledGroups} enabled groups. Based on {estimate.basis}{estimate.sampleCount ? ` (${estimate.sampleCount} recent scans; ${estimate.measuredGroups} groups have their own timing samples)` : ''}.
   {estimate.skippedGroups>0 ? ` ${estimate.skippedGroups} group(s) need numeric IDs and will currently be skipped.` : ''}
   {' '}Rough planning estimate assuming page limits are reached; early stops may be faster, discovery/retries may be slower. AI and Telegram processing are separate.
   {schedule&&estimate.estimatedSeconds>schedule.intervalMinMinutes*60?' The cycle itself may exceed the minimum pause. The next cycle starts only after completion plus a fresh interval.':''}
 </Alert>}
 <Typography>Next cycle: {schedule?.nextRunAt?new Date(schedule.nextRunAt).toLocaleString('en-GB'):schedule?.enabled?'After the current cycle completes, plus the selected pause':'Paused'}</Typography>
 <Button sx={{alignSelf:'flex-start'}} disabled={busy||!schedule} variant="contained" onClick={()=>void action(()=>apiSend('/collector/schedule','PATCH',schedule),'Recurring collection settings saved.','schedule')}>Save Schedule</Button>
 </Stack></CardContent></Card>
 </Stack>;
}
