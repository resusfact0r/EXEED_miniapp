import { partColors } from './partColors';

type Point = [number, number, number]; // longitudinal, vertical, transverse (cm)
type Pixel = [number, number];
type Plane = (u: number, v: number) => Point;
type Context = CanvasRenderingContext2D;

// The broad panels carry vector coachwork. The end caps, roof and wheel barrels
// join them in 3D, so detail stays sharp at any pixel ratio or heading.
const paths = new Map<string, Path2D>();
function path(data: string) {
  let cached = paths.get(data);
  if (!cached) {
    cached = new Path2D(data);
    paths.set(data, cached);
  }
  return cached;
}

function panel(c: Context, d: string, fill: string | CanvasGradient, edge?: string, width = 1) {
  c.fillStyle = fill;
  c.fill(path(d));
  if (edge) {
    c.strokeStyle = edge;
    c.lineWidth = width;
    c.stroke(path(d));
  }
}

function seam(c: Context, d: string, color: string, width: number) {
  c.lineWidth = width;
  c.strokeStyle = color;
  c.stroke(path(d));
}

function finish(c: Context, bottom: number, top: number, stops: [number, string][]) {
  const g = c.createLinearGradient(0, bottom, 0, top);
  for (const [t, color] of stops) g.addColorStop(t, color);
  return g;
}

function disc(c: Context, x: number, y: number, radius: number, color: string | CanvasGradient) {
  c.beginPath();
  c.arc(x, y, radius, 0, 2 * Math.PI);
  c.fillStyle = color;
  c.fill();
}

const axles = [-145, 143];
const cabinBase = 111;
const cabinSide =
  (side: number): Plane =>
  (x, y) => [x, y, side * (88 - 0.29 * (y - cabinBase))];
const wheelFace =
  (axle: number, side: number, z = 96): Plane =>
  (x, y) => [axle + x, 43 + y, z * side];

function coachwork(c: Context, blue: boolean) {
  const coat = finish(c, 29, 121, [
    [0, '#253b46'],
    [0.15, '#475e6b'],
    [0.38, blue ? '#4796d4' : '#708b98'],
    [0.68, blue ? '#64b5f2' : '#a6bac2'],
    [0.78, blue ? '#327dbb' : '#647e8b'],
    [1, blue ? '#83c6ff' : '#c6d6d9'],
  ]);
  const skin =
    'M-212 104 Q-213 114 -201 118 Q-147 120 -96 117 Q39 109 94 114 Q162 117 206 108 Q215 105 215 96 L215 48 Q214 36 199 33 L193 33 C192 66 175 94 144 94 C113 94 94 69 94 35 L-96 35 C-97 69 -117 94 -145 94 C-176 94 -194 66 -195 34 L-204 36 Q-215 39 -215 55 Z';
  panel(c, skin, coat, '#536974', 0.85);
  c.save();
  c.clip(path(skin));
  panel(c, 'M-218 98 Q-136 110 -42 102 T217 103 L216 99 Q113 102 15 99 T-218 94Z', '#c2d1d5');
  panel(c, 'M-93 50 Q-11 44 100 64 Q48 49 -92 42Z', '#425e6b');
  seam(
    c,
    'M-114 116 Q-126 102 -115 85 L-93 45 Q-91 40 -82 40 L-29 40 M-25 114 Q-33 86 -29 43 Q-29 40 -24 40 H75 Q81 40 85 53 L93 90 Q96 107 91 114',
    '#354e5b',
    1.15,
  );
  seam(c, 'M-24 109 Q-30 83 -27 49 M90 103 L84 67', '#c6d6da', 0.62);
  for (const x of [-99, -14]) {
    panel(c, 'M' + x + ' 99h13l-2 -2h-11z', '#2c424f');
    c.fillStyle = '#c7d7d9';
    c.fillRect(x, 99, 12, 0.8);
  }
  panel(c, 'M-216 39 Q0 29 216 41 L216 31 L-216 26Z', '#283b43');
  c.restore();
  panel(c, 'M-96 36 L94 36 L91 29 L-92 29Z', '#273943');
  seam(c, 'M-89 35 Q-12 32 90 36', '#b4c5ca', 1.7);
  for (const x of axles) {
    c.save();
    c.translate(x, 43);
    panel(c, 'M-50 -8 C-50 24 -33 51 0 52 C32 52 50 29 50 -8 L45 -8 C45 23 29 45 0 46 C-29 45 -45 23 -45 -8Z', '#364b56');
    seam(c, 'M-48 1 C-46 31 -25 50 0 50 C23 50 43 34 48 9', '#9daeb4', 1);
    c.restore();
  }
  panel(c, 'M-211 108 L-179 110 L-183 106 L-211 103Z', '#ab3a44');
  panel(c, 'M184 109 L209 106 L214 103 L202 104Z', '#e9ffff');
}

