type Point = readonly [x: number, y: number, z: number];
type Mark = { points: Point[]; color: string };
type Face = { points: Point[]; normal: Point; color: number; marks: Mark[] };

const body = 0xd8dfe3;
const trim = 0x555e66;
const glass = '#596a78';
const faces: Face[] = [];
const vertices = new Set<Point>();

function face(points: Point[], color: number, marks: Mark[] = []) {
  const [a, b, c] = points;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  if (!length) return;
  faces.push({ points, color, marks, normal: [nx / length, ny / length, nz / length] });
  points.forEach((point) => vertices.add(point));
  marks.forEach((mark) => mark.points.forEach((point) => vertices.add(point)));
}

function connect(rings: Point[][], colors: number[]) {
  for (let i = 1; i < rings.length; i++) {
    const previous = rings[i - 1], current = rings[i];
    for (let j = 0; j < previous.length; j++) {
      const next = (j + 1) % previous.length;
      face([previous[j], current[j], current[next], previous[next]], colors[j]);
    }
  }
}

const axles = [-1.52, 1.52];
const archRadius = 0.56;
function lowerEdge(x: number) {
  const distance = Math.min(...axles.map((axle) => Math.abs(x - axle)));
  const fraction = Math.min(1, distance / archRadius);
  return 0.34 + 0.61 * Math.sqrt(1 - fraction * fraction);
}

const archStations = axles.flatMap((axle) =>
  [-1, -0.88, -0.55, 0, 0.55, 0.88, 1].map((step) => axle + archRadius * step),
);
const stations = [-2.34, -2.22, ...archStations, 0, 2.23, 2.39].sort((a, b) => a - b);
const rings = stations.map((x): Point[] => {
  const end = Math.max(0, (Math.abs(x) - 2.09) / 0.3);
  const height = 1.17 - 0.15 * end;
  const width = 0.94 - 0.15 * end;
  const low = lowerEdge(x);
  return [[x, low, width - 0.06], [x, height - 0.09, width], [x, height, width - 0.11],
    [x, height, -width + 0.11], [x, height - 0.09, -width], [x, low, -width + 0.06]];
});
connect(rings, [body, body, body, body, body, trim]);

function bumper(x: number, front: boolean): Mark[] {
  const panel = (bottom: number, top: number, left: number, right: number, color: string): Mark =>
    ({ color, points: [[x, bottom, left], [x, top, left], [x, top, right], [x, bottom, right]] });
  return [
    panel(0.42, 0.51, -0.54, 0.54, '#545d64'),
    ...(front ? [panel(0.58, 0.78, -0.4, 0.4, '#69747c'), panel(0.61, 0.64, -0.36, 0.36, '#c3cbd1')] : []),
    panel(0.79, 0.88, -0.68, -0.43, front ? '#fcf6dc' : '#b45136'),
    panel(0.79, 0.88, 0.43, 0.68, front ? '#fcf6dc' : '#b45136'),
  ];
}
face(rings[0], body, bumper(stations[0], false));
face(rings[rings.length - 1].slice().reverse(), body, bumper(stations[stations.length - 1], true));

function cabin(along: number, up: number, side: number): Point {
  const rear = -2.02 + 0.32 * up, front = 1.06 - 0.57 * up;
  return [rear + (front - rear) * along, 1.16 + 0.73 * up, (0.83 - 0.17 * up) * side];
}

for (const side of [-1, 1]) {
  const panel = (left: number, right: number, bottom: number, top: number): Point[] =>
    [cabin(left, bottom, side), cabin(right, bottom, side), cabin(right, top, side), cabin(left, top, side)];
  const windows = [[0.075, 0.28], [0.31, 0.60], [0.63, 0.91]];
  const points = panel(0, 1, 0, 1);
  face(side === 1 ? points : points.reverse(), body,
    windows.map(([left, right]) => ({ points: panel(left, right, 0.24, 0.88), color: glass })));
}
for (const end of [0, 1]) {
  const panel = (left: number, right: number, bottom: number, top: number): Point[] =>
    [cabin(end, bottom, left), cabin(end, top, left), cabin(end, top, right), cabin(end, bottom, right)];
  const points = panel(-1, 1, 0, 1);
  face(end === 1 ? points : points.reverse(), body,
    [{ points: panel(-0.83, 0.83, 0.17, 0.88), color: glass }]);
}
face([cabin(0, 1, -1), cabin(0, 1, 1), cabin(1, 1, 1), cabin(1, 1, -1)], body);

