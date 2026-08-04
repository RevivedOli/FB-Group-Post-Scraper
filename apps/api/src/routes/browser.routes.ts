import { Router } from 'express';
import {
  checkFacebookLogin,
  closeBrowserSession,
  getBrowserStatus,
  openFacebookHome,
  openFacebookLogin,
} from '../services/browser-session.service.js';

export const browserRouter = Router();

browserRouter.get('/status', async (_req, res, next) => {
  try {
    res.json(await getBrowserStatus());
  } catch (error) {
    next(error);
  }
});

browserRouter.post('/open-login', async (_req, res, next) => {
  try {
    res.json(await openFacebookLogin());
  } catch (error) {
    next(error);
  }
});

browserRouter.post('/open-home', async (_req, res, next) => {
  try {
    res.json(await openFacebookHome());
  } catch (error) {
    next(error);
  }
});

browserRouter.post('/check-login', async (_req, res, next) => {
  try {
    res.json(await checkFacebookLogin());
  } catch (error) {
    next(error);
  }
});

browserRouter.post('/close', async (_req, res, next) => {
  try {
    res.json(await closeBrowserSession());
  } catch (error) {
    next(error);
  }
});
