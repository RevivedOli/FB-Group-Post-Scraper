export type BrowserSessionState = 'closed' | 'opening' | 'ready' | 'error';

export interface BrowserSessionStatus {
  state: BrowserSessionState;
  isOpen: boolean;
  currentUrl?: string;
  profileDirectory: string;
  lastLoginCheckAt?: string;
  loggedIn?: boolean;
  lastError?: string;
}
