import { Router } from 'express';
import { getSettings, updateSettings, defaultSettings } from '../services/settings.service.js';
import { deleteProviderApiKey, getProviderCredentialStatus, saveProviderApiKey } from '../services/ai-credentials.service.js';
export const settingsRouter=Router();
settingsRouter.get('/',async (_req,res)=>res.json(await getSettings()));
settingsRouter.patch('/',async (req,res)=>res.json(await updateSettings(req.body)));
settingsRouter.post('/reset',async (_req,res)=>res.json(await updateSettings(defaultSettings)));
settingsRouter.get('/ai-credentials', async (_req, res, next) => {
  try {
    res.json(await getProviderCredentialStatus());
  } catch (error) {
    next(error);
  }
});
settingsRouter.put('/ai-credentials/:provider', async (req, res, next) => {
  try {
    await saveProviderApiKey(req.params.provider, String(req.body?.apiKey ?? ''));
    res.json({ saved: true, provider: req.params.provider });
  } catch (error) {
    next(error);
  }
});
settingsRouter.delete('/ai-credentials/:provider', async (req, res, next) => {
  try {
    await deleteProviderApiKey(req.params.provider);
    res.json({ deleted: true, provider: req.params.provider });
  } catch (error) {
    next(error);
  }
});
