// Pure screen-space directional arrow geometry for projected GPS route segments.
(function (root) {
  const DEFAULT_ARROW_OPTIONS = Object.freeze({
    spacingPx: 80,
    minSegmentPx: 24,
    tangentWindowPx: 6,
    minSeparationPx: 14
  });

  /** Project segment coordinates into world-pixel space with cumulative arc length. */
  function projectSegmentPoints(segment, project) {
    let total = 0;
    let prevPixel = null;
    return segment.map((point, index) => {
      const pixel = project(point);
      if (index > 0) total += Math.hypot(pixel.x - prevPixel.x, pixel.y - prevPixel.y);
      prevPixel = pixel;
      return { ...point, pixel, distance: total };
    });
  }

  /** Interpolate the pixel position at cumulative arc length `target` along a projected segment. */
  function pointAtDistance(segment, target) {
    const last = segment.length - 1;
    if (target <= 0) return { x: segment[0].pixel.x, y: segment[0].pixel.y };
    if (target >= segment[last].distance) return { x: segment[last].pixel.x, y: segment[last].pixel.y };
    let low = 0;
    let high = last;
    while (low + 1 < high) {
      const mid = (low + high) >> 1;
      if (segment[mid].distance <= target) low = mid;
      else high = mid;
    }
    const a = segment[low];
    const b = segment[high];
    const span = b.distance - a.distance;
    if (span <= 0) return { x: a.pixel.x, y: a.pixel.y };
    const ratio = (target - a.distance) / span;
    return {
      x: a.pixel.x + (b.pixel.x - a.pixel.x) * ratio,
      y: a.pixel.y + (b.pixel.y - a.pixel.y) * ratio
    };
  }

  /** Compute evenly spaced direction arrowhead polygons for visible route segments. */
  function computeRouteArrows(projectedSegments, viewBounds = null, options = {}) {
    const { spacingPx, minSegmentPx, tangentWindowPx, minSeparationPx } = { ...DEFAULT_ARROW_OPTIONS, ...options };
    const minSepSq = minSeparationPx * minSeparationPx;
    const placed = [];
    const arrows = [];

    for (const segment of projectedSegments) {
      if (segment.length < 2) continue;
      const totalLength = segment[segment.length - 1].distance;
      if (totalLength < minSegmentPx) continue;

      const count = Math.max(1, Math.round(totalLength / spacingPx));
      const step = totalLength / count;

      for (let k = 0; k < count; k++) {
        const s = (k + 0.5) * step;
        const pos = pointAtDistance(segment, s);
        if (viewBounds && (pos.x < viewBounds.min.x || pos.x > viewBounds.max.x ||
            pos.y < viewBounds.min.y || pos.y > viewBounds.max.y)) {
          continue;
        }

        const back = pointAtDistance(segment, s - tangentWindowPx);
        const ahead = pointAtDistance(segment, s + tangentWindowPx);
        let dx = ahead.x - back.x;
        let dy = ahead.y - back.y;
        let len = Math.hypot(dx, dy);
        if (len < 1e-3) {
          const p0 = pointAtDistance(segment, Math.max(0, s - 0.5));
          const p1 = pointAtDistance(segment, Math.min(totalLength, s + 0.5));
          dx = p1.x - p0.x;
          dy = p1.y - p0.y;
          len = Math.hypot(dx, dy);
          if (len < 1e-3) continue;
        }

        const ux = dx / len;
        const uy = dy / len;
        const tooClose = placed.some(item => {
          const ox = pos.x - item.x;
          const oy = pos.y - item.y;
          return ox * ox + oy * oy < minSepSq && (ux * item.ux + uy * item.uy) > 0.85;
        });
        if (tooClose) continue;

        placed.push({ x: pos.x, y: pos.y, ux, uy });
        const nx = -uy;
        const ny = ux;
        const vertex = (forward, side) => ({
          x: pos.x + ux * forward + nx * side,
          y: pos.y + uy * forward + ny * side
        });
        arrows.push({
          x: pos.x,
          y: pos.y,
          ux,
          uy,
          vertices: [vertex(6.5, 0), vertex(-4.5, 4.75), vertex(-2, 0), vertex(-4.5, -4.75)]
        });
      }
    }

    return arrows;
  }

  const api = { DEFAULT_ARROW_OPTIONS, projectSegmentPoints, pointAtDistance, computeRouteArrows };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RouteArrows = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
