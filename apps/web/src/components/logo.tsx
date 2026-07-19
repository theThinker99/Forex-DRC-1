'use client';

import { useState } from 'react';

/**
 * Logo de l'application (Banque Centrale du Congo).
 *
 * Affiche `/logo-bcc.png` (a deposer dans apps/web/public/). Si le fichier est
 * absent, bascule automatiquement sur un logo de secours dessine en SVG :
 * l'interface reste presentable meme avant que l'image officielle soit fournie.
 */
export function Logo({ size = 44, rounded = true }: { size?: number; rounded?: boolean }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <FallbackLogo size={size} rounded={rounded} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo-bcc.png"
      alt="Logo BCC"
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        borderRadius: rounded ? Math.round(size * 0.22) : 0,
        background: '#ffffff',
        padding: Math.round(size * 0.1),
      }}
    />
  );
}

/** Losange stylise evoquant le sceau BCC, en attendant le logo officiel. */
function FallbackLogo({ size, rounded }: { size: number; rounded: boolean }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: rounded ? Math.round(size * 0.22) : 0,
        background: '#ffffff',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <svg width={size * 0.82} height={size * 0.82} viewBox="0 0 100 100" aria-label="BCC">
        <g fill="none" stroke="#0a8bd6" strokeWidth="3">
          <polygon points="50,6 94,50 50,94 6,50" />
          <polygon points="50,16 84,50 50,84 16,50" />
          <polygon points="50,26 74,50 50,74 26,50" />
        </g>
        <text
          x="50"
          y="58"
          textAnchor="middle"
          fontSize="26"
          fontWeight="800"
          fill="#0a8bd6"
          fontFamily="Georgia, serif"
        >
          BC
        </text>
      </svg>
    </div>
  );
}
