export type CollectionWindow={windowEnabled:boolean;allowedDays:number[];windowStart:string;windowEnd:string;timeZone:string};
export const defaultWindow:CollectionWindow={windowEnabled:true,allowedDays:[1,2,3,4,5,6,0],windowStart:'06:00',windowEnd:'00:00',timeZone:'Europe/London'};
export function normalizeWindow(input:Partial<CollectionWindow>):CollectionWindow{
 const value={...defaultWindow,...input};
 if(typeof value.windowEnabled!=='boolean'||!Array.isArray(value.allowedDays)||!value.allowedDays.length||value.allowedDays.some(d=>!Number.isInteger(d)||d<0||d>6))throw Error('Choose at least one valid collection day.');
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.windowStart)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.windowEnd))throw Error('Collection times must use HH:MM.');
 if(value.windowStart===value.windowEnd)throw Error('Start and finish must differ. Disable the time window for unrestricted collection.');
 try{new Intl.DateTimeFormat('en-GB',{timeZone:value.timeZone}).format();}catch{throw Error('Choose a valid collection time zone.');}
 return {windowEnabled:value.windowEnabled,allowedDays:[...new Set(value.allowedDays)],windowStart:value.windowStart,windowEnd:value.windowEnd,timeZone:value.timeZone};
}
function checker(window:CollectionWindow){
 const format=new Intl.DateTimeFormat('en-GB',{timeZone:window.timeZone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const minute=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3));
 const start=minute(window.windowStart),end=minute(window.windowEnd);
 return (date:Date)=>{
  if(!window.windowEnabled)return true;
  const parts=Object.fromEntries(format.formatToParts(date).map(p=>[p.type,p.value]));
  const day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday);
  const now=Number(parts.hour)*60+Number(parts.minute);
  if(start<end)return window.allowedDays.includes(day)&&now>=start&&now<end;
  return (now>=start&&window.allowedDays.includes(day))||(now<end&&window.allowedDays.includes((day+6)%7));
 };
}
export function isAllowedStart(window:CollectionWindow,date:Date){return checker(window)(date);}
export function nextAllowedStart(window:CollectionWindow,date:Date):Date{
 const allowed=checker(window);
 if(allowed(date))return date;
 // Iterate real UTC minutes so local DST gaps and repeated hours are handled correctly.
 let stamp=Math.ceil(date.getTime()/60000)*60000;
 for(let i=0;i<9*24*60;i++,stamp+=60000){const candidate=new Date(stamp);if(allowed(candidate))return candidate;}
 throw Error('No collection window found in the next nine days.');
}
