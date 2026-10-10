import { forwardRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text,
  TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

import { friendlyDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { statusColor, useTheme } from '@/lib/theme';
import type { Kind, Transaction } from '@/lib/types';
import { Backdrop } from './Backdrop';
import { Icon, type IconName } from './Icon';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** A gentle press-in scale, the "it heard me" feedback. Skipped with reduced motion. */
export function usePressScale(to = 0.97) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return {
    style,
    onPressIn: () => { if (!reduced) scale.set(withTiming(to, { duration: 90 })); },
    onPressOut: () => { if (!reduced) scale.set(withSpring(1, { damping: 14, stiffness: 260 })); },
  };
}

// ------------------------------------------------------------------ //
// Layout                                                              //
// ------------------------------------------------------------------ //

/** Space a tab screen leaves at the bottom so its content can scroll clear of the floating tab bar. */
export const TAB_BAR_HEIGHT = 62;

export function Screen({ children, refreshing, onRefresh, scroll = true, padded = true, bottomInset = true, drift = false,
  tabBar = false }: {
  children: ReactNode; refreshing?: boolean; onRefresh?: () => void; scroll?: boolean; padded?: boolean;
  bottomInset?: boolean; drift?: boolean; tabBar?: boolean;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = tabBar ? insets.bottom + TAB_BAR_HEIGHT + 24 : (bottomInset ? insets.bottom : 0) + 32;
  const pad = { padding: padded ? 16 : 0, paddingBottom: bottom };
  if (!scroll) {
    return (
      <View style={[{ flex: 1, backgroundColor: colors.bg }, pad]}>
        <Backdrop drift={drift} />
        {children}
      </View>
    );
  }
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Backdrop drift={drift} />
      <ScrollView
        contentContainerStyle={[pad, { gap: 14 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? (
          <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />
        ) : undefined}>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** A frosted-glass panel. `strong` is less see-through, for forms and dense numbers. */
export function Card({ children, style, strong }: { children: ReactNode; style?: StyleProp<ViewStyle>; strong?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[{
      backgroundColor: strong ? colors.glassStrong : colors.glass, borderRadius: 20, borderWidth: 1,
      borderColor: colors.glassBorder, padding: 16, gap: 10,
      shadowColor: colors.shadow, shadowOpacity: 1, shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
    }, style]}>
      {children}
    </View>
  );
}

export function Row({ children, style, gap = 8 }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

// ------------------------------------------------------------------ //
// Text                                                                //
// ------------------------------------------------------------------ //

type TProps = { children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number; selectable?: boolean };

function makeText(variant: (c: ReturnType<typeof useTheme>['colors']) => TextStyle) {
  return function T({ children, style, numberOfLines, selectable }: TProps) {
    const { colors } = useTheme();
    return <Text style={[variant(colors), style]} numberOfLines={numberOfLines} selectable={selectable}>{children}</Text>;
  };
}

export const H1 = makeText((c) => ({ fontSize: 26, fontWeight: '700', color: c.ink, letterSpacing: -0.4 }));
export const H2 = makeText((c) => ({ fontSize: 17, fontWeight: '700', color: c.ink }));
export const Body = makeText((c) => ({ fontSize: 15, color: c.inkSoft, lineHeight: 21 }));
export const Muted = makeText((c) => ({ fontSize: 13, color: c.muted, lineHeight: 18 }));
export const Label = makeText((c) => ({ fontSize: 13, fontWeight: '600', color: c.muted }));

export function Money({ cents, currency, style, kind }: {
  cents: number; currency: string; style?: StyleProp<TextStyle>; kind?: 'expense' | 'income';
}) {
  const { colors } = useTheme();
  const color = kind === 'income' ? colors.credit : colors.ink;
  const sign = kind === 'income' ? '+' : kind === 'expense' ? '−' : '';
  return (
    <Text style={[{ fontSize: 15, fontWeight: '700', color, fontVariant: ['tabular-nums'] }, style]}>
      {sign}{formatMoney(cents, currency)}
    </Text>
  );
}

// ------------------------------------------------------------------ //
// Controls                                                            //
// ------------------------------------------------------------------ //

export function Button({ title, onPress, variant = 'primary', icon, loading, disabled, style, small }: {
  title: string; onPress?: () => void; variant?: 'primary' | 'ghost' | 'danger' | 'soft'; icon?: IconName;
  loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; small?: boolean;
}) {
  const { colors } = useTheme();
  const bg = { primary: colors.accent, ghost: 'transparent', danger: colors.danger, soft: colors.accentSoft }[variant];
  const fg = { primary: colors.onAccent, ghost: colors.ink, danger: '#fff', soft: colors.accentText }[variant];
  const off = disabled || loading;
  const press = usePressScale();
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={off ? undefined : onPress}
      onPressIn={off ? undefined : press.onPressIn}
      onPressOut={press.onPressOut}
      style={[{
        backgroundColor: variant === 'ghost' ? colors.glass : bg, borderRadius: 14,
        paddingVertical: small ? 9 : 14, paddingHorizontal: small ? 12 : 16, minHeight: small ? 38 : 48,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        borderWidth: variant === 'ghost' ? 1 : 0, borderColor: colors.glassBorder, opacity: off ? 0.55 : 1,
      }, variant === 'primary' && !off ? {
        shadowColor: colors.accent, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 3,
      } : null, press.style, style]}>
      {loading ? <ActivityIndicator color={fg} size="small" /> : icon ? <Icon name={icon} size={small ? 16 : 18} color={fg} /> : null}
      <Text style={{ color: fg, fontWeight: '700', fontSize: small ? 14 : 15 }}>{title}</Text>
    </AnimatedPressable>
  );
}

export function IconButton({ icon, onPress, label, color, size = 20 }: {
  icon: IconName; onPress: () => void; label: string; color?: string; size?: number;
}) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={10}
      style={({ pressed }) => ({ padding: 8, borderRadius: 10, opacity: pressed ? 0.6 : 1 })}>
      <Icon name={icon} size={size} color={color || colors.muted} />
    </Pressable>
  );
}

export const Field = forwardRef<TextInput, TextInputProps & { label?: string; hint?: string; error?: string | null }>(
  function Field({ label, hint, error, style, ...props }, ref) {
    const { colors } = useTheme();
    return (
      <View style={{ gap: 6 }}>
        {label ? <Label>{label}</Label> : null}
        <TextInput
          ref={ref}
          placeholderTextColor={colors.faint}
          style={[{
            backgroundColor: colors.glassStrong, color: colors.ink, borderWidth: 1,
            borderColor: error ? colors.danger : colors.glassBorder, borderRadius: 14, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 13 : 10, fontSize: 16,
          }, style]}
          {...props}
        />
        {error ? <Text style={{ color: colors.danger, fontSize: 13 }}>{error}</Text> : hint ? <Muted>{hint}</Muted> : null}
      </View>
    );
  },
);

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!active }}
      hitSlop={4}
      style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
        backgroundColor: active ? colors.accent : colors.glass, borderColor: active ? colors.accent : colors.glassBorder }}>
      <Text style={{ color: active ? colors.onAccent : colors.inkSoft, fontWeight: '600', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export function Chips<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
      {options.map((o) => <Chip key={o.value} label={o.label} active={o.value === value} onPress={() => onChange(o.value)} />)}
    </ScrollView>
  );
}

