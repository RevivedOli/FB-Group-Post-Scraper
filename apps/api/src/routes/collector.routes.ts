import { Router } from 'express';
import { localControl } from './local-control.js';
import { collectorBridgeStatus, syncCollectorBridge } from '../services/collector-bridge.service.js';
import { collectorWorkerStatus, startCollectorWorker, stopCollectorWorker } from '../services/collector-worker.service.js';
import { getCycleEstimate } from '../services/collector-estimate.service.js';
import { recurringConfig, updateRecurring } from '../services/collector-schedule.service.js';
export const collectorRouter = Router();
collectorRouter.use(localControl);
collectorRouter.get('/status', (_req, res) => { res.json(collectorBridgeStatus()); });
collectorRouter.post('/sync', async (_req, res, next) => {
  try { const result = await syncCollectorBridge(); res.status(result.error ? 503 : 200).json(result); }
  catch (error) { next(error); }
});

collectorRouter.get('/worker', (_req,res)=>{res.json(collectorWorkerStatus());});
collectorRouter.post('/worker/start', async (req,res,next)=>{try{res.json(await startCollectorWorker(req.body ?? {}));}catch(error){next(error);}});
collectorRouter.post('/worker/stop', async (_req,res,next)=>{try{await updateRecurring({enabled:false});res.json(stopCollectorWorker());}catch(error){next(error);}});
collectorRouter.get('/schedule',async(_req,res,next)=>{try{res.json(await recurringConfig());}catch(error){next(error);}});
collectorRouter.patch('/schedule',async(req,res,next)=>{try{res.json(await updateRecurring(req.body));}catch(error){next(error);}});

collectorRouter.get('/schedule/estimate',async(req,res,next)=>{try{res.json(await getCycleEstimate(Number(req.query.maxPages ?? 5),Number(req.query.limit ?? 50),Object.fromEntries(['requestMinSeconds','requestMaxSeconds','pageMinSeconds','pageMaxSeconds','groupMinSeconds','groupMaxSeconds','groupDeadlineSeconds'].filter(key=>req.query[key]!==undefined).map(key=>[key,Number(req.query[key])]))));}catch(error){next(error);}});
