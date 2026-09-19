import type { SVGProps } from "react";

const paths = {
  check: "M4 10.5 8 14.5 16 5.5",
  close: "M5 5l10 10M15 5 5 15",
  arrowRight: "M4 10h12M11 5l5 5-5 5",
  external: "M11 4h5v5M16 4l-7 7M14 12v4H4V6h4",
  copy: "M7 7h9v9H7zM4 13V4h9",
  sun: "M10 3v1.5M10 15.5V17M3 10h1.5M15.5 10H17M5 5l1 1M14 14l1 1M5 15l1-1M14 6l1-1M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  moon: "M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8z",
  alert: "M10 3 2 17h16L10 3zM10 8v4M10 14.5v.5",
  search: "M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM13.5 13.5 17 17",
  download: "M10 3v10M5.5 8.5 10 13l4.5-4.5M4 16h12",
  printer: "M5 8V3h10v5M5 14H3V8h14v6h-2M6 11h8v6H6z",
  play: "M6 4.5v11l9-5.5-9-5.5z",
  shield: "M10 2.5 4 5v4.5c0 4 2.6 6.8 6 8 3.4-1.2 6-4 6-8V5l-6-2.5zM7.5 10l2 2 3.5-4",
  layers: "M10 3 3 7l7 4 7-4-7-4zM3 11l7 4 7-4",
  upload: "M10 14V4M5.5 8.5 10 4l4.5 4.5M4 16h12",
  info: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 9v4.5M10 6.5v.5",
} as const;

export type IconName = keyof typeof paths;

/** Stroke icons on a 20px grid. Decorative unless given an aria-label. */
export function Icon({
  name,
  size = 16,
  ...props
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props["aria-label"] ? undefined : true}
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
