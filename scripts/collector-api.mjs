#!/usr/bin/env node
/** Run the built API with bounded restart backoff, without a development watcher. */
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const entry=path.join(root,'apps/api/dist/index.js');
if(!existsSync(entry)){console.error('Build the collector API first with npm run build.');process.exit(1);}
let child,timer,stopping=false,backoff=5000;
function start(){
 const started=Date.now();
 child=spawn(process.execPath,[entry],{cwd:root,env:process.env,stdio:'inherit'});
 child.once('error',()=>{console.error('Collector API could not start.');});
 child.once('exit',(code,signal)=>{
  if(stopping)return;
  if(Date.now()-started>60000)backoff=5000;
  console.error(`Collector API exited (${signal ?? code}); restarting in ${backoff/1000}s.`);
  timer=setTimeout(start,backoff);backoff=Math.min(60000,backoff*2);
 });
}
function stop(){stopping=true;clearTimeout(timer);child?.kill('SIGTERM');}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
start();