/** A segmented control whose highlight slides to the chosen option. */
export function Segmented<T extends string>({ options, value, onChange, big }: {
  options: { value: T; label: string; color?: string }[]; value: T; onChange: (v: T) => void; big?: boolean;
}) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const segment = width ? (width - 6) / options.length : 0;
  const target = index * segment;
  const pill = useAnimatedStyle(() => ({
    transform: [{ translateX: reduced ? target : withSpring(target, { damping: 18, stiffness: 220 }) }],
  }), [target, reduced]);
  const activeColor = options[index]?.color;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessibilityRole="radiogroup"
      style={{ flexDirection: 'row', backgroundColor: colors.glass, borderRadius: 16, padding: 3, borderWidth: 1,
        borderColor: colors.glassBorder }}>
      {segment ? (
        <Animated.View style={[{ position: 'absolute', top: 3, bottom: 3, left: 3, width: segment, borderRadius: 13,
          backgroundColor: activeColor || colors.glassStrong,
          shadowColor: colors.shadow, shadowOpacity: 1, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 }, pill]} />
      ) : null}
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            style={{ flex: 1, paddingVertical: big ? 12 : 9, borderRadius: 13, alignItems: 'center' }}>
            <Text style={{ fontWeight: '800', fontSize: big ? 16 : 14,
              color: active ? (o.color ? '#fff' : colors.ink) : colors.muted }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** − Debit / + Credit: the direction flag every transaction carries. */
export function DirectionSwitch({ value, onChange }: { value: Kind; onChange: (v: Kind) => void }) {
  const { colors } = useTheme();
  return (
    <Segmented<Kind> big value={value} onChange={onChange} options={[
      { value: 'expense', label: '−  Debit', color: colors.debit },
      { value: 'income', label: '+  Credit', color: colors.credit },
    ]} />
  );
}

export function Progress({ percent, status }: { percent: number; status: 'good' | 'warning' | 'critical' }) {
  const { colors } = useTheme();
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.cardAlt, overflow: 'hidden' }}
      accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(percent) }}>
      <View style={{ width: `${Math.min(Math.max(percent, 0), 100)}%`, height: 8, borderRadius: 4,
        backgroundColor: status === 'good' ? colors.accent : statusColor(colors, status).fg }} />
    </View>
  );
}

