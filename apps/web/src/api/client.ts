const API = import.meta.env.VITE_API_URL
  ?? (import.meta.env.PROD ? '/api' : 'http://localhost:3001/api');

async function readError(res: Response) {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as { error?: string };
    if (parsed?.error) return parsed.error;
  } catch {
    // keep raw text
  }
  return text || `Request failed with HTTP ${res.status}`;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function apiGetText(path: string): Promise<string> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(await readError(res));
  return res.text();
}

export async function apiSend<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}
