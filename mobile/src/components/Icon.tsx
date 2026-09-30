// The same line icons as the website (templates/_macros.html), drawn with SVG.
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type Shape = ['p', string] | ['c', number, number, number] | ['r', number, number, number, number, number];

const ICONS: Record<string, Shape[]> = {
  home: [['p', 'M3 10.5 12 3l9 7.5'], ['p', 'M5 9.5V21h14V9.5'], ['p', 'M10 21v-6h4v6']],
  list: [['p', 'M8 6h13M8 12h13M8 18h13'], ['c', 3.5, 6, 1], ['c', 3.5, 12, 1], ['c', 3.5, 18, 1]],
  plus: [['p', 'M12 5v14M5 12h14']],
  chart: [['p', 'M3 3v18h18'], ['p', 'M7 15l4-4 3 3 5-6']],
  wallet: [['r', 3, 6, 18, 14, 2], ['p', 'M3 10h18'], ['p', 'M16 15h2']],
  target: [['c', 12, 12, 9], ['c', 12, 12, 5], ['c', 12, 12, 1]],
  repeat: [['p', 'M17 2l4 4-4 4'], ['p', 'M3 11V9a3 3 0 0 1 3-3h15'], ['p', 'M7 22l-4-4 4-4'], ['p', 'M21 13v2a3 3 0 0 1-3 3H3']],
  calc: [['r', 5, 2, 14, 20, 2], ['p', 'M8 6h8'], ['p', 'M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h8']],
  settings: [['c', 12, 12, 3], ['p', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z']],
  logout: [['p', 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'], ['p', 'M16 17l5-5-5-5'], ['p', 'M21 12H9']],
  close: [['p', 'M18 6 6 18M6 6l12 12']],
  download: [['p', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'], ['p', 'M7 10l5 5 5-5'], ['p', 'M12 15V3']],
  upload: [['p', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'], ['p', 'M17 8l-5-5-5 5'], ['p', 'M12 3v12']],
  edit: [['p', 'M12 20h9'], ['p', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z']],
  trash: [['p', 'M3 6h18'], ['p', 'M8 6V4h8v2'], ['p', 'M19 6l-1 14H6L5 6']],
  check: [['p', 'M20 6 9 17l-5-5']],
  alert: [['p', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'], ['p', 'M12 9v4M12 17h.01']],
  info: [['c', 12, 12, 9], ['p', 'M12 16v-4M12 8h.01']],
  pause: [['p', 'M9 5v14M15 5v14']],
  play: [['p', 'M7 4l13 8-13 8z']],
  'chevron-left': [['p', 'M15 18l-6-6 6-6']],
  'chevron-right': [['p', 'M9 18l6-6-6-6']],
  'chevron-down': [['p', 'M6 9l6 6 6-6']],
  camera: [['p', 'M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z'], ['c', 12, 13.5, 3.5]],
  image: [['r', 3, 4, 18, 16, 2], ['c', 9, 10, 2], ['p', 'M21 16l-5-5-9 9']],
  scan: [['p', 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3'], ['p', 'M8 12h8']],
  search: [['c', 11, 11, 7], ['p', 'M20 20l-3.5-3.5']],
  filter: [['p', 'M3 5h18l-7 8v6l-4 2v-8z']],
  more: [['c', 5, 12, 1], ['c', 12, 12, 1], ['c', 19, 12, 1]],
  note: [['p', 'M5 3h10l4 4v14H5z'], ['p', 'M15 3v4h4'], ['p', 'M9 12h6M9 16h4']],
  mail: [['r', 3, 5, 18, 14, 2], ['p', 'M3 7l9 6 9-6']],
  lock: [['r', 5, 11, 14, 10, 2], ['p', 'M8 11V7a4 4 0 0 1 8 0v4']],
  user: [['c', 12, 8, 4], ['p', 'M4 21a8 8 0 0 1 16 0']],
};

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, color = '#000', strokeWidth = 1.8 }: {
  name: IconName; size?: number; color?: string; strokeWidth?: number;
}) {
  const shapes = ICONS[name] || ICONS.info;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round">
      {shapes.map((s, i) => {
        if (s[0] === 'p') return <Path key={i} d={s[1]} />;
        if (s[0] === 'c') return <Circle key={i} cx={s[1]} cy={s[2]} r={s[3]} />;
        return <Rect key={i} x={s[1]} y={s[2]} width={s[3]} height={s[4]} rx={s[5]} />;
      })}
    </Svg>
  );
}
