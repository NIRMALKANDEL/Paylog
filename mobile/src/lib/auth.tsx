import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, ApiError, loadToken, saveToken, setUnauthorizedHandler } from './api';
import type { User } from './types';
import { clearWidgets } from './widget';

const USER_KEY = 'paylog.user';

type AuthState = {
  status: 'loading' | 'signedOut' | 'signedIn';
  user: User | null;
  lastUser: User | null;
  signIn: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<{ verificationSent: boolean }>;
  signOut: () => Promise<void>;
  setUser: (user: User) => void;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function deviceName() {
  return [Device.manufacturer, Device.modelName].filter(Boolean).join(' ').slice(0, 80);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [user, setUserState] = useState<User | null>(null);
  // Screens still on their way out after sign-out keep reading the last user
  // instead of crashing on null.
  const [lastUser, setLastUser] = useState<User | null>(null);

  const setUser = useCallback((next: User) => {
    setUserState(next);
    setLastUser(next);
    SecureStore.setItemAsync(USER_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const clearLocal = useCallback(async () => {
    await saveToken(null);
    await SecureStore.deleteItemAsync(USER_KEY).catch(() => {});
    setUserState(null);
    setStatus('signedOut');
    clearWidgets();
  }, []);

  const refreshUser = useCallback(async () => {
    const data = await api<{ user: User }>('/me');
    setUser(data.user);
  }, [setUser]);

  // Start-up: a saved token means "signed in", even offline. Only the server
  // answering 401 (expired, signed out elsewhere, password changed) ends it.
  useEffect(() => {
    let alive = true;
    (async () => {
      const token = await loadToken();
      if (!token) {
        if (alive) setStatus('signedOut');
        return;
      }
      const cached = await SecureStore.getItemAsync(USER_KEY).catch(() => null);
      if (cached && alive) {
        try {
          const parsed = JSON.parse(cached);
          setUserState(parsed);
          setLastUser(parsed);
        } catch {
          /* ignore a corrupt cache */
        }
      }
      if (alive) setStatus('signedIn');
      // Refresh the profile; without a cached copy keep retrying until the network is back.
      for (let attempt = 0; alive; attempt++) {
        try {
          const data = await api<{ user: User }>('/me');
          if (alive) setUser(data.user);
          return;
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            if (alive) await clearLocal();
            return;
          }
          if (cached) return;
          await new Promise((resolve) => setTimeout(resolve, Math.min(2000 * (attempt + 1), 10000)));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [clearLocal, setUser]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearLocal();
    });
    return () => setUnauthorizedHandler(null);
  }, [clearLocal]);

  const signIn = useCallback(async (email: string, password: string) => {
    const data = await api<{ token: string; user: User }>('/auth/login', {
      body: { email, password, device: deviceName() },
    });
    await saveToken(data.token);
    setUser(data.user);
    setStatus('signedIn');
  }, [setUser]);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const data = await api<{ token: string; user: User; verification_sent: boolean }>('/auth/register', {
      body: { name, email, password, device: deviceName() },
    });
    await saveToken(data.token);
    setUser(data.user);
    setStatus('signedIn');
    return { verificationSent: data.verification_sent };
  }, [setUser]);

  const signOut = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      /* signing out locally still works offline */
    }
    await clearLocal();
  }, [clearLocal]);

  const value = useMemo(
    () => ({ status, user, lastUser: user ?? lastUser, signIn, register, signOut, setUser, refreshUser }),
    [status, user, lastUser, signIn, register, signOut, setUser, refreshUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

/** The signed-in user (screens behind the auth gate only). */
export function useUser() {
  const { lastUser } = useAuth();
  return lastUser as User;
}
