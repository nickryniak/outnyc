// =============================================================================
// OutNYC — illustrated NYC skyline (components/Skyline.tsx)
// =============================================================================
// A vector "sunset over Manhattan" hero: a time-of-day gradient sky, a sun/moon,
// a hazy far skyline and a crisp near skyline with a spire and lit windows. Pure
// react-native-svg, so it's crisp at any size, themeable, and needs no assets.
// =============================================================================

import { View, ViewStyle } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Polygon,
  Rect,
  Stop,
} from 'react-native-svg';

import { sky, TimeOfDay } from '../lib/theme';

const VB_W = 400;
const VB_H = 220;
const GROUND = 220;

// Deterministic near-skyline: [x, width, height] (height from the ground up).
const NEAR: [number, number, number][] = [
  [-4, 34, 78],
  [30, 26, 116],
  [56, 30, 64],
  [86, 22, 150],
  [108, 34, 96],
  [150, 40, 132], // stepped tower
  [196, 20, 88],
  [214, 26, 168], // tall
  [246, 30, 104],
  [286, 24, 140],
  [312, 40, 74],
  [350, 30, 122],
  [382, 30, 92],
];

// Far, hazier skyline behind it.
const FAR: [number, number, number][] = [
  [-6, 40, 54],
  [40, 34, 82],
  [82, 46, 60],
  [130, 30, 96],
  [168, 52, 70],
  [224, 34, 100],
  [268, 44, 62],
  [318, 40, 88],
  [364, 44, 58],
];

// A few lit windows (x,y) in viewBox space, shown for evening/night.
const WINDOWS: [number, number][] = [
  [40, 130], [45, 145], [40, 160], [50, 130],
  [92, 100], [98, 118], [92, 136], [98, 154], [92, 172],
  [158, 110], [166, 128], [174, 110], [158, 146], [174, 146],
  [220, 80], [220, 100], [228, 90], [220, 120], [228, 130], [220, 150],
  [292, 110], [300, 128], [292, 146], [300, 164],
  [356, 120], [364, 138], [356, 156],
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
  const sunY = variant === 'evening' ? 128 : variant === 'night' ? 54 : 70;
  const sunX = variant === 'evening' ? 300 : 96;

  return (
    <View
      style={[
        { height, width: '100%', overflow: 'hidden', borderRadius: rounded },
        style,
      ]}
    >
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMax slice"
      >
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

        {/* Sky */}
        <Rect x="0" y="0" width={VB_W} height={VB_H} fill="url(#sky)" />

        {/* Stars (night) */}
        {showStars
          ? [
              [30, 30], [80, 46], [140, 24], [200, 40], [260, 22], [330, 38], [370, 26],
              [110, 60], [240, 58], [300, 48],
            ].map(([sx, sy], i) => (
              <Circle key={`st-${i}`} cx={sx} cy={sy} r={i % 3 === 0 ? 1.6 : 1} fill={p.ink} opacity={0.85} />
            ))
          : null}

        {/* Sun / moon */}
        <Circle cx={sunX} cy={sunY} r={variant === 'night' ? 16 : 26} fill={p.sun} opacity={variant === 'night' ? 0.9 : 0.95} />
        {/* Horizon glow */}
        <Rect x="0" y={GROUND - 120} width={VB_W} height="120" fill="url(#glow)" />

        {/* Far skyline */}
        <G opacity={0.55}>
          {FAR.map(([x, w, h], i) => (
            <Rect key={`f-${i}`} x={x} y={GROUND - h} width={w} height={h} fill={p.buildingFar} />
          ))}
        </G>

        {/* Near skyline */}
        <G>
          {NEAR.map(([x, w, h], i) => (
            <Rect key={`n-${i}`} x={x} y={GROUND - h} width={w} height={h} fill={p.building} />
          ))}
          {/* Spire on the tall tower at x=214,w=26,h=168 */}
          <Polygon
            points={`${214 + 13},${GROUND - 168 - 26} ${214 + 6},${GROUND - 168} ${214 + 20},${GROUND - 168}`}
            fill={p.building}
          />
          <Rect x={214 + 12} y={GROUND - 168 - 40} width="2" height="20" fill={p.building} />
          {/* Water-tower detail on the stepped tower */}
          <Rect x={150 + 14} y={GROUND - 132 - 12} width="12" height="12" fill={p.building} />
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
