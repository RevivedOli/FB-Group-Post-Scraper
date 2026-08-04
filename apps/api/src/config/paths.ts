import os from 'node:os';
import path from 'node:path';
export function getAppDataDir(){ return process.env.FB_MONITOR_DATA_DIR ?? path.join(os.homedir(),'Library','Application Support','FacebookGroupMonitor'); }
export const appPaths = { dataDir:getAppDataDir(), databasePath:path.join(getAppDataDir(),'database','app.sqlite'), browserProfileDir:path.join(getAppDataDir(),'browser-profile'), backupsDir:path.join(getAppDataDir(),'backups'), diagnosticsDir:path.join(getAppDataDir(),'diagnostics') };
