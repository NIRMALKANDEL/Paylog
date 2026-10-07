import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { api, errorMessage } from './api';

/**
 * GET `path` whenever the screen comes into focus or the app comes back to the
 * front (the widget's quick note may have saved entries meanwhile); keeps
 * showing old data while refreshing.
 */
export function useData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(path);
  useEffect(() => {
    latest.current = path;
  }, [path]);

  const load = useCallback(async (manual = false) => {
    if (!path) return;
    if (manual) setRefreshing(true);
    try {
      const result = await api<T>(path);
      if (latest.current === path) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (latest.current === path) setError(errorMessage(err));
    } finally {
      if (manual) setRefreshing(false);
    }
  }, [path]);

  useFocusEffect(
    useCallback(() => {
      load();
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') load();
      });
      return () => sub.remove();
    }, [load]),
  );

  return { data, setData, error, refreshing, reload: load, refresh: () => load(true) };
}
