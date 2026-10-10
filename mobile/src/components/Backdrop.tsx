// The soft colour field behind every screen. The glass cards (ui.tsx Card) are
// translucent, so this is what gives them depth. Plain SVG gradients: no blur,
// so it costs nothing to draw, even on low-end Android phones.
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useTheme } from '@/lib/theme';

function Blob({ id, color, opacity }: { id: string; color: string; opacity: number }) {
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={opacity} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

/** `drift`: the blobs float very slowly (Home only). Off when the phone asks for reduced motion. */
export function Backdrop({ drift = false }: { drift?: boolean }) {
  const { colors, dark } = useTheme();
  const reduced = useReducedMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (!drift || reduced) return;
    t.value = withRepeat(withTiming(1, { duration: 14000, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [drift, reduced, t]);

  const a = useAnimatedStyle(() => ({ transform: [{ translateX: -30 + t.value * 60 }, { translateY: t.value * 40 }] }));
  const b = useAnimatedStyle(() => ({ transform: [{ translateX: 20 - t.value * 50 }, { translateY: -t.value * 30 }] }));
  const strength = dark ? 0.5 : 0.38;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg, overflow: 'hidden' }]}>
      <Animated.View style={[{ position: 'absolute', width: 520, height: 520, top: -200, left: -160 }, a]}>
        <Blob id="bd-a" color={colors.accent} opacity={strength} />
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', width: 460, height: 460, top: 120, right: -220 }, b]}>
        <Blob id="bd-b" color={colors.accent2} opacity={strength * 0.75} />
      </Animated.View>
      <View style={{ position: 'absolute', width: 600, height: 600, bottom: -340, left: -120 }}>
        <Blob id="bd-c" color={dark ? colors.income : colors.accent} opacity={strength * 0.45} />
      </View>
    </View>
  );
}
