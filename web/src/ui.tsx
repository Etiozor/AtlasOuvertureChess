import type { CSSProperties, ReactNode } from "react";

// Le prototype construit des styles sous forme de CHAÎNES CSS ("a:b;c:d").
// React veut un objet. On parse une fois — split sur ";" est sûr ici : aucune
// valeur du proto ne contient de ";" (gradients/filters n'ont que des virgules).
export function css(s: string): CSSProperties {
  const out: Record<string, string> = {};
  for (const decl of s.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    const val = decl.slice(i + 1).trim();
    if (!prop) continue;
    // -webkit-text-stroke -> WebkitTextStroke ; border-radius -> borderRadius
    const key = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[key] = val;
  }
  return out as CSSProperties;
}

// Remplace le composant du design system (GaleriePOFDesignSystem.Button).
type Variant = "primary" | "critical" | "ghost" | "quiet";
const VARIANTS: Record<Variant, CSSProperties> = {
  primary: { background: "var(--color-primary)", color: "var(--color-ink-inverse)", border: "1px solid transparent" },
  critical: { background: "var(--color-critical)", color: "var(--color-ink-inverse)", border: "1px solid transparent" },
  ghost: { background: "transparent", color: "var(--color-ink)", border: "var(--border-input)" },
  quiet: { background: "transparent", color: "var(--color-ink-muted)", border: "1px solid transparent" },
};

export function Button(props: {
  variant?: Variant; compact?: boolean; full?: boolean;
  onClick?: () => void; children: ReactNode;
}) {
  const { variant = "primary", compact, full, onClick, children } = props;
  return (
    <button
      onClick={onClick}
      style={{
        height: compact ? 32 : 44,
        width: full ? "100%" : "auto",
        padding: "0 16px",
        borderRadius: "var(--radius-sm)",
        cursor: "pointer",
        font: "600 12px/1 var(--font-interface)",
        letterSpacing: ".08em",
        textTransform: "uppercase",
        ...VARIANTS[variant],
      }}
    >
      {children}
    </button>
  );
}
