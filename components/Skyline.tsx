// =============================================================================
// OutNYC — illustrated NYC skyline (components/Skyline.tsx)
// =============================================================================
// A vector "sunset over Manhattan" hero with RECOGNIZABLE landmarks — One World
// Trade Center's tapered spire, the Empire State Building's stepped mast, a
// Chrysler-style crown — plus generic infill, lit windows, and a time-of-day
// gradient sky. Pure react-native-svg: crisp at any size, themeable, no assets.
// =============================================================================

import { Platform, View, ViewStyle } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Polygon,
  Rect,
  Stop,
} from 'react-native-svg';

import { sky, TimeOfDay } from '../lib/theme';

const VB_W = 400;
const VB_H = 220;
const G0 = 220; // ground line

// Generic infill buildings: [x, width, height-from-ground].
const GENERIC: [number, number, number][] = [
  [-6, 30, 70],
  [58, 22, 96],
  [82, 18, 66],
  [102, 28, 112],
  [178, 16, 82],
  [230, 28, 92],
  [262, 22, 136],
  [292, 34, 78],
  [328, 26, 118],
  [360, 30, 88],
  [390, 18, 62],
];

const FAR: [number, number, number][] = [
  [-6, 40, 54], [40, 34, 82], [82, 46, 60], [130, 30, 96],
  [168, 52, 70], [224, 34, 100], [268, 44, 62], [318, 40, 88], [364, 44, 58],
];

// Lit windows (x,y) for evening/night.
const WINDOWS: [number, number][] = [
  [64, 140], [70, 156], [64, 172],
  [108, 120], [116, 138], [108, 156], [116, 174],
  [148, 116], [158, 134], [168, 116], [148, 150], [168, 150], [158, 168],
  [206, 122], [214, 140], [206, 158], [214, 176],
  [268, 100], [268, 120], [276, 110], [268, 140], [276, 150],
  [334, 120], [342, 138], [334, 156],
];

export function Skyline({
  variant,
  height = 190,
  rounded = 0,
  style,
}: {
  variant: TimeOfDay;
  height?: number;
  rounded?: number;
  style?: ViewStyle;
}) {
  const p = sky[variant];
  const showWindows = variant === 'evening' || variant === 'night';
  const showStars = variant === 'night';
  const sunY = variant === 'evening' ? 132 : variant === 'night' ? 52 : 68;
  const sunX = variant === 'evening' ? 322 : 60;
  const B = p.building;

  return (
    <View
      // Purely decorative hero art — keep it out of the screen-reader order.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      {...(Platform.OS === 'web' ? { 'aria-hidden': true } : null)}
      style={[{ height, width: '100%', overflow: 'hidden', borderRadius: rounded }, style]}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMax slice">
        <Defs>
          <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={p.top} />
            <Stop offset="0.55" stopColor={p.mid} />
            <Stop offset="1" stopColor={p.horizon} />
          </LinearGradient>
          <LinearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={p.sun} stopOpacity="0" />
            <Stop offset="1" stopColor={p.sun} stopOpacity="0.45" />
          </LinearGradient>
        </Defs>

        <Rect x="0" y="0" width={VB_W} height={VB_H} fill="url(#sky)" />

        {showStars
          ? [[30, 30], [80, 46], [140, 24], [200, 40], [260, 22], [330, 38], [370, 26], [110, 60], [240, 58], [300, 48]].map(
              ([sx, sy], i) => (
                <Circle key={`st-${i}`} cx={sx} cy={sy} r={i % 3 === 0 ? 1.6 : 1} fill={p.ink} opacity={0.85} />
              ),
            )
          : null}

        <Circle cx={sunX} cy={sunY} r={variant === 'night' ? 16 : 26} fill={p.sun} opacity={variant === 'night' ? 0.9 : 0.95} />
        <Rect x="0" y={G0 - 120} width={VB_W} height="120" fill="url(#glow)" />

        {/* Far hazy skyline */}
        <G opacity={0.5}>
          {FAR.map(([x, w, h], i) => (
            <Rect key={`f-${i}`} x={x} y={G0 - h} width={w} height={h} fill={p.buildingFar} />
          ))}
        </G>

        {/* Generic near infill */}
        <G>
          {GENERIC.map(([x, w, h], i) => (
            <Rect key={`n-${i}`} x={x} y={G0 - h} width={w} height={h} fill={B} />
          ))}
        </G>

        {/* --- One World Trade Center: tapered tower + long spire (x~24-54) --- */}
        <G>
          <Polygon points={`24,${G0} 54,${G0} 46,${G0 - 158} 32,${G0 - 158}`} fill={B} />
          <Line x1="39" y1={G0 - 158} x2="39" y2={G0 - 192} stroke={B} strokeWidth="2.5" />
        </G>

        {/* --- Empire State Building: stepped setbacks + mast + antenna (x~140) --- */}
        <G>
          <Rect x="140" y={G0 - 120} width="34" height="120" fill={B} />
          <Rect x="148" y={G0 - 144} width="18" height="24" fill={B} />
          <Rect x="153" y={G0 - 160} width="8" height="16" fill={B} />
          <Line x1="157" y1={G0 - 160} x2="157" y2={G0 - 182} stroke={B} strokeWidth="2" />
        </G>

        {/* --- Chrysler-style crown: body + tiered triangular top + spire (x~200) --- */}
        <G>
          <Rect x="200" y={G0 - 112} width="24" height="112" fill={B} />
          <Polygon points={`200,${G0 - 112} 224,${G0 - 112} 217,${G0 - 132} 207,${G0 - 132}`} fill={B} />
          <Polygon points={`205,${G0 - 132} 219,${G0 - 132} 212,${G0 - 150}`} fill={B} />
          <Line x1="212" y1={G0 - 150} x2="212" y2={G0 - 166} stroke={B} strokeWidth="1.6" />
        </G>

        {/* Lit windows */}
        {showWindows
          ? WINDOWS.map(([wx, wy], i) => (
              <Rect key={`w-${i}`} x={wx} y={wy} width="2.4" height="3.4" fill={p.sun} opacity={0.9} />
            ))
          : null}
      </Svg>
    </View>
  );
}
