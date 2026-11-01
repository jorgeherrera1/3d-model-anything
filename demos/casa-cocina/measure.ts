import room from '../../data/demos/casa-cocina/room.json';

/** LiDAR down-facing ceiling inside the floor polygon, 2 cm bins, median. RoomPlan walls are 2.647. */
export const CEILING = 2.632;
/** LiDAR up-facing floor median is +0.014 above the RoomPlan plane. The frame stays at RoomPlan y=0. */
export const FLOOR = 0;

/**
 * Counter surfaces: mode/median of up-facing LiDAR in each run.
 * East 0.976, north p50 0.941, south p50 0.953. Slab thickness is the east
 * gap between the RoomPlan cabinet top (0.954) and that surface.
 */
export const EAST_TOP = 0.976;
export const NORTH_TOP = 0.941;
export const SOUTH_TOP = 0.953;
export const SLAB = 0.022;

/** Bar top: mode of up-facing points over the peninsula, 1.095–1.100, median 1.110. */
export const BAR_TOP = 1.11;

/**
 * South wall is open above the bar. Upper-cabinet LiDAR resumes near x=0.95;
 * west of that, y=1.4–2.2 is empty. The cut starts at the bar top.
 */
export const PASS_X = 0.95;

/**
 * Hood. LiDAR only returned the upper chimney (x 0.405–0.675, y 1.94–2.54).
 * The metal column and the glass visor below it were fit on photo 43, using the
 * RoomPlan cooktop (0.67 m) as the scale. The visor is curved in the photo; the
 * model is a flat pane at that height.
 */
export const HOOD = {
  chimney: { x0: 0.38, x1: 0.95, y0: 1.55, y1: 2.62, z1: -1.72 },
  glass: { x0: 0.12, x1: 1.18, y0: 1.5, y1: 1.56, z1: -1.22 },
};

/** South return of the corner window. Same sill and head as the east window (photo 54). Width fit on that photo; LiDAR is thin here because the glass does not return. */
export const SOUTH_WINDOW = { x0: 1.15, x1: 2.484, v0: 1.042, v1: 1.521 };

/** Fridge top, mode of up-facing points 1.760–1.770. Front face mode z=−1.00. */
export const FRIDGE_TOP = 1.76;
export const FRIDGE_FRONT = -1.0;

/** Stool seat, median of up-facing points in the chair cluster. */
export const SEAT_Y = 0.75;

/** Southwest return seen in the mesh, not as a RoomPlan wall. x to the west wall, z median 1.817. */
export const JOG = { x1: -1.78, z: 1.817 };

/** Exterior extrusion only. Both faces of the walls were not scanned, so this is not a measured thickness. */
export const THICKNESS = 0.08;

export const polygon = room.polygon as [number, number][];

export function insideRoom(x: number, z: number) {
  let hit = false;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, z1] = polygon[i];
    const [x2, z2] = polygon[(i + 1) % polygon.length];
    if ((z1 > z) !== (z2 > z) && x < x1 + ((z - z1) * (x2 - x1)) / (z2 - z1)) hit = !hit;
  }
  return hit;
}

export interface ScanObject {
  category: string;
  center: number[];
  size: number[];
  rotY: number;
  front: number[];
}

/** Axis-aligned bounds of a RoomPlan box. rotY maps local +z to `front`. */
export function bounds(o: ScanObject) {
  const c = Math.cos(o.rotY);
  const s = Math.sin(o.rotY);
  const hw = o.size[0] / 2;
  const hd = o.size[2] / 2;
  const xs: number[] = [];
  const zs: number[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      xs.push(o.center[0] + c * sx * hw + s * sz * hd);
      zs.push(o.center[2] - s * sx * hw + c * sz * hd);
    }
  }
  return {
    x0: Math.min(...xs), x1: Math.max(...xs),
    z0: Math.min(...zs), z1: Math.max(...zs),
    y0: o.center[1] - o.size[1] / 2,
    y1: o.center[1] + o.size[1] / 2,
  };
}

export const scanRoom = room;
export const scanObjects = room.objects as ScanObject[];