// ------------------------------------------------------------------ //
// Feedback                                                            //
// ------------------------------------------------------------------ //

export function Notice({ tone = 'info', children }: { tone?: 'good' | 'warning' | 'critical' | 'info'; children: ReactNode }) {
  const { colors } = useTheme();
  const c = statusColor(colors, tone);
  return (
    <View style={{ flexDirection: 'row', gap: 8, backgroundColor: c.bg, padding: 12, borderRadius: 12, alignItems: 'flex-start' }}>
      <Icon name={tone === 'good' ? 'check' : tone === 'info' ? 'info' : 'alert'} size={17} color={c.fg} />
      <Text style={{ color: c.fg, flex: 1, fontSize: 14, lineHeight: 19 }}>{children}</Text>
    </View>
  );
}

export function Loading() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, backgroundColor: colors.bg }}>
      <ActivityIndicator color={colors.accent} size="large" />
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
      <Body style={{ textAlign: 'center' }}>{message}</Body>
      <Button title="Try again" variant="soft" small onPress={onRetry} />
    </Card>
  );
}

export function Empty({ icon = 'note', title, text, action }: { icon?: IconName; title: string; text?: string; action?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', padding: 24, gap: 8 }}>
      <View style={{ backgroundColor: colors.accentSoft, borderRadius: 999, padding: 14 }}>
        <Icon name={icon} size={26} color={colors.accentText} />
      </View>
      <H2 style={{ textAlign: 'center' }}>{title}</H2>
      {text ? <Muted style={{ textAlign: 'center' }}>{text}</Muted> : null}
      {action}
    </View>
  );
}

// ------------------------------------------------------------------ //
// Domain                                                              //
// ------------------------------------------------------------------ //

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityLabel="Paylog">
      <Rect width="64" height="64" rx="15" fill="#0e5e56" />
      <Path d="M19 12h26a4 4 0 0 1 4 4v36l-4-3-4 3-4-3-4 3-4-3-4 3-4-3-4 3V16a4 4 0 0 1 4-4z" fill="#fbf8f1" />
      <Path d="M27 42V21h7a6.5 6.5 0 0 1 0 13h-7" fill="none" stroke="#0e5e56" strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M37 42h5" stroke="#e8a33d" strokeWidth={5.5} strokeLinecap="round" />
    </Svg>
  );
}

export function TxRow({ tx, currency, onPress }: { tx: Transaction; currency: string; onPress?: () => void }) {
  const { colors } = useTheme();
  const income = tx.kind === 'income';
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      accessibilityLabel={`${tx.description || tx.category}, ${formatMoney(tx.amount_cents, currency)}, ${friendlyDate(tx.date)}`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, opacity: pressed ? 0.6 : 1 })}>
      <View style={{ width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
        backgroundColor: income ? colors.goodBg : colors.accentSoft }}>
        <Text style={{ fontWeight: '800', color: income ? colors.credit : colors.accentText }}>{tx.category.slice(0, 1)}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{tx.description || tx.category}</Text>
        <Text style={{ color: colors.muted, fontSize: 12.5 }} numberOfLines={1}>
          {tx.category} · {friendlyDate(tx.date)}{tx.time ? ` ${tx.time}` : ''}{tx.method ? ` · ${tx.method}` : ''}{tx.recurring ? ' · recurring' : ''}
        </Text>
      </View>
      <Money cents={tx.amount_cents} currency={currency} kind={tx.kind} />
    </Pressable>
  );
}

export function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />;
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Muted>{label}</Muted>
      <Text style={{ fontSize: 18, fontWeight: '800', color: tone || colors.ink, fontVariant: ['tabular-nums'] }}
        numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}
