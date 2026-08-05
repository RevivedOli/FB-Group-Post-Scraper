export interface BrowserCursorCapability {
  supported: boolean;
  tool?: 'cliclick';
  command?: string;
  message: string;
}

export interface BrowserCursorTestResult {
  moved: boolean;
  before?: { x: number; y: number };
  after?: { x: number; y: number };
  target?: { x: number; y: number };
  message: string;
}
