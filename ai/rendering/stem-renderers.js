function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderFunctionGraphSvg({
  fn,
  xMin = -10,
  xMax = 10,
  yMin = -10,
  yMax = 10,
  width = 640,
  height = 420,
  samples = 240,
} = {}) {
  if (typeof fn !== 'function') throw new Error('A deterministic numeric function is required.');
  const safeWidth = Math.max(320, Math.min(1600, Number(width) || 640));
  const safeHeight = Math.max(240, Math.min(1200, Number(height) || 420));
  const sx = (x) => ((x - xMin) / (xMax - xMin)) * safeWidth;
  const sy = (y) => safeHeight - ((y - yMin) / (yMax - yMin)) * safeHeight;
  const points = [];
  for (let index = 0; index <= samples; index += 1) {
    const x = xMin + ((xMax - xMin) * index) / samples;
    const y = Number(fn(x));
    if (Number.isFinite(y) && y >= yMin && y <= yMax) points.push(`${sx(x).toFixed(2)},${sy(y).toFixed(2)}`);
  }
  const xAxis = yMin <= 0 && yMax >= 0 ? `<line x1="0" y1="${sy(0)}" x2="${safeWidth}" y2="${sy(0)}"/>` : '';
  const yAxis = xMin <= 0 && xMax >= 0 ? `<line x1="${sx(0)}" y1="0" x2="${sx(0)}" y2="${safeHeight}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}" role="img" aria-label="Deterministically rendered function graph"><rect width="100%" height="100%" fill="white"/><g stroke="#64748b" stroke-width="1">${xAxis}${yAxis}</g><polyline fill="none" stroke="#4f46e5" stroke-width="3" points="${points.join(' ')}"/></svg>`;
}

export function renderLabelledDiagramSvg({ width = 640, height = 420, shapes = [], labels = [] } = {}) {
  const safeWidth = Math.max(320, Math.min(1600, Number(width) || 640));
  const safeHeight = Math.max(240, Math.min(1200, Number(height) || 420));
  const shapeSvg = shapes.map((shape) => {
    if (shape.type === 'line') return `<line x1="${Number(shape.x1)}" y1="${Number(shape.y1)}" x2="${Number(shape.x2)}" y2="${Number(shape.y2)}"/>`;
    if (shape.type === 'circle') return `<circle cx="${Number(shape.cx)}" cy="${Number(shape.cy)}" r="${Number(shape.r)}"/>`;
    if (shape.type === 'rect') return `<rect x="${Number(shape.x)}" y="${Number(shape.y)}" width="${Number(shape.width)}" height="${Number(shape.height)}"/>`;
    return '';
  }).join('');
  const labelSvg = labels.map((label) =>
    `<text x="${Number(label.x)}" y="${Number(label.y)}" font-family="Arial, sans-serif" font-size="16">${escapeXml(label.text)}</text>`,
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}" role="img"><rect width="100%" height="100%" fill="white"/><g fill="none" stroke="#111827" stroke-width="2">${shapeSvg}</g><g fill="#111827">${labelSvg}</g></svg>`;
}

export function renderEquationMarkup({ latex = '', chemistry = false } = {}) {
  const canonical = String(latex || '').trim();
  if (!canonical) throw new Error('Canonical equation is required.');
  return chemistry ? `\\ce{${canonical}}` : canonical;
}