const wheelSegments = 16;
for (const axle of axles) {
  for (const side of [-1, 1]) {
    const circle = (radius: number, width: number): Point[] => Array.from({ length: wheelSegments }, (_, i) => {
      const angle = i * 2 * Math.PI / wheelSegments;
      return [axle + radius * Math.cos(angle), 0.43 + radius * Math.sin(angle), width * side];
    });
    const inner = circle(0.43, 0.71), outer = circle(0.43, 1.035);
    for (let i = 0; i < wheelSegments; i++) {
      const next = (i + 1) % wheelSegments;
      const points = [inner[i], inner[next], outer[next], outer[i]];
      face(side === 1 ? points : points.reverse(), 0x30383f);
    }
    face(side === 1 ? inner.slice().reverse() : inner, 0x252b30);
    face(side === 1 ? outer : outer.slice().reverse(), 0x252b30, [
      { points: circle(0.29, 1.035), color: '#9da8b1' },
      { points: circle(0.20, 1.035), color: '#68757f' },
      { points: circle(0.088, 1.035), color: '#bfc8cf' },
    ]);
  }
}

const pitch = Math.PI / 8;

export function drawCar(context: CanvasRenderingContext2D, width: number, height: number, yaw: number) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const zoom = Math.min(width / 5.65, height / 3.4);
  const centerX = width / 2, centerY = height / 2 + 0.82 * zoom;
  const projected = new Map<Point, Point>();
  const visible: { face: Face; depth: number }[] = [];
  for (const point of vertices) {
    const [x, y, z] = point;
    const depth = sy * x + cy * z;
    projected.set(point, [centerX + zoom * (cy * x - sy * z),
      centerY - zoom * (cp * y - sp * depth), sp * y + cp * depth]);
  }
  for (const surface of faces) {
    const [x, y, z] = surface.normal;
    if (sp * y + cp * (sy * x + cy * z) <= 0.0001) continue;
    const depth = surface.points.reduce((sum, point) => sum + projected.get(point)![2], 0) / surface.points.length;
    visible.push({ face: surface, depth });
  }
  visible.sort((a, b) => a.depth - b.depth);

  function trace(points: Point[]) {
    context.beginPath();
    points.forEach((point, index) => {
      const [x, y] = projected.get(point)!;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
  }

  context.clearRect(0, 0, width, height);
  context.fillStyle = '#e8ecef';
  context.beginPath();
  context.ellipse(centerX, centerY, zoom * (2.25 * Math.abs(cy) + 0.84 * Math.abs(sy)),
    zoom * (0.28 + 0.59 * Math.abs(sy)), 0, 0, Math.PI * 2);
  context.fill();
  context.lineJoin = 'round';
  for (const { face: surface } of visible) {
    const light = 0.85 + 0.15 * Math.max(0, surface.normal[1] * 0.85 + surface.normal[2] * 0.34 + surface.normal[0] * 0.39);
    const channel = (shift: number) => Math.round((surface.color >> shift & 255) * light);
    trace(surface.points);
    context.fillStyle = 'rgb(' + channel(16) + ',' + channel(8) + ',' + channel(0) + ')';
    context.fill();
    context.lineWidth = 0.45;
    context.strokeStyle = '#68757f32';
    context.stroke();
    for (const mark of surface.marks) {
      trace(mark.points);
      context.fillStyle = mark.color;
      context.fill();
    }
  }
}
