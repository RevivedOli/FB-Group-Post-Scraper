import { Router } from 'express';
import {
  CUSTOM_MODEL_SENTINEL,
  OPENAI_CURATED_MODELS,
  XAI_CURATED_MODELS,
  AI_PRICING_CATALOG_VERSION,
} from '@local-group-monitor/shared';
import { getSettings, updateSettings, defaultSettings } from '../services/settings.service.js';
import { deleteProviderApiKey, getProviderCredentialStatus, saveProviderApiKey } from '../services/ai-credentials.service.js';
import { getProviderConfig, listOllamaModels, testProviderConnection } from '../services/ai-provider.service.js';

export const settingsRouter = Router();

settingsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await getSettings());
  } catch (error) {
    next(error);
  }
});

settingsRouter.patch('/', async (req, res, next) => {
  try {
    res.json(await updateSettings(req.body));
  } catch (error) {
    next(error);
  }
});

settingsRouter.post('/reset', async (_req, res, next) => {
  try {
    res.json(await updateSettings(defaultSettings));
  } catch (error) {
    next(error);
  }
});

settingsRouter.get('/ai-models', async (_req, res, next) => {
  try {
    const settings = await getSettings();
    let ollamaModels: string[] = [];
    try {
      ollamaModels = await listOllamaModels(settings.ai.ollamaBaseUrl);
    } catch {
      ollamaModels = [];
    }
    res.json({
      catalogVersion: AI_PRICING_CATALOG_VERSION,
      customModelSentinel: CUSTOM_MODEL_SENTINEL,
      openai: OPENAI_CURATED_MODELS,
      xai: XAI_CURATED_MODELS,
      ollamaModels,
      active: getProviderConfig(settings),
    });
  } catch (error) {
    next(error);
  }
});

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

settingsRouter.post('/ai-credentials/test', async (_req, res, next) => {
  try {
    res.json(await testProviderConnection());
  } catch (error) {
    next(error);
  }
});
