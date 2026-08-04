const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api';
export async function apiGet<T>(path:string): Promise<T>{ const res=await fetch(`${API}${path}`); if(!res.ok) throw new Error(await res.text()); return res.json(); }
export async function apiSend<T>(path:string, method:string, body?:unknown): Promise<T>{ const res=await fetch(`${API}${path}`,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}); if(!res.ok) throw new Error(await res.text()); return res.json(); }
