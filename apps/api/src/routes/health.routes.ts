import { Router } from 'express';
import { prisma } from '../db/prisma.js';
export const healthRouter=Router();
healthRouter.get('/',async (_req,res)=>{ await prisma.$queryRaw`SELECT 1`; res.json({ok:true, service:'api'}); });
