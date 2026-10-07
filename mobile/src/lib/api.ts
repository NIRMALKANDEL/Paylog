import * as SecureStore from 'expo-secure-store';

import { setQuickNoteSession } from '../../modules/paylog-quicknote';

/** Paylog server. Override at build time with EXPO_PUBLIC_API_URL. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://devnirmal.pythonanywhere.com').replace(/\/$/, '');

const TOKEN_KEY = 'paylog.token';
const TIMEOUT_MS = 20000;

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(message: string, status: number, data: any = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

// The sign-in token lives in the phone's secure storage (Android Keystore /
// iOS Keychain), so it survives the app being closed, killed or updated.
// The Android widget's quick note saves without starting the app, so it gets
// its own (Keystore-encrypted) copy of the sign-in, kept in step here.
export async function loadToken() {
  token = await SecureStore.getItemAsync(TOKEN_KEY);
  setQuickNoteSession(API_URL, token);
  return token;
}

export async function saveToken(value: string | null) {
  token = value;
  if (value) await SecureStore.setItemAsync(TOKEN_KEY, value);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
  setQuickNoteSession(API_URL, value);
}

export function getToken() {
  return token;
}

/** Called when the server says the sign-in is no longer valid (401). */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

type Options = { method?: string; body?: unknown; form?: FormData; raw?: boolean };

export async function api<T = any>(path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: any;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1${path}`, {
      method: options.method || (body ? 'POST' : 'GET'),
      headers,
      body,
      signal: controller.signal,
    });
  } catch {
    // Offline or the server is waking up. Never sign the user out for this.
    throw new ApiError("Can't reach Paylog. Check your internet connection and try again.", 0);
  } finally {
    clearTimeout(timer);
  }

  if (options.raw && response.ok) return (await response.text()) as T;
  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (response.status === 401 && token) {
    onUnauthorized?.();
  }
  if (!response.ok) {
    throw new ApiError(data?.error || `Something went wrong (${response.status}).`, response.status, data);
  }
  return data as T;
}

export function errorMessage(err: unknown) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}
