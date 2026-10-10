// A short message at the bottom of the screen, with an optional action (Undo).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { useTheme } from './theme';

type Toast = { id: number; text: string; tone?: 'good' | 'info'; action?: { label: string; onPress: () => void } };
type Show = (toast: Omit<Toast, 'id'>) => void;

const ToastContext = createContext<Show>(() => {});
const SHOW_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback<Show>((next) => {
    if (timer.current) clearTimeout(timer.current);
    const id = Date.now();
    setToast({ ...next, id });
    timer.current = setTimeout(() => setToast((t) => (t?.id === id ? null : t)), SHOW_MS);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? <ToastBar key={toast.id} toast={toast} onClose={() => setToast(null)} /> : null}
    </ToastContext.Provider>
  );
}

function ToastBar({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const { colors, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  return (
    <Animated.View
      entering={reduced ? undefined : FadeInDown.springify().damping(18)}
      exiting={reduced ? undefined : FadeOutDown.duration(160)}
      accessibilityLiveRegion="polite"
      style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 84 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14,
        borderRadius: 18, backgroundColor: colors.ink, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 }, elevation: 8 }}>
        <Icon name={toast.tone === 'info' ? 'info' : 'check'} size={18} color={colors.bg} />
        <Text style={{ flex: 1, color: colors.bg, fontWeight: '600', fontSize: 14 }} numberOfLines={2}>{toast.text}</Text>
        {toast.action ? (
          <Pressable accessibilityRole="button" hitSlop={10} onPress={() => { onClose(); toast.action?.onPress(); }}>
            <Text style={{ color: dark ? colors.accentSoft : colors.accent2, fontWeight: '800', fontSize: 14 }}>{toast.action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
