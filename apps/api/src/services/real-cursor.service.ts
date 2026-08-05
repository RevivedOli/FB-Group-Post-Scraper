import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Page } from 'playwright-core';
import type { BrowserCursorCapability, BrowserCursorTestResult } from '@local-group-monitor/shared';

const execFileAsync = promisify(execFile);

interface RealCursorMoveOptions {
  durationMs: number;
  offsetX?: number;
  offsetY?: number;
}

function parseCursorPosition(value: string) {
  const [x, y] = value.trim().split(',').map((part) => Number(part));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
}

function formatAbsoluteCoordinate(value: number) {
  return value < 0 ? `=${value}` : String(value);
}

function formatMoveCommand(point: { x: number; y: number }) {
  return `m:${formatAbsoluteCoordinate(point.x)},${formatAbsoluteCoordinate(point.y)}`;
}

export async function getRealCursorCapability(): Promise<BrowserCursorCapability> {
  if (process.platform !== 'darwin') {
    return {
      supported: false,
      message: 'Real cursor permalink capture is currently implemented for macOS only.',
    };
  }

  try {
    const result = await execFileAsync('which', ['cliclick'], { timeout: 1500 });
    const command = result.stdout.trim();
    if (!command) throw new Error('cliclick was not found on PATH.');
    return {
      supported: true,
      tool: 'cliclick',
      command,
      message: 'Ready. macOS may still ask for Accessibility permission the first time the cursor is moved.',
    };
  } catch {
    return {
      supported: false,
      tool: 'cliclick',
      message: 'Install cliclick and allow Accessibility permission for the terminal/app running this server.',
    };
  }
}

async function pagePointToScreenPoint(page: Page, point: { x: number; y: number }) {
  const viewportMetrics = await page.evaluate((viewportPoint) => {
    const leftChrome = Math.max(0, Math.round((window.outerWidth - window.innerWidth) / 2));
    const topChrome = Math.max(0, Math.round(window.outerHeight - window.innerHeight - leftChrome));
    const visualOffsetX = Math.round(window.visualViewport?.offsetLeft ?? 0);
    const visualOffsetY = Math.round(window.visualViewport?.offsetTop ?? 0);

    return {
      x: Math.round(window.screenX + leftChrome + viewportPoint.x + visualOffsetX),
      y: Math.round(window.screenY + topChrome + viewportPoint.y + visualOffsetY),
      leftChrome,
      topChrome,
      outerWidth: window.outerWidth,
      innerWidth: window.innerWidth,
      outerHeight: window.outerHeight,
      innerHeight: window.innerHeight,
    };
  }, point);

  try {
    const session = await page.context().newCDPSession(page);
    const response = await session.send('Browser.getWindowForTarget' as never).catch(() => undefined) as
      | { bounds?: { left?: number; top?: number; width?: number; height?: number } }
      | undefined;
    await session.detach().catch(() => undefined);
    if (typeof response?.bounds?.left === 'number' && typeof response.bounds.top === 'number') {
      return {
        x: Math.round(response.bounds.left + viewportMetrics.leftChrome + point.x),
        y: Math.round(response.bounds.top + viewportMetrics.topChrome + point.y),
      };
    }
  } catch {
    // Fall back to browser-reported screen coordinates below.
  }

  return { x: viewportMetrics.x, y: viewportMetrics.y };
}

export async function moveRealCursorToPagePoint(page: Page, point: { x: number; y: number }, options: RealCursorMoveOptions) {
  const capability = await getRealCursorCapability();
  if (!capability.supported) {
    return { moved: false, capability, message: capability.message };
  }

  const calculatedPoint = await pagePointToScreenPoint(page, point);
  const screenPoint = {
    x: Math.round(calculatedPoint.x + (options.offsetX ?? 0)),
    y: Math.round(calculatedPoint.y + (options.offsetY ?? 0)),
  };
  try {
    await execFileAsync('cliclick', [formatMoveCommand(screenPoint)], { timeout: Math.max(2000, options.durationMs + 1500) });
    if (options.durationMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(5000, options.durationMs)));
    }
    return { moved: true, capability, screenPoint, message: `Real cursor moved to ${screenPoint.x},${screenPoint.y}.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      moved: false,
      capability,
      screenPoint,
      message: `Real cursor move failed: ${message}`,
    };
  }
}

export async function testRealCursorMovement(): Promise<BrowserCursorTestResult> {
  const capability = await getRealCursorCapability();
  if (!capability.supported) return { moved: false, message: capability.message };

  try {
    const beforeResult = await execFileAsync('cliclick', ['p'], { timeout: 1500 });
    const before = parseCursorPosition(beforeResult.stdout);
    if (!before) return { moved: false, message: `Could not read cursor position: ${beforeResult.stdout.trim()}` };

    const target = { x: before.x + 80, y: before.y };
    await execFileAsync('cliclick', [formatMoveCommand(target)], { timeout: 2000 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const afterResult = await execFileAsync('cliclick', ['p'], { timeout: 1500 });
    const after = parseCursorPosition(afterResult.stdout);
    const moved = Boolean(after && Math.abs(after.x - target.x) <= 2 && Math.abs(after.y - target.y) <= 2);

    return {
      moved,
      before,
      after,
      target,
      message: moved ? `Real cursor moved from ${before.x},${before.y} to ${after?.x},${after?.y}.` : `Cursor command ran, but position did not reach ${target.x},${target.y}.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { moved: false, message: `Real cursor test failed: ${message}` };
  }
}