function glazing(c: Context) {
  const frame =
    'M-203 116 Q-191 121 -181 135 L-162 155 Q-155 165 -138 168 Q-67 176 1 168 Q19 166 39 152 L95 115 Q98 112 90 111 Q-48 110 -203 116Z';
  panel(c, frame, '#738c99', '#54717e', 1.4);
  const window = 'M-186 120 L-158 154 Q-150 162 -136 164 Q-67 171 0 164 Q15 162 34 150 L82 117 Q-30 115 -186 120Z';
  panel(
    c,
    window,
    finish(c, 115, 169, [
      [0, '#243b49'],
      [0.43, '#365566'],
      [0.75, '#536e7d'],
      [1, '#a1bac3'],
    ]),
    '#1c323f',
    2.7,
  );
  c.save();
  c.clip(path(window));
  panel(c, 'M-177 121 Q-76 151 39 147 L51 154 Q-75 160 -177 123Z', '#77929d');
  panel(c, 'M-138 115L-116 170H-110L-129 114Z', '#243744');
  panel(c, 'M-36 114L-39 170L-30 169L-28 114Z', '#223642');
  seam(c, 'M-134 119 L-115 164 M-33 118 L-35 166', '#8aa0a9', 1);
  c.restore();
  seam(c, 'M-190 119 Q-52 112 88 115 M-171 149 Q-155 169 -135 168 Q-56 175 4 167', '#dae3e4', 1.8);
}

function alloy(c: Context) {
  const tire = c.createRadialGradient(-8, 11, 16, 0, 0, 43);
  for (const [p, color] of [
    [0, '#192228'],
    [0.74, '#283238'],
    [0.85, '#3b4348'],
    [0.94, '#20272a'],
    [1, '#111c21'],
  ] as const)
    tire.addColorStop(p, color);
  disc(c, 0, 0, 43, tire);
  disc(c, 0, 0, 32.5, '#bdc9ce');
  disc(c, 0, 0, 30.5, '#26343d');
  disc(c, 0, 0, 23, '#697983');
  disc(c, 0, 0, 16, '#3a4a54');
  for (let i = 0; i < 10; i++) {
    c.save();
    c.rotate((i * Math.PI) / 5);
    panel(c, 'M-3 5 L-6 20 L-4 30 L0 30 L-1 21 L4 7Z', '#becbd0');
    panel(c, 'M-3 7 L-5 21 L-4 29 L-2 29 L-3 21 L1 7Z', '#80929c');
    c.restore();
  }
  disc(c, 0, 0, 8.5, '#d9e2e4');
  disc(c, 0, 0, 5.8, '#546873');
}

