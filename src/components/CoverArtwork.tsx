import React, { useEffect, useRef, useState } from 'react';
import { Download, Palette, RefreshCw } from 'lucide-react';
import type { CoverArtSpec, Episode } from '../types/podcast';

const PALETTES: Array<[string, string, string]> = [
  ['#6D28D9', '#EC4899', '#22D3EE'],
  ['#3B82F6', '#8B5CF6', '#FB7185'],
  ['#0F172A', '#8B5CF6', '#FB923C'],
  ['#4C1D95', '#EC4899', '#FB923C'],
  ['#1E1B4B', '#22D3EE', '#C4B5FD'],
];

const MOTIFS: CoverArtSpec['motif'][] = [
  'waves',
  'neural',
  'orbit',
  'prism',
  'bio',
  'network',
  'architecture',
  'pulse',
];

const STYLES: CoverArtSpec['visualStyle'][] = ['vibrant', 'editorial', 'neon', 'minimal'];

function drawMotif(
  ctx: CanvasRenderingContext2D,
  motif: CoverArtSpec['motif'],
  c1: string,
  c2: string,
  c3: string,
  size: number
) {
  ctx.save();
  const cx = size * 0.62;
  const cy = size * 0.36;

  if (motif === 'waves' || motif === 'pulse') {
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.strokeStyle = i % 2 === 0 ? c3 : '#FFFFFF';
      ctx.globalAlpha = 0.16 + i * 0.08;
      ctx.lineWidth = 3 + (i % 3);
      for (let x = 60; x <= size - 60; x += 12) {
        const y =
          cy +
          Math.sin(x * 0.015 + i * 0.65) * (42 + i * 10) +
          Math.cos(x * 0.008 - i) * 20;
        if (x === 60) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else if (motif === 'orbit') {
    for (let r = 70; r <= 230; r += 40) {
      ctx.beginPath();
      ctx.strokeStyle = r % 80 === 70 ? c3 : '#FFFFFF';
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 2.5;
      ctx.ellipse(cx, cy, r * 1.15, r * 0.55, -0.35, 0, Math.PI * 2);
      ctx.stroke();

      const angle = r * 0.05;
      const px = cx + Math.cos(angle) * r * 1.15;
      const py = cy + Math.sin(angle) * r * 0.55;
      ctx.beginPath();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = r === 150 ? c2 : c3;
      ctx.arc(px, py, 10, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = '#FFFFFF';
    ctx.arc(cx, cy, 30, 0, Math.PI * 2);
    ctx.fill();
  } else if (motif === 'neural' || motif === 'network') {
    const pts: Array<[number, number]> = [
      [cx - 170, cy - 90],
      [cx - 40, cy - 130],
      [cx + 120, cy - 80],
      [cx - 120, cy + 40],
      [cx + 10, cy + 10],
      [cx + 160, cy + 70],
      [cx - 20, cy + 130],
    ];
    ctx.lineWidth = 2.5;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        if ((i + j) % 2 === 0) {
          ctx.beginPath();
          ctx.strokeStyle = j % 2 === 0 ? c3 : '#FFFFFF';
          ctx.globalAlpha = 0.28;
          ctx.moveTo(pts[i][0], pts[i][1]);
          ctx.lineTo(pts[j][0], pts[j][1]);
          ctx.stroke();
        }
      }
    }
    pts.forEach(([x, y], idx) => {
      ctx.beginPath();
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = idx === 4 ? '#FFFFFF' : idx % 2 === 0 ? c3 : c2;
      ctx.arc(x, y, idx === 4 ? 22 : 13, 0, Math.PI * 2);
      ctx.fill();
    });
  } else {
    // prism / bio / architecture
    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((i * Math.PI) / 6);
      ctx.strokeStyle = i % 2 === 0 ? c3 : '#FFFFFF';
      ctx.globalAlpha = 0.32;
      ctx.lineWidth = 3;
      const side = 150 + i * 24;
      ctx.strokeRect(-side / 2, -side / 2, side, side);
      ctx.restore();
    }
    ctx.beginPath();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = c2;
    ctx.arc(cx, cy, 90, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function wrapTitleLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 4);
}

export function renderCoverCanvas(
  canvas: HTMLCanvasElement,
  episode: Episode,
  targetSize = 800
): string {
  const SIZE = 800;
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.save();
  if (targetSize !== SIZE) {
    ctx.scale(targetSize / SIZE, targetSize / SIZE);
  }

  const [c1, c2, c3] = episode.coverSpec.palette;
  const style = episode.coverSpec.visualStyle;

  // Base gradient
  const grad = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  if (style === 'minimal') {
    grad.addColorStop(0, '#141129');
    grad.addColorStop(1, c1);
  } else if (style === 'editorial') {
    grad.addColorStop(0, '#0F172A');
    grad.addColorStop(0.55, c1);
    grad.addColorStop(1, '#1E1B4B');
  } else {
    grad.addColorStop(0, c1);
    grad.addColorStop(0.55, c2);
    grad.addColorStop(1, '#120D2B');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Soft radial glow
  const glow = ctx.createRadialGradient(SIZE * 0.72, SIZE * 0.28, 20, SIZE * 0.72, SIZE * 0.28, 420);
  glow.addColorStop(0, `${c3}66`);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Subtle architectural grid
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let p = 80; p < SIZE; p += 80) {
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, SIZE);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(SIZE, p);
    ctx.stroke();
  }
  ctx.restore();

  drawMotif(ctx, episode.coverSpec.motif, c1, c2, c3, SIZE);

  // Bottom readability scrim
  const scrim = ctx.createLinearGradient(0, SIZE * 0.42, 0, SIZE);
  scrim.addColorStop(0, 'rgba(9,11,20,0)');
  scrim.addColorStop(0.55, 'rgba(9,11,20,0.68)');
  scrim.addColorStop(1, 'rgba(9,11,20,0.94)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Top Cozyland Wordmark & Language indicator
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '700 22px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText('COZYLAND STUDIO', 56, 68);

  ctx.fillStyle = c3;
  ctx.font = '600 18px "JetBrains Mono", monospace';
  ctx.fillText(`${episode.plan.language.toUpperCase()}  ·  ${episode.plan.style.toUpperCase()}`, 56, 98);

  // Episode Title
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 50px "Bricolage Grotesque", "Plus Jakarta Sans", system-ui, sans-serif';
  const titleLines = wrapTitleLines(ctx, episode.plan.title, SIZE - 112);
  let y = 515 - (titleLines.length - 1) * 54;
  for (const line of titleLines) {
    ctx.fillText(line, 56, y);
    y += 58;
  }

  // Subtitle
  ctx.fillStyle = 'rgba(226, 232, 240, 0.85)';
  ctx.font = '500 22px "Plus Jakarta Sans", system-ui, sans-serif';
  const sub = episode.coverSpec.subtitleLine || episode.plan.subtitle;
  ctx.fillText(sub.slice(0, 56), 56, 680);

  // Hosts footer line
  ctx.fillStyle = c3;
  ctx.fillRect(56, 712, 48, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.font = '600 20px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText('Hosted by Riya & Arjun', 120, 721);
  ctx.restore();

  return canvas.toDataURL('image/png');
}

interface CoverArtworkProps {
  episode: Episode;
  size?: 'sm' | 'md' | 'lg';
  editable?: boolean;
  onUpdateSpec?: (spec: CoverArtSpec, dataUrl: string) => void;
}

export const CoverArtwork: React.FC<CoverArtworkProps> = ({
  episode,
  size = 'md',
  editable = false,
  onUpdateSpec,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dataUrl, setDataUrl] = useState<string>(episode.coverImageDataUrl || '');
  const targetCanvasSize = editable || size === 'lg' ? 800 : 240;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = renderCoverCanvas(canvas, episode, targetCanvasSize);
    setDataUrl(url);
  }, [episode.id, episode.plan.title, episode.plan.language, episode.coverSpec, targetCanvasSize]);

  const handleRegenerate = () => {
    const nextPalette = PALETTES[Math.floor(Math.random() * PALETTES.length)];
    const nextMotif = MOTIFS[Math.floor(Math.random() * MOTIFS.length)];
    const nextStyle = STYLES[Math.floor(Math.random() * STYLES.length)];
    const nextSpec: CoverArtSpec = {
      ...episode.coverSpec,
      palette: nextPalette,
      motif: nextMotif,
      visualStyle: nextStyle,
    };
    if (canvasRef.current) {
      const updatedEp: Episode = { ...episode, coverSpec: nextSpec };
      const url = renderCoverCanvas(canvasRef.current, updatedEp);
      setDataUrl(url);
      onUpdateSpec?.(nextSpec, url);
    }
  };

  const handleStyleCycle = () => {
    const idx = STYLES.indexOf(episode.coverSpec.visualStyle);
    const nextStyle = STYLES[(idx + 1) % STYLES.length];
    const nextSpec: CoverArtSpec = { ...episode.coverSpec, visualStyle: nextStyle };
    if (canvasRef.current) {
      const updatedEp: Episode = { ...episode, coverSpec: nextSpec };
      const url = renderCoverCanvas(canvasRef.current, updatedEp);
      setDataUrl(url);
      onUpdateSpec?.(nextSpec, url);
    }
  };

  const handleDownload = () => {
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `cozyland-cover-${episode.id}.png`;
    link.click();
  };

  const dimClass =
    size === 'sm' ? 'w-14 h-14 rounded-lg' : size === 'lg' ? 'w-full max-w-[320px] aspect-square rounded-2xl' : 'w-28 h-28 rounded-xl';

  return (
    <div className="relative inline-flex flex-col gap-2">
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
      <div
        className={`${dimClass} overflow-hidden border border-[#E9E4F5] dark:border-white/10 bg-[#141129] shadow-sm shrink-0`}
      >
        {dataUrl ? (
          <img
            src={dataUrl}
            alt={`Cover artwork for ${episode.plan.title}`}
            width={targetCanvasSize}
            height={targetCanvasSize}
            loading={size === 'lg' ? 'eager' : 'lazy'}
            decoding="async"
            className="w-full h-full object-cover"
          />
        ) : (
          <div
            className="w-full h-full flex items-end p-3 text-white font-display font-semibold text-xs"
            style={{
              background: `linear-gradient(135deg, ${episode.coverSpec.palette[0]}, ${episode.coverSpec.palette[1]})`,
            }}
          >
            {episode.plan.title}
          </div>
        )}
      </div>

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleRegenerate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[#E2DAF5] dark:border-white/10 bg-white dark:bg-[#14182D] text-[#18122B] dark:text-slate-100 hover:border-[#8B5CF6] transition-colors whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5 text-[#6D28D9] dark:text-[#C4B5FD]" />
            Regenerate Art
          </button>
          <button
            type="button"
            onClick={handleStyleCycle}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[#E2DAF5] dark:border-white/10 bg-white dark:bg-[#14182D] text-[#18122B] dark:text-slate-100 hover:border-[#EC4899] transition-colors whitespace-nowrap"
          >
            <Palette className="w-3.5 h-3.5 text-[#BE185D] dark:text-[#F472B6]" />
            Style: {episode.coverSpec.visualStyle}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[#E2DAF5] dark:border-white/10 bg-white dark:bg-[#14182D] text-[#18122B] dark:text-slate-100 hover:border-[#22D3EE] transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-[#0E7490] dark:text-[#22D3EE]" />
            800×800 PNG
          </button>
        </div>
      )}
    </div>
  );
};
