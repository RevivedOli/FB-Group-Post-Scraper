import { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, Divider, Tab, Tabs, Table, TableBody, TableCell, TableHead, TableRow, FormControlLabel, ToggleButton, ToggleButtonGroup, Stack, Switch, TextField, Typography } from '@mui/material';
import { apiGet,apiSend } from '../api/client';
type Schedule={windowEnabled:boolean;allowedDays:number[];windowStart:string;windowEnd:string;timeZone:string;enabled:boolean;intervalMinutes:number;intervalMinMinutes:number;intervalMaxMinutes:number;requestMinSeconds:number;requestMaxSeconds:number;pageMinSeconds:number;pageMaxSeconds:number;groupMinSeconds:number;groupMaxSeconds:number;groupDeadlineSeconds:number;shuffleGroups:boolean;maxAgeHours:number;maxPages:number;limit:number;nextRunAt:string|null;lastError:string|null};
type Estimate={enabledGroups:number;processableGroups:number;skippedGroups:number;measuredGroups:number;sampleCount:number;lowerMinutes:number;upperMinutes:number;estimatedSeconds:number;basis:string};
type Config={enabled:boolean;chatId:string;minMatchPercent:number;enabledAt:string|null};
type Status={config:Config;hasToken:boolean;recent:{id:string;status:string;attempts:number;errorMessage:string|null;sentAt:string|null}[];counts:{status:string;_count:number}[]};
export function OperationsSettings(){
 const [status,setStatus]=useState<Status>();const [config,setConfig]=useState<Config>();const [schedule,setSchedule]=useState<Schedule>();
 const [liveSchedule,setLiveSchedule]=useState<Schedule>();
 const [clock,setClock]=useState(Date.now());
 useEffect(()=>{const timer=window.setInterval(()=>{setClock(Date.now());void apiGet<Schedule>('/collector/schedule').then(setLiveSchedule).catch(()=>{});},15000);return()=>window.clearInterval(timer);},[]);
 const [scheduleTab,setScheduleTab]=useState(0);
 const [savedSchedule,setSavedSchedule]=useState('');
 const [estimate,setEstimate]=useState<Estimate>();
 useEffect(()=>{setEstimate(undefined);if(!schedule)return;let cancelled=false;const timer=window.setTimeout(()=>{void apiGet<Estimate>(`/collector/schedule/estimate?maxPages=${schedule.maxPages}&limit=${schedule.limit}&${new URLSearchParams(Object.fromEntries(['requestMinSeconds','requestMaxSeconds','pageMinSeconds','pageMaxSeconds','groupMinSeconds','groupMaxSeconds','groupDeadlineSeconds'].map(key=>[key,String(schedule[key as keyof Schedule])])))}`).then(value=>{if(!cancelled)setEstimate(value);}).catch(()=>{});},300);return()=>{cancelled=true;window.clearTimeout(timer);};},[schedule?.maxPages,schedule?.limit,schedule?.requestMinSeconds,schedule?.requestMaxSeconds,schedule?.pageMinSeconds,schedule?.pageMaxSeconds,schedule?.groupMinSeconds,schedule?.groupMaxSeconds,schedule?.groupDeadlineSeconds]);
 const [section,setSection]=useState<'notifications'|'schedule'>('notifications');
 const [token,setToken]=useState('');const [message,setMessage]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 async function load(){try{const [notifications,recurring]=await Promise.all([apiGet<Status>('/notifications'),apiGet<Schedule>('/collector/schedule')]);setStatus(notifications);setConfig(notifications.config);setSchedule(recurring);setLiveSchedule(recurring);setSavedSchedule(JSON.stringify(recurring));}catch(err){setError(String(err));}}
 useEffect(()=>{void load();},[]);
 async function action(work:()=>Promise<unknown>,success:string,target:'notifications'|'schedule'='notifications'){setSection(target);setBusy(true);setError('');setMessage('');try{await work();setMessage(success);await load();}catch(err){setError(err instanceof Error?err.message:String(err));}finally{setBusy(false);}}
 const next=liveSchedule?.nextRunAt;
 const remaining=next?Math.max(0,Math.ceil((Date.parse(next)-clock)/60000)):null;
 const countdown=remaining===null?'The next time is set after the running cycle finishes.':remaining===0?'Due now — waiting for the scheduler.':`In ${Math.floor(remaining/60)?Math.floor(remaining/60)+'h ':''}${remaining%60}m · ${liveSchedule?.timeZone??'Europe/London'}`;
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
 <Card><CardContent sx={{p:{xs:2,sm:3}}}><Stack spacing={2.5}>
 <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
 <Box><Typography variant="h5">Recurring collection</Typography><Typography variant="body2" color="text.secondary">Choose when to collect and how much to check.</Typography></Box>
 <FormControlLabel sx={{mr:0,whiteSpace:'nowrap'}} label={schedule?.enabled?'Enabled':'Paused'} control={<Switch checked={schedule?.enabled??false} onChange={e=>schedule&&setSchedule({...schedule,enabled:e.target.checked})}/>}/>
 </Stack>
 {section==='schedule'&&error&&<Alert severity="error">{error}</Alert>}{section==='schedule'&&message&&<Alert severity="success">{message}</Alert>}
 {schedule?.lastError&&<Alert severity="warning">{schedule.lastError}</Alert>}
 <Box sx={{bgcolor:'action.hover',borderRadius:2,p:2,display:'grid',gridTemplateColumns:{xs:'1fr',sm:'1.3fr 1fr'},gap:2}}>
 <Box><Typography variant="overline" color="text.secondary">Collection window</Typography><Typography variant="body2" sx={{fontWeight:600}}>{schedule?.windowEnabled?((schedule.allowedDays.length===7?'Every day':[[1,'Mon'],[2,'Tue'],[3,'Wed'],[4,'Thu'],[5,'Fri'],[6,'Sat'],[0,'Sun']].filter(([day])=>schedule.allowedDays.includes(Number(day))).map(([,name])=>name).join(', ')||'Choose days')+' · '+schedule.windowStart+'–'+(schedule.windowEnd==='00:00'?'midnight':schedule.windowEnd)):'Any day, any time'}</Typography><Typography variant="caption" color="text.secondary">{schedule?.timeZone??'Europe/London'} · Finish any cycle already running</Typography></Box>
 <Box sx={{borderLeft:{sm:2},borderColor:'primary.main',pl:{sm:2}}}><Typography variant="overline" color="primary.main">Next collection run</Typography><Typography sx={{fontSize:{xs:20,sm:24},fontWeight:700,lineHeight:1.3}}>{liveSchedule?.enabled?(next?new Date(next).toLocaleString('en-GB',{weekday:'short',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:liveSchedule.timeZone}):'After the current cycle'):'Schedule paused'}</Typography><Typography variant="body2" color="text.secondary">{liveSchedule?.enabled?countdown:'Enable and save the schedule to plan the next run.'}</Typography><Typography variant="caption" color="text.secondary">{schedule&&JSON.stringify(schedule)!==savedSchedule?'Showing saved schedule · changes not yet applied':'Updates automatically every 15 seconds'}</Typography></Box>
 </Box>
 <Tabs value={scheduleTab} onChange={(_,v)=>setScheduleTab(v)} variant="scrollable" allowScrollButtonsMobile><Tab label="Schedule"/><Tab label="Collection limits"/><Tab label="Advanced timing"/></Tabs>
 {scheduleTab===0&&<Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',md:'1.2fr 1fr'},gap:3}}><Stack spacing={2}>
 <FormControlLabel label="Restrict start times" control={<Switch size="small" checked={schedule?.windowEnabled??true} onChange={e=>schedule&&setSchedule({...schedule,windowEnabled:e.target.checked})}/>}/>
 {schedule?.windowEnabled&&<>
 <Stack direction={{xs:'column',sm:'row'}} justifyContent="space-between" alignItems={{xs:'flex-start',sm:'center'}} gap={1}>
 <Typography variant="subtitle2">Days to collect</Typography><Stack direction="row" spacing={.5}>{[['Every day',[1,2,3,4,5,6,0]],['Weekdays',[1,2,3,4,5]],['Weekends',[6,0]]].map(([name,days])=><Button key={String(name)} size="small" onClick={()=>setSchedule({...schedule,allowedDays:days as number[]})}>{String(name)}</Button>)}</Stack></Stack>
 <ToggleButtonGroup size="small" value={schedule.allowedDays} onChange={(_,days:number[])=>setSchedule({...schedule,allowedDays:days})} aria-label="Allowed collection days" sx={{alignSelf:'flex-start',flexWrap:'wrap','& .MuiToggleButton-root':{px:{xs:1.25,sm:2},'&.Mui-selected':{color:'primary.main',bgcolor:'primary.50',borderColor:'primary.main'}}}}>
 {([[1,'Mon'],[2,'Tue'],[3,'Wed'],[4,'Thu'],[5,'Fri'],[6,'Sat'],[0,'Sun']] as const).map(([day,name])=><ToggleButton key={day} value={day} aria-label={name}>{name}</ToggleButton>)}</ToggleButtonGroup>
 {!schedule.allowedDays.length&&<Typography variant="caption" color="error">Select at least one day.</Typography>}
 <Stack direction="row" spacing={2} sx={{width:'100%'}}>
 <TextField fullWidth size="small" type="time" label="From" InputLabelProps={{shrink:true}} value={schedule.windowStart} onChange={e=>setSchedule({...schedule,windowStart:e.target.value})}/>
 <TextField fullWidth size="small" type="time" label="Until" InputLabelProps={{shrink:true}} value={schedule.windowEnd} onChange={e=>setSchedule({...schedule,windowEnd:e.target.value})}/></Stack>
 <Typography variant="caption" color="text.secondary">00:00 means midnight. Overnight windows belong to the day they start. Change the timezone under Advanced timing.</Typography>
 </>}
 </Stack><Stack spacing={2} sx={{borderLeft:{md:1},borderColor:'divider',pl:{md:3}}}>
 <Typography variant="subtitle2">Pause after each cycle</Typography>
 <Stack direction="row" spacing={2} sx={{width:'100%'}}>
 {(['intervalMinMinutes','intervalMaxMinutes'] as const).map((key,i)=><TextField fullWidth key={key} size="small" label={i?'Maximum (minutes)':'Minimum (minutes)'} type="number" inputProps={{min:15,max:10080}} value={schedule?.[key]??''} onChange={e=>schedule&&setSchedule({...schedule,[key]:Number(e.target.value)})}/>)}</Stack>
 <Typography variant="body2" color="text.secondary">Wait {schedule?.intervalMinMinutes}–{schedule?.intervalMaxMinutes} minutes after a cycle finishes, then start again when the collection window is open.</Typography>
 </Stack></Box>}
 {scheduleTab===1&&<Stack spacing={2}>
 <Typography variant="body2" color="text.secondary">Limits apply separately to each group.</Typography>
 <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',sm:'1fr 1fr'},gap:2}}>
 {(['maxAgeHours','maxPages','limit','groupDeadlineSeconds'] as const).map((key,i)=><TextField size="small" key={key} label={['Post age (hours)','Page limit','Post limit','Time limit (seconds)'][i]} helperText={['Only keep posts newer than this','Maximum pages to check','Maximum posts to inspect','Maximum time spent on one group'][i]} type="number" inputProps={{min:[0.01,1,1,30][i],max:[8760,20,500,600][i],step:i===0?'any':1}} value={schedule?.[key]??''} onChange={e=>schedule&&setSchedule({...schedule,[key]:Number(e.target.value)})}/>)}</Box>
 <Alert severity="info">Collection also stops after 10 consecutive saved, unchanged posts. A new post resets the count.</Alert>
 </Stack>}
 {scheduleTab===2&&<Stack spacing={2}>
 <TextField size="small" label="Schedule timezone" value={schedule?.timeZone??''} onChange={e=>schedule&&setSchedule({...schedule,timeZone:e.target.value})} helperText="For example Europe/London. Daylight saving is handled automatically." sx={{maxWidth:400}}/>
 <FormControlLabel label="Shuffle group order each cycle" control={<Switch size="small" checked={schedule?.shuffleGroups??true} onChange={e=>schedule&&setSchedule({...schedule,shuffleGroups:e.target.checked})}/>}/>
 <Box sx={{overflowX:'auto'}}><Table size="small" sx={{'& td,& th':{px:1,py:1},'& th':{color:'text.secondary'}}}><TableHead><TableRow><TableCell>Pause</TableCell><TableCell>Minimum (sec)</TableCell><TableCell>Maximum (sec)</TableCell></TableRow></TableHead><TableBody>
 {([['Between requests','requestMinSeconds','requestMaxSeconds',120],['Between pages','pageMinSeconds','pageMaxSeconds',300],['Between groups','groupMinSeconds','groupMaxSeconds',600]] as const).map(([name,min,max,ceiling])=><TableRow key={min}><TableCell sx={{minWidth:120}}>{name}</TableCell>{[min,max].map((key,i)=><TableCell key={key}><TextField size="small" type="number" inputProps={{min:2,max:ceiling,step:'any','aria-label':name+(i?' maximum seconds':' minimum seconds')}} value={schedule?.[key]??''} onChange={e=>schedule&&setSchedule({...schedule,[key]:Number(e.target.value)})} sx={{maxWidth:160}}/></TableCell>)}</TableRow>)}
 </TableBody></Table></Box>
 <Typography variant="caption" color="text.secondary">A fresh pause is chosen within each range. Use equal values for a fixed pause.</Typography>
 </Stack>}
 <Divider/>
 <Stack direction={{xs:'column',sm:'row'}} justifyContent="space-between" alignItems={{xs:'flex-start',sm:'center'}} gap={2}>
 <Box>{estimate&&<><Typography variant="body2">Estimated cycle: <b>{estimate.lowerMinutes}–{estimate.upperMinutes} min</b> · {estimate.enabledGroups} groups</Typography><Typography variant="caption" color="text.secondary">Planning estimate; early stops may shorten a run.</Typography></>}</Box>
 <Stack direction="row" alignItems="center" spacing={1}>{schedule&&JSON.stringify(schedule)!==savedSchedule&&<Chip size="small" label="Unsaved changes" color="warning" variant="outlined"/>}<Button disabled={busy||!schedule||(schedule.windowEnabled&&!schedule.allowedDays.length)||JSON.stringify(schedule)===savedSchedule} variant="contained" onClick={()=>void action(()=>apiSend('/collector/schedule','PATCH',schedule),'Collection schedule saved.','schedule')}>{busy&&section==='schedule'?'Saving…':'Save changes'}</Button></Stack>
 </Stack>
 <Typography variant="caption" color="text.secondary">The app and Mac must stay running. Login checks or Stop pause the schedule. Manual runs are unaffected by allowed hours.</Typography>
 </Stack></CardContent></Card>
 </Stack>;
}
