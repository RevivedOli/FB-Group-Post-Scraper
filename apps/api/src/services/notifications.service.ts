import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
const exec=promisify(execFile);
const secretService='com.local-group-monitor.telegram';
const configKey='notifications.telegram.v1';
export type TelegramConfig={enabled:boolean;chatId:string;minMatchPercent:number;enabledAt:string|null};
const defaults:TelegramConfig={enabled:false,chatId:'',minMatchPercent:80,enabledAt:null};
export async function telegramToken() { try {const {stdout}=await exec('security',['find-generic-password','-s',secretService,'-a','bot','-w']);return stdout.trim() || undefined;}catch{return undefined;} }
export async function saveTelegramToken(value:string) {
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(value.trim())) throw new Error('Enter a valid Telegram bot token from BotFather.');
  await exec('security',['add-generic-password','-U','-s',secretService,'-a','bot','-w',value.trim()]);
}
export async function notificationConfig():Promise<TelegramConfig> {const row=await prisma.setting.findUnique({where:{key:configKey}});return {...defaults,...(row?.value as Partial<TelegramConfig> ?? {})};}
export async function updateNotificationConfig(input:Partial<TelegramConfig>) {
  const previous=await notificationConfig();
  const value={...previous,enabled:input.enabled===undefined?previous.enabled:Boolean(input.enabled),chatId:String(input.chatId ?? previous.chatId).trim(),minMatchPercent:Number(input.minMatchPercent ?? previous.minMatchPercent)};
  if(!Number.isFinite(value.minMatchPercent)||value.minMatchPercent<0||value.minMatchPercent>100)throw new Error('Invalid notification match threshold.');
  if(value.chatId&&!/^\d+$/.test(value.chatId))throw new Error('Use your private Telegram chat ID.');
  if(value.enabled&&(!value.chatId||!await telegramToken()))throw new Error('Save a bot token and private chat ID before enabling notifications.');
  const destinationChanged=value.chatId!==previous.chatId;
  value.enabledAt=value.enabled&&(!previous.enabled||destinationChanged)?new Date().toISOString():previous.enabledAt;
  await prisma.$transaction(async tx=>{
    if(!value.enabled||destinationChanged)await tx.notificationDelivery.updateMany({where:{status:{in:['pending','retry']}},data:{status:'cancelled',errorMessage:'Notifications disabled or destination changed.'}});
    await tx.setting.upsert({where:{key:configKey},create:{key:configKey,value},update:{value}});
  });
  return value;
}
export async function telegramRequest(method:string,body:object) {
  const token=await telegramToken();if(!token)throw new Error('Telegram bot token is not configured.');
  try {
    const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    const data=await response.json() as {ok:boolean;result:any;parameters?:{retry_after?:number}};
    if(!response.ok||!data.ok){const error=new Error(`Telegram delivery failed (HTTP ${response.status}).`) as Error&{retryAfter?:number};error.retryAfter=data.parameters?.retry_after;throw error;}
    return data.result;
  }catch(error){if(error instanceof Error&&error.message.startsWith('Telegram delivery failed'))throw error;throw new Error('Telegram request failed or timed out.');}
}
export async function discoverTelegramChats() {
  const updates=await telegramRequest('getUpdates',{timeout:0,limit:100}) as Array<{message?:{chat?:{id:number;type:string;first_name?:string};text?:string}}>;
  const chats=new Map<string,{id:string;name:string}>();
  for(const item of updates){const chat=item.message?.chat;if(chat?.type==='private'&&item.message?.text?.startsWith('/start'))chats.set(String(chat.id),{id:String(chat.id),name:chat.first_name || 'Private chat'});}
  return [...chats.values()];
}
export function referralMessage(input:{memberName:string;score:string;group:string;postedAt:string|null;text:string;url:string;intro?:string|null}) {
  return `New referral — ${input.memberName.slice(0,120)}\nMatch: ${input.score} (model score)\nGroup: ${input.group.slice(0,180)}\nPosted: ${input.postedAt ? new Date(input.postedAt).toLocaleString('en-GB',{timeZone:'Europe/London'})+' UK' : 'date unavailable'}\n\n${input.text.slice(0,1800)}\n\nSuggested introduction:\n${(input.intro || 'Open the post and review before introducing.').slice(0,500)}\n\n${input.url}`;
}
export async function enqueueReferralNotifications(tx:Prisma.TransactionClient, config:TelegramConfig, post:{id:string;firstDiscoveredAt:Date;originalPostedAt:Date|null;latestCapturedText:string|null;canonicalPostUrl:string;group?:{friendlyName:string}|null}, members:Array<{id:string;name:string}>, matches:Array<{referralMemberId:string;score:number;scorePercent:string;suggestedIntro?:string|null}>, options:{allowExistingPost?:boolean} = {}) {
  if(!config.enabled||!config.enabledAt||(!options.allowExistingPost&&post.firstDiscoveredAt.getTime()<new Date(config.enabledAt).getTime()))return;
  if(!/^https:\/\/www\.facebook\.com\/groups\/[^/?#]+\/posts\/\d+\/?$/.test(post.canonicalPostUrl))return;
  for(const match of matches){
    if(match.score*100<config.minMatchPercent)continue;
    const member=members.find(item=>item.id===match.referralMemberId);if(!member)continue;
    const text=referralMessage({memberName:member.name,score:match.scorePercent,group:post.group?.friendlyName ?? 'Facebook group',postedAt:post.originalPostedAt?.toISOString() ?? null,text:post.latestCapturedText ?? '',url:post.canonicalPostUrl,intro:match.suggestedIntro});
    const payload={chat_id:config.chatId,text,link_preview_options:{is_disabled:true},reply_markup:{inline_keyboard:[[{text:'Open Facebook post',url:post.canonicalPostUrl}],[{text:'Copy introduction',copy_text:{text:(match.suggestedIntro || post.canonicalPostUrl).slice(0,256)}}]]}};
    const id=createHash('sha256').update(`${post.id}:${member.id}:telegram`).digest('hex');
    await tx.notificationDelivery.upsert({where:{id},create:{id,postId:post.id,referralMemberId:member.id,payload},update:{}});
  }
}
let delivering=false;
export async function deliverNotifications() {
  if(delivering)return;delivering=true;
  try {
    const config=await notificationConfig();if(!config.enabled)return;
    // Recover leases only after the request timeout plus ample margin.
    await prisma.notificationDelivery.updateMany({where:{status:'sending',claimedAt:{lt:new Date(Date.now()-120000)}},data:{status:'retry',availableAt:new Date()}});
    const rows=await prisma.notificationDelivery.findMany({where:{status:{in:['pending','retry']},availableAt:{lte:new Date()}},orderBy:{createdAt:'asc'},take:10});
    for(const row of rows){
      const latest=await notificationConfig();
      if(!latest.enabled||latest.chatId!==config.chatId)break;
      const payload=row.payload as Record<string,unknown>;
      if(String(payload.chat_id)!==config.chatId){await prisma.notificationDelivery.update({where:{id:row.id},data:{status:'cancelled',errorMessage:'Destination changed.'}});continue;}
      const claim=await prisma.notificationDelivery.updateMany({where:{id:row.id,status:{in:['pending','retry']}},data:{status:'sending',claimedAt:new Date(),attempts:{increment:1}}});if(!claim.count)continue;
      try {const message=await telegramRequest('sendMessage',payload);await prisma.notificationDelivery.update({where:{id:row.id},data:{status:'sent',sentAt:new Date(),messageId:String(message.message_id),errorMessage:null}});}
      catch(error){const attempts=row.attempts+1;const delay=Math.max((error as {retryAfter?:number}).retryAfter ?? 0,Math.min(3600,30*2**Math.min(attempts,7)));await prisma.notificationDelivery.update({where:{id:row.id},data:{status:attempts>=8?'failed':'retry',availableAt:new Date(Date.now()+delay*1000),errorMessage:error instanceof Error?error.message:'Telegram delivery failed.'}});}
      await new Promise(resolve=>setTimeout(resolve,1100));
    }
  }finally{delivering=false;}
}
export async function notificationStatus() {
  const [config,hasToken,counts,recent]=await Promise.all([notificationConfig(),telegramToken().then(Boolean),prisma.notificationDelivery.groupBy({by:['status'],_count:true}),prisma.notificationDelivery.findMany({orderBy:{createdAt:'desc'},take:10,select:{id:true,status:true,attempts:true,sentAt:true,errorMessage:true,createdAt:true}})]);
  return {config,hasToken,counts,recent};
}
export function startNotificationDelivery() {const tick=()=>{void deliverNotifications().catch(()=>{});};tick();const timer=setInterval(tick,15000);timer.unref();return()=>clearInterval(timer);}
