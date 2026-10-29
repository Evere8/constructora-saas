import type { PerforationAnnotation } from '@/types/api';

export type CanvasPoint = { x: number; y: number };

// Preserve every sampled point. Adjacent chunks share their endpoint so long
// handwriting stays continuous without exceeding the API's per-mark bound.
export function splitStroke(points: CanvasPoint[], limit = 2000): CanvasPoint[][] {
  if (limit < 2) throw new Error('A stroke chunk needs two points');
  const chunks: CanvasPoint[][] = [];
  for (let index = 0; index < points.length - 1; index += limit - 1) {
    chunks.push(points.slice(index, index + limit));
  }
  return chunks;
}

export function canvasPointFromClient(rect: DOMRect, clientX: number, clientY: number): CanvasPoint | null {
  if (rect.width <= 0 || rect.height <= 0 || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
  return {
    x: Number(((clientX - rect.left) / rect.width).toFixed(6)),
    y: Number(((clientY - rect.top) / rect.height).toFixed(6)),
  };
}

function distanceToSegment(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const fraction = lengthSquared ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared)) : 0;
  return Math.hypot(x - (ax + fraction * dx), y - (ay + fraction * dy));
}

export function annotationAtPoint(point: CanvasPoint, annotations: PerforationAnnotation[], imageWidth: number, imageHeight: number): PerforationAnnotation | null {
  const x = point.x * imageWidth;
  const y = point.y * imageHeight;
  for (const annotation of [...annotations].reverse()) {
    const positions = annotation.points.map((position) => ({ x: Number(position.x) * imageWidth, y: Number(position.y) * imageHeight }));
    if (annotation.kind === 'note' && positions[0] && x >= positions[0].x - 12 && x <= positions[0].x + imageWidth * 0.22 && y >= positions[0].y - 12 && y <= positions[0].y + imageHeight * 0.042) return annotation;
    if (annotation.kind === 'line' && positions.some((position, index) => index > 0 && distanceToSegment(x, y, positions[index - 1].x, positions[index - 1].y, position.x, position.y) <= Math.max(15, annotation.stroke_width / 2 + 8))) return annotation;
  }
  return null;
}
