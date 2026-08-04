import { Router } from 'express';
import { getSettings, updateSettings, defaultSettings } from '../services/settings.service.js';
export const settingsRouter=Router();
settingsRouter.get('/',async (_req,res)=>res.json(await getSettings()));
settingsRouter.patch('/',async (req,res)=>res.json(await updateSettings(req.body)));
settingsRouter.post('/reset',async (_req,res)=>res.json(await updateSettings(defaultSettings)));
