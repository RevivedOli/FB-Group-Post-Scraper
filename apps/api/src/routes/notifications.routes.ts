import { Router } from 'express';
import { localControl } from './local-control.js';
import { discoverTelegramChats,notificationStatus,saveTelegramToken,telegramRequest,updateNotificationConfig } from '../services/notifications.service.js';
export const notificationsRouter=Router();
notificationsRouter.use(localControl);
notificationsRouter.get('/',async(_req,res,next)=>{try{res.json(await notificationStatus());}catch(error){next(error);}});
notificationsRouter.patch('/',async(req,res,next)=>{try{res.json(await updateNotificationConfig(req.body));}catch(error){next(error);}});
notificationsRouter.put('/token',async(req,res,next)=>{try{await saveTelegramToken(String(req.body?.token ?? ''));res.json({saved:true});}catch{next(new Error('Telegram token could not be saved. Check its format and macOS Keychain access.'));}});
notificationsRouter.post('/chats',async(_req,res,next)=>{try{res.json(await discoverTelegramChats());}catch(error){next(error);}});
notificationsRouter.post('/test',async(_req,res,next)=>{try{const {config}=await notificationStatus();if(!config.chatId)throw new Error('Save your private chat ID first.');await telegramRequest('sendMessage',{chat_id:config.chatId,text:'Local Group Monitor test notification. New referral alerts will appear here when enabled.'});res.json({sent:true});}catch(error){next(error);}});

notificationsRouter.post('/retry',async(_req,res,next)=>{try{const {prisma}=await import('../db/prisma.js');const result=await prisma.notificationDelivery.updateMany({where:{status:'failed'},data:{status:'retry',attempts:0,availableAt:new Date(),errorMessage:null}});res.json({retried:result.count});}catch(error){next(error);}});
