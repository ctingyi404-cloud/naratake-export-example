'use client';

/* Tiny fetch helpers used by storefront components (client side). */

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api/v1${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: { code: string; message?: string } };
  if (!res.ok) {
    const err = new Error(data.error?.message ?? data.error?.code ?? `POST ${path} failed`);
    (err as Error & { code?: string; payload?: unknown }).code = data.error?.code;
    (err as Error & { payload?: unknown }).payload = data;
    throw err;
  }
  return data;
}
