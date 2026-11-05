/** SQLite has one writer; serialize this app's pool rather than competing writers. */
export function sqliteRuntimeUrl(value:string){
 if(!value.startsWith('file:'))return value;
 const index=value.indexOf('?');const base=index<0?value:value.slice(0,index);
 const query=new URLSearchParams(index<0?'':value.slice(index+1));
 query.set('connection_limit','1');query.set('socket_timeout','15');
 return `${base}?${query}`;
}
