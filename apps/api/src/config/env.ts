import fs from 'node:fs';
import path from 'node:path';
import { appPaths } from './paths.js';
for (const dir of [appPaths.dataDir, path.dirname(appPaths.databasePath), appPaths.backupsDir, appPaths.diagnosticsDir]) fs.mkdirSync(dir,{recursive:true});
process.env.DATABASE_URL ??= `file:${appPaths.databasePath}`;
export const env = { port:Number(process.env.PORT ?? 3001), databaseUrl:process.env.DATABASE_URL };
