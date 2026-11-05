import {useState} from 'react';
import {Alert,Button,Card,CardContent,Chip,FormControlLabel,MenuItem,Stack,Switch,TablePagination,TextField,Typography} from '@mui/material';

type Exclusion = {id:string;name:string;company:string;reason:string;status:string;active:boolean};
const groups = [
  ['chapter','Existing chapter members'],
  ['drafted','Drafted invitations'],
  ['invited','Already invited'],
  ['elsewhere','Members of other chapters'],
  ['held','On hold / needs review'],
  ['unsuitable','Not suitable / dropped'],
  ['known','Already known / in contact'],
] as const;
function reasonGroup(exclusion:Exclusion):typeof groups[number][0] {
  if(exclusion.status==='joined'||/existing chapter member/i.test(exclusion.reason))return 'chapter';
  if(exclusion.status==='member already elsewhere'||/other BNI chapter|BNI Royal Windsor/i.test(exclusion.reason))return 'elsewhere';
  if(exclusion.status==='drafted')return 'drafted';
  if(exclusion.status==='invited'||/^sent\b/i.test(exclusion.reason))return 'invited';
  if(/^held\b|fit unsure|review before/i.test(exclusion.reason))return 'held';
  if(/already in contact|already known/i.test(exclusion.reason))return 'known';
  return 'unsuitable';
}
const normalize = (s:string)=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

export function VisitorExclusions({exclusions,busy,onToggle}:{exclusions:Exclusion[];busy:boolean;onToggle:(id:string,active:boolean)=>void}) {
  const [search,setSearch]=useState('');
  const [group,setGroup]=useState('all');
  const [activity,setActivity]=useState('all');
  const [page,setPage]=useState(0);
  const [pageSize,setPageSize]=useState(10);
  const counts=new Map(groups.map(([key])=>[key,exclusions.filter(e=>reasonGroup(e)===key).length]));
  const terms=normalize(search).split(' ').filter(Boolean);
  const filtered=exclusions.filter(e=>{
    const key=reasonGroup(e);
    const haystack=normalize([e.company,e.name,e.reason,e.status,groups.find(([id])=>id===key)?.[1]].join(' '));
    return (group==='all'||key===group)&&(activity==='all'||e.active===(activity==='active'))&&terms.every(term=>haystack.includes(term));
  }).sort((a,b)=>(a.company||a.name).localeCompare(b.company||b.name,'en-GB')||a.name.localeCompare(b.name,'en-GB'));
  const safePage=Math.min(page,Math.max(0,Math.ceil(filtered.length/pageSize)-1));
  const start=safePage*pageSize;
  const pagination=<TablePagination component="div" count={filtered.length} page={safePage} rowsPerPage={pageSize} rowsPerPageOptions={[10,25,50]} onPageChange={(_,next)=>setPage(next)} onRowsPerPageChange={e=>{setPageSize(Number(e.target.value));setPage(0);}} labelRowsPerPage="Per page"/>;
  return <Stack spacing={2}>
    <Alert severity="info">Exclusions prevent repeat visitor suggestions. Drafted invitations have not been marked sent. Turning an exclusion off retains the record so you can enable it again.</Alert>
    <Stack direction="row" gap={1} flexWrap="wrap">
      <Chip label={`${counts.get('chapter')??0} chapter members`}/>
      <Chip label={`${exclusions.length-(counts.get('chapter')??0)} other exclusions`}/>
      <Chip label={`${exclusions.filter(e=>e.active).length} enabled`}/>
    </Stack>
    <Stack direction="row" gap={2} flexWrap="wrap" alignItems="center">
      <TextField size="small" label="Search exclusions" placeholder="Name, company or reason" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} sx={{flex:'1 1 260px'}}/>
      <TextField size="small" select label="Exclusion reason" value={group} onChange={e=>{setGroup(e.target.value);setPage(0);}} sx={{minWidth:260}}>
        <MenuItem value="all">All reasons ({exclusions.length})</MenuItem>
        {groups.map(([key,label])=><MenuItem key={key} value={key}>{label} ({counts.get(key)??0})</MenuItem>)}
      </TextField>
      <TextField size="small" select label="Exclusion setting" value={activity} onChange={e=>{setActivity(e.target.value);setPage(0);}} sx={{minWidth:170}}>
        <MenuItem value="all">Enabled and disabled</MenuItem><MenuItem value="active">Enabled only</MenuItem><MenuItem value="inactive">Disabled only</MenuItem>
      </TextField>
      <Button disabled={!search&&group==='all'&&activity==='all'} onClick={()=>{setSearch('');setGroup('all');setActivity('all');setPage(0);}}>Clear filters</Button>
    </Stack>
    <Typography color="text.secondary">{filtered.length?`${start+1}–${Math.min(start+pageSize,filtered.length)} of ${filtered.length}`:'0'} matching exclusions · {exclusions.length} total</Typography>
    {pagination}
    {!filtered.length&&<Alert severity="info">No exclusions match these filters. Try a different name, company or reason, or clear the filters.</Alert>}
    {filtered.slice(start,start+pageSize).map(e=><Card key={e.id}><CardContent>
      <Stack direction={{xs:'column',sm:'row'}} justifyContent="space-between" gap={1}>
        <Stack spacing={1} sx={{minWidth:0}}>
          <Typography fontWeight="bold">{e.company||e.name}</Typography>
          {e.company&&e.name&&<Typography variant="body2">{e.name}</Typography>}
          <Stack direction="row" gap={1} flexWrap="wrap"><Chip size="small" color={reasonGroup(e)==='chapter'?'primary':'default'} label={groups.find(([key])=>key===reasonGroup(e))?.[1]}/><Chip size="small" variant="outlined" label={`Outreach: ${e.status}`}/>{!e.active&&<Chip size="small" label="Exclusion disabled"/>}</Stack>
          <Typography variant="body2" color="text.secondary">{e.reason}</Typography>
        </Stack>
        <FormControlLabel sx={{flexShrink:0,alignSelf:'start',mr:0}} control={<Switch disabled={busy} checked={e.active} onChange={(_,active)=>onToggle(e.id,active)}/>} label="Exclude"/>
      </Stack>
    </CardContent></Card>)}
    {filtered.length>pageSize&&pagination}
  </Stack>;
}
