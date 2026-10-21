// @ts-check
// Draws an overlay display list (overlays.mjs) on a Canvas2D context.
import { cssColour } from './geo.mjs';

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** @param {any} ctx CanvasRenderingContext2D @param {import('./overlays.mjs').Op[]} ops */
export function drawOps(ctx, ops) {
  let clipped = false;
  ctx.lineJoin = 'round'; ctx.lineCap = 'butt'; ctx.textBaseline = 'middle';
  const path = pts => { ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); };
  for (const o of ops) {
    if (o.op === 'fill') { path(o.pts); ctx.closePath(); ctx.fillStyle = cssColour(o.colour); ctx.fill(); }
    else if (o.op === 'line') { path(o.pts); if (o.closed) ctx.closePath(); ctx.strokeStyle = cssColour(o.colour); ctx.lineWidth = o.width; ctx.stroke(); }
    else if (o.op === 'text') {
      ctx.font = `${o.bold ? '600 ' : ''}${Math.round(o.size)}px ${FONT}`; ctx.textAlign = o.align === 0 ? 'left' : o.align === 1 ? 'right' : 'center';
      ctx.lineWidth = Math.max(2, o.size * 0.18); ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.strokeText(o.text, o.x, o.y);
      ctx.fillStyle = cssColour(o.colour); ctx.fillText(o.text, o.x, o.y);
    } else if (o.op === 'clip') { if (clipped) ctx.restore(); ctx.save(); ctx.beginPath(); ctx.rect(o.x, o.y, o.w, o.h); ctx.clip(); clipped = true; }
    else if (o.op === 'unclip' && clipped) { ctx.restore(); clipped = false; }
  }
  if (clipped) ctx.restore();
}