function fascia(c: Context, front: boolean, blue: boolean) {
  panel(
    c,
    'M-79 99 Q-77 108 -62 108 H62 Q77 108 79 99 L80 48 Q78 35 67 34 Q0 30 -67 34 Q-78 35 -80 48Z',
    finish(c, 32, 111, [
      [0, '#344953'],
      [0.32, blue ? '#4489c1' : '#718996'],
      [0.78, blue ? '#74b7ea' : '#a0b5be'],
      [1, '#c3d3d8'],
    ]),
  );
  if (front) {
    panel(c, 'M-68 91 Q0 96 68 91 L59 53 Q55 47 44 46 Q0 41 -44 46 Q-55 47 -59 53Z', '#263942', '#b9cbd1', 1.8);
    c.save();
    c.clip(path('M-65 89 Q0 93 65 89 L55 51 Q0 39 -55 51Z'));
    for (let i = -10; i <= 10; i++) {
      c.beginPath();
      c.moveTo(i * 7.3, 94);
      c.lineTo(i * 6.4, 42);
      c.strokeStyle = '#7b929d';
      c.lineWidth = 2.3;
      c.stroke();
    }
    for (let y = 52; y < 93; y += 7) {
      c.fillStyle = '#33464f';
      c.fillRect(-72, y, 144, 1);
    }
    c.restore();
    panel(c, 'M-78 99 Q0 103 78 99 L75 94 Q0 99 -75 94Z', '#273d47');
    seam(c, 'M-73 98 L-47 99 M47 99 L73 98', '#e8ffff', 2.9);
    for (const s of [-1, 1]) {
      c.save();
      c.scale(s, 1);
      panel(c, 'M67 80 L74 77 L72 55 L63 51Z', '#273d48');
      seam(c, 'M70 76 L69 60', '#d7eff4', 1.7);
      c.restore();
    }
    panel(c, 'M-17 72 H17 V64 H-17Z', '#23333a', '#94a7ae', 0.7);
  } else {
    panel(c, 'M-77 102 Q0 106 77 102 L73 95 Q0 101 -73 95Z', '#612f3b');
    seam(c, 'M-74 101 Q0 105 74 101', '#ff8d8d', 1.9);
    panel(c, 'M-30 83 Q0 85 30 83 L23 68 H-23Z', '#657e89');
    panel(c, 'M-17 80 H17 V72 H-17Z', '#c6d3d6');
  }
  panel(c, 'M-76 46 Q0 37 76 46 L73 36 Q0 26 -73 36Z', '#33444d');
  seam(c, 'M-57 40 Q0 33 57 40', '#b6c6cd', 2.2);
}

function mirror(c: Context, active: boolean) {
  panel(c, 'M-14 -9 L-5 -7 L-1 -1 L-7 2Z', active ? '#08645f' : '#344954');
  panel(
    c,
    'M-10 1 Q-7 9 8 9 Q16 8 15 2 L12 -3 Q4 -6 -6 -3Z',
    finish(c, -5, 10, [
      [0, active ? '#086964' : '#344b57'],
      [0.45, active ? '#0cb8a8' : '#7a929e'],
      [1, active ? '#64efda' : '#c2d3d8'],
    ]),
    active ? '#005c58' : '#425a67',
    1.3,
  );
  seam(c, 'M-6 -1 Q4 -3 12 0', active ? '#baffef' : '#d7e5e9', 1);
}

