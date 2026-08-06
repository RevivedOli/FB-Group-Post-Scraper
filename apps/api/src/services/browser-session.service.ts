import fs from 'node:fs';
import type { BrowserContext, Page } from 'playwright-core';
import { chromium } from 'playwright-core';
import type { BrowserSessionStatus } from '@local-group-monitor/shared';
import { appPaths } from '../config/paths.js';
import { getSettings } from './settings.service.js';

const FACEBOOK_HOME_URL = 'https://www.facebook.com/';
const FACEBOOK_LOGIN_URL = 'https://www.facebook.com/login/';

let context: BrowserContext | undefined;
let page: Page | undefined;
let state: BrowserSessionStatus['state'] = 'closed';
let loggedIn: boolean | undefined;
let lastLoginCheckAt: string | undefined;
let lastError: string | undefined;

async function currentUrl() {
  try {
    return page?.url();
  } catch {
    return undefined;
  }
}

export async function getBrowserStatus(): Promise<BrowserSessionStatus> {
  return {
    state,
    isOpen: Boolean(context && page && !page.isClosed()),
    currentUrl: await currentUrl(),
    profileDirectory: appPaths.browserProfileDir,
    lastLoginCheckAt,
    loggedIn,
    lastError,
  };
}

async function ensureBrowser() {
  if (context && page && !page.isClosed()) return page;

  state = 'opening';
  lastError = undefined;
  fs.mkdirSync(appPaths.browserProfileDir, { recursive: true });

  try {
    const settings = await getSettings();
    context = await chromium.launchPersistentContext(appPaths.browserProfileDir, {
      channel: settings.browser.chromeChannel || 'chrome',
      headless: !settings.browser.headed,
      viewport: null,
      acceptDownloads: false,
      timeout: settings.browser.pageLoadTimeoutMs,
    });
    page = context.pages()[0] ?? await context.newPage();
    page.setDefaultTimeout(settings.browser.pageLoadTimeoutMs);
    page.setDefaultNavigationTimeout(settings.browser.pageLoadTimeoutMs);
    context.on('close', () => {
      context = undefined;
      page = undefined;
      state = 'closed';
    });
    state = 'ready';
    return page;
  } catch (error) {
    context = undefined;
    page = undefined;
    state = 'error';
    lastError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

export async function getManagedPage() {
  return ensureBrowser();
}

function isNavigationTimeout(error: unknown) {
  if (error instanceof Error && error.name === 'TimeoutError') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /Timeout \d+ms exceeded/i.test(message) || /Navigation timeout/i.test(message);
}

async function recoverStuckPage(browserPage: Page) {
  // Facebook sometimes hangs mid-navigation; stop the load, refresh, then retry.
  await browserPage.evaluate(() => window.stop()).catch(() => undefined);
  try {
    await browserPage.reload({ waitUntil: 'domcontentloaded' });
  } catch {
    await browserPage.goto('about:blank', { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

/**
 * Navigate with timeout recovery: on page.goto timeout, refresh (or blank) and retry.
 * Matches the manual fix of refreshing a stuck Facebook tab.
 */
export async function navigateManagedPage(url: string, options: {
  maxAttempts?: number;
  onRetry?: (info: { url: string; attempt: number; maxAttempts: number; error: string }) => void | Promise<void>;
} = {}) {
  const browserPage = await ensureBrowser();
  const settings = await getSettings();
  const maxAttempts = Math.max(1, Math.min(5, options.maxAttempts ?? 3));
  const timeout = settings.browser.pageLoadTimeoutMs;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await browserPage.goto(url, { waitUntil: 'domcontentloaded', timeout });
      return browserPage;
    } catch (error) {
      lastError = error;
      if (!isNavigationTimeout(error) || attempt >= maxAttempts) throw error;

      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[browser] Navigation timeout (${attempt}/${maxAttempts}) for ${url}; refreshing and retrying.`);
      await options.onRetry?.({ url, attempt, maxAttempts, error: message });
      await recoverStuckPage(browserPage);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function openFacebookLogin() {
  const browserPage = await ensureBrowser();
  await browserPage.goto(FACEBOOK_LOGIN_URL, { waitUntil: 'domcontentloaded' });
  return getBrowserStatus();
}

export async function openFacebookHome() {
  const browserPage = await ensureBrowser();
  await browserPage.goto(FACEBOOK_HOME_URL, { waitUntil: 'domcontentloaded' });
  return getBrowserStatus();
}

export async function checkFacebookLogin() {
  const browserPage = await ensureBrowser();
  await browserPage.goto(FACEBOOK_HOME_URL, { waitUntil: 'domcontentloaded' });

  const url = browserPage.url();
  const hasLoginForm = await browserPage
    .locator('input[name="email"], input[name="pass"], form[action*="login"]')
    .count();
  loggedIn = url.includes('facebook.com') && !url.includes('/login') && hasLoginForm === 0;
  lastLoginCheckAt = new Date().toISOString();

  return getBrowserStatus();
}

export async function closeBrowserSession() {
  await context?.close();
  context = undefined;
  page = undefined;
  state = 'closed';
  return getBrowserStatus();
}
