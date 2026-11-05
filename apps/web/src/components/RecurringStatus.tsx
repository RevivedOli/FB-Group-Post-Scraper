import {useEffect,useState} from 'react';
import {Alert} from '@mui/material';
import {apiGet} from '../api/client';
export function RecurringStatus(){const [value,setValue]=useState<{enabled:boolean;nextRunAt:string|null;lastError:string|null}>();useEffect(()=>{const load=()=>{void apiGet<typeof value>('/collector/schedule').then(setValue).catch(()=>{});};load();const timer=window.setInterval(load,15000);return()=>window.clearInterval(timer);},[]);return <Alert severity={value?.lastError?'warning':'info'}>{value?.lastError || (value?.enabled ? `Recurring collection enabled · Next cycle: ${value.nextRunAt?new Date(value.nextRunAt).toLocaleString('en-GB'):'pending'}`:'Recurring collection is paused. Configure it in Settings.')}</Alert>;}
