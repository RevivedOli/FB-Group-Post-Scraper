import './config/env.js';
import { app } from './app.js';
import { initializeDatabase } from './db/prisma.js';
import { env } from './config/env.js';
import { assertAiSchemaReady, SchemaOutOfDateError } from './db/schema-preflight.js';
import { dedupeAiMemberMatches, resumeAiQueueIfNeeded } from './services/ai-assessment.service.js';
import { recoverOrphanedScrapeRuns } from './services/runs.service.js';

import { stopCollectorWorker } from './services/collector-worker.service.js';
import { startCollectorBridge } from './services/collector-bridge.service.js';

import { startNotificationDelivery } from './services/notifications.service.js';
import { startRecurringCollector } from './services/collector-schedule.service.js';

import {initializeVisitors} from './services/visitors.service.js';

async function start() {
  await initializeDatabase();
  await initializeVisitors();
  try {
    await assertAiSchemaReady();
  } catch (error) {
    if (error instanceof SchemaOutOfDateError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  try {
    const dedupe = await dedupeAiMemberMatches();
    if (dedupe.removed > 0) {
      console.log(`Removed ${dedupe.removed} duplicate AI member match(es).`);
    }
  } catch (error) {
    console.error('AI member match dedupe failed:', error);
  }

  try {
    const recovered = await recoverOrphanedScrapeRuns();
    if (recovered.recovered > 0) {
      console.log(`Marked ${recovered.recovered} interrupted scrape run(s) as failed.`);
    }
  } catch (error) {
    console.error('Scrape run recovery failed:', error);
  }

  const stopBridge = startCollectorBridge();
  const stopNotifications = startNotificationDelivery();
  const stopRecurring = startRecurringCollector();
  const server = app.listen(env.port, '127.0.0.1', () => {
    console.log(`API listening on http://localhost:${env.port}`);
    setTimeout(() => {
      void resumeAiQueueIfNeeded().catch((resumeError) => {
        console.error('AI queue resume failed:', resumeError);
      });
    }, 1000).unref();
  });

  function shutdown() {
    stopBridge();
    stopNotifications();
    stopRecurring();
    stopCollectorWorker();
    server.closeAllConnections?.();
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => {
      process.exit(0);
    }, 1000).unref();
  }

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

void start().catch((error) => {
  console.error('API failed to start:', error);
  process.exit(1);
});
