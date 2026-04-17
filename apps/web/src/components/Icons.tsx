/** Biblioteca de ícones SVG minimalistas — sem emojis. */

interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

const defaults: Required<IconProps> = { size: 16, color: "currentColor", strokeWidth: 2 };

function Svg({
  size = 16,
  strokeWidth = 2,
  color = "currentColor",
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const IconArrowUp      = (p: IconProps) => <Svg {...{...defaults,...p}}><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></Svg>;
export const IconArrowDown    = (p: IconProps) => <Svg {...{...defaults,...p}}><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></Svg>;
export const IconArrowsUpDown = (p: IconProps) => <Svg {...{...defaults,...p}}><polyline points="7 16 12 21 17 16"/><polyline points="7 8 12 3 17 8"/><line x1="12" y1="21" x2="12" y2="3"/></Svg>;
export const IconUsers        = (p: IconProps) => <Svg {...{...defaults,...p}}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></Svg>;
export const IconActivity     = (p: IconProps) => <Svg {...{...defaults,...p}}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></Svg>;
export const IconPerson       = (p: IconProps) => <Svg {...{...defaults,...p}}><circle cx="12" cy="5" r="3"/><path d="M12 22V12m0 0l-4-4m4 4l4-4"/></Svg>;
export const IconPersonWalk   = (p: IconProps) => <Svg {...{...defaults,...p}}><circle cx="13" cy="4" r="2"/><path d="m9 20 1-7-2-3 4-3 2 4h4"/><path d="m6 13 2-2"/></Svg>;
export const IconPersonStand  = (p: IconProps) => <Svg {...{...defaults,...p}}><circle cx="12" cy="4" r="2"/><line x1="12" y1="7" x2="12" y2="17"/><path d="M9 17h6"/><path d="M9 11h6"/></Svg>;
export const IconClock        = (p: IconProps) => <Svg {...{...defaults,...p}}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></Svg>;
export const IconAlertTriangle= (p: IconProps) => <Svg {...{...defaults,...p}}><path d="m10.29 3.86-8.6 14.9A2 2 0 0 0 3.44 22h17.12a2 2 0 0 0 1.75-2.95L13.71 4.14a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></Svg>;
export const IconLock         = (p: IconProps) => <Svg {...{...defaults,...p}}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></Svg>;
export const IconBarChart     = (p: IconProps) => <Svg {...{...defaults,...p}}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></Svg>;
export const IconTarget       = (p: IconProps) => <Svg {...{...defaults,...p}}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></Svg>;
export const IconSliders      = (p: IconProps) => <Svg {...{...defaults,...p}}><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></Svg>;
export const IconMinus        = (p: IconProps) => <Svg {...{...defaults,...p}}><line x1="5" y1="12" x2="19" y2="12"/></Svg>;
export const IconPlus         = (p: IconProps) => <Svg {...{...defaults,...p}}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></Svg>;
export const IconRotateCcw    = (p: IconProps) => <Svg {...{...defaults,...p}}><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.79"/></Svg>;
export const IconTrash        = (p: IconProps) => <Svg {...{...defaults,...p}}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></Svg>;
export const IconCheck        = (p: IconProps) => <Svg {...{...defaults,...p}}><polyline points="20 6 9 17 4 12"/></Svg>;
export const IconX            = (p: IconProps) => <Svg {...{...defaults,...p}}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></Svg>;
export const IconLink         = (p: IconProps) => <Svg {...{...defaults,...p}}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></Svg>;
export const IconCamera       = (p: IconProps) => <Svg {...{...defaults,...p}}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></Svg>;
export const IconRefreshCw    = (p: IconProps) => <Svg {...{...defaults,...p}}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></Svg>;
export const IconMaximize     = (p: IconProps) => <Svg {...{...defaults,...p}}><path d="M3 7V3h4"/><path d="M21 7V3h-4"/><path d="M3 17v4h4"/><path d="M21 17v4h-4"/></Svg>;
export const IconMinimize     = (p: IconProps) => <Svg {...{...defaults,...p}}><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></Svg>;
export const IconRuler        = (p: IconProps) => <Svg {...{...defaults,...p}}><path d="M21.3 8.7 8.7 21.3c-1 1-2.5 1-3.4 0l-2.6-2.6c-1-1-1-2.5 0-3.4L15.3 2.7c1-1 2.5-1 3.4 0l2.6 2.6c1 1 1 2.5 0 3.4z"/><path d="m7.5 10.5 2 2"/><path d="m10.5 7.5 2 2"/><path d="m13.5 4.5 2 2"/><path d="m4.5 13.5 2 2"/></Svg>;
export const IconPolygon      = (p: IconProps) => <Svg {...{...defaults,...p}}><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"/></Svg>;
export const IconCar          = (p: IconProps) => <Svg {...{...defaults,...p}}><path d="M19 17H5a2 2 0 0 1-2-2V9l3-4h8l3 4h2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2z"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/></Svg>;
export const IconStar         = (p: IconProps) => <Svg {...{...defaults,...p}}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></Svg>;
export const IconVideo        = (p: IconProps) => <Svg {...{...defaults,...p}}><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></Svg>;
export const IconWifi         = (p: IconProps) => <Svg {...{...defaults,...p}}><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></Svg>;
export const IconBalance      = (p: IconProps) => <Svg {...{...defaults,...p}}><line x1="12" y1="3" x2="12" y2="21"/><path d="M3 9l4 3-4 3"/><path d="M21 9l-4 3 4 3"/><line x1="3" y1="12" x2="21" y2="12" strokeDasharray="2 2"/></Svg>;
export const IconZap          = (p: IconProps) => <Svg {...{...defaults,...p}}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></Svg>;
