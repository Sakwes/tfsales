/** Storefront branding helpers: hex validation, HSL conversion and contrast. */

export const DEFAULT_BRANDING = {
  primary_color: "#C8940B",
  accent_color: "#C8940B",
  background_color: "#FBFBFD"
} as const;

export interface Branding {
  primary_color: string | null;
  accent_color: string | null;
  background_color: string | null;
  logo_path: string | null;
}

export const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export function isHex(value: string | null | undefined): boolean {
  return !!value && HEX_RE.test(value.trim());
}

function toRgb(hex: string): [number, number, number] {
  const v = hex.replace("#", "");
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16)
  ];
}

/** "43 90% 41%" — the format Tailwind CSS variables expect. */
export function hexToHslString(hex: string): string {
  const [r255, g255, b255] = toRgb(hex);
  const r = r255 / 255;
  const g = g255 / 255;
  const b = b255 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }

  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** Relative luminance, used to pick readable text over a colour. */
export function luminance(hex: string): number {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = toRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast-safe foreground (white or near-black) for a background colour. */
export function readableTextHsl(hex: string): string {
  return luminance(hex) > 0.45 ? "240 10% 10%" : "0 0% 100%";
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** CSS custom properties that re-theme a storefront subtree. */
export function brandingStyle(b: Partial<Branding> | null): React.CSSProperties {
  if (!b) return {};
  const style: Record<string, string> = {};

  if (isHex(b.primary_color)) {
    const hsl = hexToHslString(b.primary_color!);
    style["--primary"] = hsl;
    style["--primary-foreground"] = readableTextHsl(b.primary_color!);
    style["--ring"] = hsl;
    style["--gradient-primary"] = `linear-gradient(135deg, hsl(${hsl}), hsl(${hsl} / 0.85))`;
  }
  if (isHex(b.accent_color)) {
    const hsl = hexToHslString(b.accent_color!);
    style["--accent"] = hsl;
    style["--accent-foreground"] = readableTextHsl(b.accent_color!);
  }
  if (isHex(b.background_color)) {
    const hsl = hexToHslString(b.background_color!);
    style["--background"] = hsl;
    style["--foreground"] = readableTextHsl(b.background_color!);
  }

  return style as React.CSSProperties;
}
