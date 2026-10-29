import { describe, expect, it } from 'vitest';
import type { PerforationAnnotation } from '@/types/api';
import { annotationAtPoint, canvasPointFromClient, splitStroke } from '../perforationGeometry';

const rect = { left: 30, top: 20, right: 230, bottom: 420, width: 200, height: 400 } as DOMRect;

describe('interactive perforation geometry', () => {
  it('preserves long handwriting with continuous bounded chunks', () => {
    const points = Array.from({ length: 6003 }, (_, index) => ({ x: index / 6003, y: 0.4 }));
    const chunks = splitStroke(points);
    expect(chunks.every((chunk) => chunk.length >= 2 && chunk.length <= 2000)).toBe(true);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i][0]).toEqual(chunks[i - 1][chunks[i - 1].length - 1]);
    expect(chunks.flatMap((chunk, index) => index ? chunk.slice(1) : chunk)).toEqual(points);
  });
  it('starts marks only inside the real rendered page, not in surrounding margins', () => {
    expect(canvasPointFromClient(rect, 20, 120)).toBeNull();
    expect(canvasPointFromClient(rect, 110, 430)).toBeNull();
    expect(canvasPointFromClient(rect, 130, 220)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('finds the latest saved stroke for the eraser', () => {
    const annotations = [
      { id: 'first', kind: 'line', points: [{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.2 }], stroke_width: 4 },
      { id: 'latest', kind: 'line', points: [{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.2 }], stroke_width: 4 },
    ] as PerforationAnnotation[];
    expect(annotationAtPoint({ x: 0.5, y: 0.21 }, annotations, 1000, 1000)?.id).toBe('latest');
    expect(annotationAtPoint({ x: 0.5, y: 0.5 }, annotations, 1000, 1000)).toBeNull();
  });

  it('can erase a persisted text label', () => {
    const note = { id: 'note', kind: 'note', points: [{ x: 0.2, y: 0.3 }] } as PerforationAnnotation;
    expect(annotationAtPoint({ x: 0.3, y: 0.32 }, [note], 1000, 1000)?.id).toBe('note');
  });
});