export function drawCar(c: Context, width: number, height: number, yaw: number, selected: string[], profile = false) {
  const angle = Math.round(yaw * 1e8) / 1e8;
  const dx = Math.sin(angle),
    dz = Math.cos(angle);
  const pitch = profile ? 0 : 0.255;
  const cp = Math.cos(pitch),
    sp = Math.sin(pitch);
  const scale = profile ? Math.min(width / 660, height / 264) : Math.min(width / 539, height / 265);
  const cx = width / 2,
    cy = height / 2 + scale * (profile ? 82 : 81);
  const side = dz >= 0 ? 1 : -1,
    end = dx >= 0 ? 1 : -1;
  const active = new Set(selected);
  const project = ([x, y, z]: Point): Pixel => [cx + scale * (dz * x - dx * z), cy - scale * (cp * y - sp * (dx * x + dz * z))];
  const depth = ([x, y, z]: Point) => cp * (dx * x + dz * z) + sp * y;
  function plane(map: Plane, paint: () => void) {
    const [x, y] = project(map(0, 0)),
      u = project(map(1, 0)),
      v = project(map(0, 1));
    c.save();
    c.transform(u[0] - x, u[1] - y, v[0] - x, v[1] - y, x, y);
    paint();
    c.restore();
  }
  function poly(points: Point[], fill: string, stroke = fill) {
    c.beginPath();
    points.forEach((p, i) => {
      const [x, y] = project(p);
      if (i) c.lineTo(x, y);
      else c.moveTo(x, y);
    });
    c.closePath();
    c.fillStyle = fill;
    c.fill();
    c.strokeStyle = stroke;
    c.lineWidth = 0.6;
    c.stroke();
  }
  function line(points: Point[], color: string, weight: number) {
    c.beginPath();
    points.forEach((p, i) => {
      const [x, y] = project(p);
      if (i) c.lineTo(x, y);
      else c.moveTo(x, y);
    });
    c.strokeStyle = color;
    c.lineWidth = weight * scale;
    c.stroke();
  }
  const blue = active.has('body');
  function drawMirror(sign: number, highlighted: boolean) {
    const root: Point = [70, 123, 87 * sign],
      tip: Point = [72, 129, 106 * sign];
    line([root, tip], highlighted ? '#066b68' : '#314954', 5);
    // A rounded housing with width in both axes remains visible head-on.
    const outline = [
      [-12, -5],
      [-7, -9],
      [6, -9],
      [12, -4],
      [11, 4],
      [5, 8],
      [-8, 7],
      [-13, 3],
    ];
    const shell = (y: number, k: number): Point[] => outline.map(([x, z]) => [72 + x * k, y, (107 + z * k) * sign]);
    const low = shell(126, 0.85),
      high = shell(134, 1);
    for (let i = 0; i < low.length; i++) {
      const j = (i + 1) % low.length;
      if (depth(low[i]) + depth(low[j]) > 2 * depth([72, 126, 107 * sign]))
        poly([low[i], low[j], high[j], high[i]], highlighted ? '#008e86' : '#647e8a');
    }
    poly(high, highlighted ? '#4cdbc6' : '#c4d3d8');
    if (Math.abs(dz) > 0.15)
      plane(
        (x, y) => [72 + x, 128 + y, 115 * sign],
        () => mirror(c, highlighted),
      );
  }

  c.clearRect(0, 0, width, height);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  // Ellipse on the ground plane, aligned with the car even at an oblique heading.
  plane(
    (x, z) => [x, 0, z],
    () => {
      c.save();
      c.scale(256, 123);
      const g = c.createRadialGradient(0, 0, 0.1, 0, 0, 1);
      g.addColorStop(0, '#28415355');
      g.addColorStop(0.7, '#28415324');
      g.addColorStop(1, '#28415300');
      disc(c, 0, 0, 1, g);
      c.restore();
    },
  );
  if (profile) {
    const [x, y] = project([0, 0, 0]);
    c.save();
    c.translate(x, y);
    c.scale(scale * 226, scale * 5);
    const g = c.createRadialGradient(0, 0, 0.05, 0, 0, 1);
    g.addColorStop(0, '#455b695a');
    g.addColorStop(1, '#455b6900');
    disc(c, 0, 0, 1, g);
    c.restore();
  }
  drawMirror(-side, false);
  // Wheels are painted before the cut-out wings and wrap-around bumpers.
  for (const sign of [-side, side])
    for (const axle of axles) {
      const inner = wheelFace(axle, sign, 67),
        outer = wheelFace(axle, sign);
      plane(inner, () => disc(c, 0, 0, 43, '#17242b'));
      for (let i = 0; i < 36; i++) {
        const a = (i * Math.PI) / 18,
          b = ((i + 1) * Math.PI) / 18;
        const ca = 43 * Math.cos(a),
          sa = 43 * Math.sin(a),
          cb = 43 * Math.cos(b),
          sb = 43 * Math.sin(b);
        if (dx * (ca + cb) * cp + (sa + sb) * sp > 0)
          poly([inner(ca, sa), inner(cb, sb), outer(cb, sb), outer(ca, sa)], sa > 15 ? '#303c43' : '#202b32');
      }
      if (sign === side) plane(outer, () => alloy(c));
    }
  // Corner returns bridge the narrower fascias to the shoulder and hood.
  for (const e of [-1, 1])
    for (const s of [-1, 1]) {
      if (e * dx * 0.65 + s * dz * 0.75 < 0) continue;
      const p = (x: number, y: number, z: number): Point => [e * x, y, s * z];
      const corner: Plane = (t, y) => [e * (212 + (20 * t) / 100), y, s * (91 - (13 * t) / 100)];
      plane(corner, () =>
        panel(
          c,
          'M0 106 L100 101 V35 L0 33Z',
          finish(c, 33, 108, [
            [0, '#394e58'],
            [0.22, '#657c89'],
            [0.58, blue ? '#529ad3' : '#839aa4'],
            [0.76, blue ? '#73baf0' : '#a6bac3'],
            [1, '#b4c9d0'],
          ]),
        ),
      );
      if (e === 1)
        plane(corner, () => {
          panel(c, 'M16 83 L84 80 L74 57 L26 53Z', '#354b57');
          seam(c, 'M45 77 L43 60', '#b3c9d0', 2.6);
        });
      poly([p(213, 34, 91), p(232, 35, 76), p(232, 45, 79), p(213, 47, 91)], '#364b56');
      poly([p(211, 98, 91), p(232, 94, 77), p(232, 100, 78), p(211, 106, 91)], e === 1 ? '#4b6875' : '#a03e4d');
      line([p(210, 105, 91), p(232, 99, 77)], e === 1 ? '#eaffff' : '#ff9395', 2.1);
    }
  if (Math.abs(dz) > 0.0001)
    plane(
      (x, y) => [x, y, 91 * side],
      () => coachwork(c, blue),
    );
  if (Math.abs(dx) > 0.0001)
    plane(
      (z, y) => [end * 232, y, z],
      () => fascia(c, end === 1, blue),
    );
  const hoodColor = blue ? '#8ac9f4' : '#b4c7ce';
  const hood: Point[] = [
    [89, 114, -88],
    [165, 115, -90],
    [212, 108, -91],
    [232, 101, -78],
    [234, 104, 0],
    [232, 101, 78],
    [212, 108, 91],
    [165, 115, 90],
    [89, 114, 88],
  ];
  poly(hood, hoodColor);
  for (const s of [-1, 1]) {
    poly(
      [
        [93, 115, 83 * s],
        [179, 112, 69 * s],
        [227, 104, 67 * s],
        [207, 109, 84 * s],
      ],
      blue ? '#77b8e6' : '#9fb5bf',
    );
    line(
      [
        [99, 116, 78 * s],
        [173, 114, 71 * s],
        [222, 106, 65 * s],
      ],
      '#d5e1e4',
      1.1,
    );
  }
  poly(
    [
      [-202, 117, -89],
      [-212, 115, -89],
      [-232, 103, -77],
      [-232, 103, 77],
      [-212, 115, 89],
      [-202, 117, 89],
    ],
    hoodColor,
  );
  // Front and rear glass span the cabin. Each roof edge meets the side glass.
  const pane = (front: boolean) => {
    const lower = front ? 92 : -201,
      upper = front ? 4 : -153,
      top = front ? 167 : 165;
    const map: Plane = (z, t) => [lower + ((upper - lower) * t) / 100, 114 + ((top - 114) * t) / 100, z];
    plane(map, () => {
      panel(c, 'M-88 0 H88 L72 100 H-72Z', blue ? '#65aada' : '#91a8b3');
      const glass = 'M-82 6 Q0 1 82 6 L68 94 Q0 99 -68 94Z';
      panel(
        c,
        glass,
        finish(c, 0, 100, [
          [0, '#294552'],
          [0.5, '#587686'],
          [1, '#9eb6c1'],
        ]),
        '#263d49',
        1.8,
      );
      c.save();
      c.clip(path(glass));
      panel(c, 'M-93 19 Q-14 72 86 70 L85 85 Q-12 93 -93 32Z', '#879fa9');
      c.restore();
      if (front) {
        seam(c, 'M-70 9 L-5 11 M-4 9 L60 12', '#213640', 1.8);
      } else {
        for (let y = 24; y < 85; y += 13) {
          c.fillStyle = '#8298a0';
          c.fillRect(-60, y, 120, 1);
        }
      }
    });
  };
  if (end === 1 || sp > 0.87 * Math.abs(dx)) pane(true);
  if (end === -1 || sp > 1.12 * Math.abs(dx)) pane(false);
  if (Math.abs(dz) > 0.0001) {
    const sill = cabinSide(side);
    poly(
      [sill(-203, 116), sill(-154, 166), [-156, 168, 71 * side], [-128, 168, 72 * side], sill(-125, 161)],
      blue ? '#84bfeb' : '#a7bac2',
    );
    plane(sill, () => glazing(c));
  }
  const roof: Plane = (x, z) => [x, 168, z];
  plane(roof, () => {
    panel(
      c,
      'M-157 -71 Q-97 -75 -10 -73 L6 -70 Q13 -49 12 0 Q13 49 6 70 L-10 73 Q-97 75 -157 71 Q-166 0 -157 -71Z',
      blue ? '#77b3dd' : '#90a8b2',
      '#718995',
      0.9,
    );
    panel(c, 'M-137 -58 Q-74 -62 -12 -58 Q-5 0 -12 58 Q-76 62 -137 58 Q-144 0 -137 -58Z', '#354e5c', '#b3c6cd', 1.4);
    panel(c, 'M-137 -55 Q-78 -60 -16 -55 L-15 -42 Q-77 -51 -139 -40Z', '#68818c');
    seam(c, 'M-82 -59 L-82 59', '#829ba5', 1.6);
  });
  for (const s of [-1, 1])
    line(
      [
        [-145, 168, 68 * s],
        [-136, 172, 68 * s],
        [-20, 172, 68 * s],
        [-9, 168, 68 * s],
      ],
      '#bfccd0',
      2.8,
    );
  drawMirror(side, false);

  if (!selected.some((id) => id !== 'body')) return;
  {
    // Wash the existing silhouette once. Internal components are then drawn
    // in their real positions as a cutaway, including normally occluded parts.
    c.save();
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = blue ? '#edf4f655' : '#edf4f6a6';
    c.fillRect(0, 0, width, height);
    c.restore();
  }
  type Part = { center: Point; paint: () => void };
  const details: Part[] = [];
  function box(id: string, x: number, y: number, z: number, l: number, h: number, w: number) {
    if (!active.has(id)) return;
    const color = partColors[id];
    const p = (a: number, b: number, d: number): Point => [x + (a * l) / 2, y + (b * h) / 2, z + (d * w) / 2];
    const center = p(0, 0, 0);
    details.push({
      center,
      paint: () => {
        const face = (points: Point[], shade: string) => {
          poly(points, color);
          poly(points, shade, '#253c4866');
        };
        face([p(-1, -1, side), p(1, -1, side), p(1, 1, side), p(-1, 1, side)], '#0c23311e');
        face([p(end, -1, -1), p(end, -1, 1), p(end, 1, 1), p(end, 1, -1)], '#172c3645');
        face([p(-1, 1, -1), p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1)], '#ffffff27');
      },
    });
  }
  function rod(id: string, points: Point[], weight: number) {
    if (!active.has(id)) return;
    details.push({
      center: points[Math.floor(points.length / 2)],
      paint: () => {
        line(points, '#344c57', weight + 1.6);
        line(points, partColors[id], weight);
      },
    });
  }
  if (active.has('engine')) {
    const engine: Point = [146, 81, 0];
    details.push({
      center: engine,
      paint: () => {
        // Chamfered cylinder head, cast cover, oil cap and individual inlet runners.
        const outline = [
          [-27, -34],
          [-18, -43],
          [19, -43],
          [29, -32],
          [29, 26],
          [20, 38],
          [-18, 38],
          [-29, 26],
        ];
        const loop = (y: number, size: number): Point[] => outline.map(([x, z]) => [146 + x * size, y, z * size]);
        const band = (low: Point[], high: Point[], front: string, edge: string) => {
          for (let i = 0; i < low.length; i++) {
            const j = (i + 1) % low.length;
            const a = low[i],
              b = low[j];
            if ((b[2] - a[2]) * dx - (b[0] - a[0]) * dz > 0)
              poly([a, b, high[j], high[i]], a[0] + b[0] > 301 ? edge : front, '#693f2e');
          }
        };
        const base = loop(61, 0.8),
          block = loop(89, 1),
          cap = loop(98, 1.02),
          crown = loop(105, 0.8);
        band(base, block, '#a7633f', '#874931');
        band(block, cap, '#674c3e', '#583d32');
        band(cap, crown, '#f29748', '#da742d');
        poly(crown, '#ffad5d', '#a75b30');
        plane(
          (u, v) => [146 + u, 105, v],
          () => {
            panel(c, 'M-16 -24 L-10 -29 H8 L14 -22 V20 L8 26 H-9 L-16 20Z', '#845339');
            for (let i = -19; i <= 20; i += 9) {
              c.fillStyle = '#ffc992';
              c.fillRect(-11, i, 20, 3.2);
            }
            disc(c, 16, 17, 5, '#704e37');
            disc(c, 16, 17, 3.1, '#f7b944');
          },
        );
        for (const z of [-26, -10, 6, 22]) {
          const tubing: Point[] = [
            [156, 98, z],
            [171, 100, z],
            [180, 95, z],
            [182, 84, z],
            [176, 78, z],
          ];
          line(tubing, '#855030', 6);
          line(tubing, '#f8ab68', 3.6);
        }
      },
    });
  }
  box('electric', 131, 93, -61, 36, 25, 29);
  for (const x of [119, 143]) box('electric', x, 107, -60, 5, 4, 5);
  box('cooling', 207, 72, 0, 9, 48, 117);
  for (let y = 53; y <= 92; y += 7) box('cooling', 213, y, 0, 3, 2.5, 108);
  box('transmission', 94, 60, 14, 40, 31, 47);
  rod(
    'transmission',
    [
      [-145, 42, 0],
      [90, 49, 0],
    ],
    9,
  );
  for (const x of axles) {
    rod(
      'transmission',
      [
        [x, 43, -76],
        [x, 43, 76],
      ],
      5,
    );
    for (const s of [-1, 1]) {
      if (active.has('suspension')) {
        rod(
          'suspension',
          [
            [x - 16, 36, s * 54],
            [x, 31, s * 81],
            [x + 16, 36, s * 54],
          ],
          4,
        );
        const turns: Point[] = Array.from({ length: 45 }, (_, i) => [
          x + 7 * Math.cos(i * 0.71),
          48 + i * 0.79,
          s * (74 + 7 * Math.sin(i * 0.71)),
        ]);
        rod('suspension', turns, 3.2);
      }
      if (active.has('brakes'))
        details.push({
          center: [x, 43, s * 91],
          paint: () => {
            plane(wheelFace(x, s, 91), () => {
              disc(c, 0, 0, 24, '#783b42');
              disc(c, 0, 0, 21, '#fa8a86');
              disc(c, 0, 0, 11, '#884850');
              for (let i = 0; i < 12; i++) disc(c, 16 * Math.cos((i * Math.PI) / 6), 16 * Math.sin((i * Math.PI) / 6), 1.2, '#a65054');
              panel(c, 'M-20 14 Q-28 7 -23 -9 L-16 -7 Q-18 3 -13 9Z', partColors.brakes);
            });
          },
        });
    }
  }
  for (const x of [-92, 5])
    for (const z of [-43, 43]) {
      box('interior', x, 76, z, 45, 10, 38);
      box('interior', x - 20, 98, z, 9, 41, 38);
      box('interior', x - 21, 126, z, 9, 14, 21);
    }
  if (active.has('mirrors')) for (const s of [-1, 1]) details.push({ center: [72, 130, s * 107], paint: () => drawMirror(s, true) });
  details.sort((a, b) => depth(a.center) - depth(b.center));
  details.forEach(({ paint }) => paint());
}
