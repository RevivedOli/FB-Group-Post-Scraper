import { Router } from 'express';
import {
  createReferralMember,
  deleteReferralMember,
  generateReferralMatches,
  getReferralDirectory,
  listReferralMatches,
  updateReferralMatchStatus,
  updateReferralMember,
} from '../services/referrals.service.js';

export const referralsRouter = Router();

referralsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await getReferralDirectory());
  } catch (error) {
    next(error);
  }
});

referralsRouter.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await createReferralMember(req.body));
  } catch (error) {
    next(error);
  }
});

referralsRouter.patch('/:id', async (req, res, next) => {
  try {
    res.json(await updateReferralMember(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
});

referralsRouter.delete('/:id', async (req, res, next) => {
  try {
    res.json(await deleteReferralMember(req.params.id));
  } catch (error) {
    next(error);
  }
});

referralsRouter.post('/matches/generate', async (_req, res, next) => {
  try {
    res.json(await generateReferralMatches());
  } catch (error) {
    next(error);
  }
});

referralsRouter.get('/matches', async (req, res, next) => {
  try {
    res.json(await listReferralMatches(
      typeof req.query.status === 'string' ? req.query.status : 'suggested',
      Number(req.query.page ?? 1),
      Number(req.query.pageSize ?? 25),
    ));
  } catch (error) {
    next(error);
  }
});

referralsRouter.patch('/matches/:id', async (req, res, next) => {
  try {
    res.json(await updateReferralMatchStatus(req.params.id, req.body.status));
  } catch (error) {
    next(error);
  }
});
