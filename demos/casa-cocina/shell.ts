import * as THREE from 'three';
import { buildWall, wallPoint, type Opening, type WallDef } from '../../packages/room-runtime/walls';
import { boxUV, mesh } from '../../packages/room-runtime/helpers';
import { BAR_TOP, CEILING, FLOOR, insideRoom, JOG, PASS_X, polygon, scanRoom, SOUTH_WINDOW, THICKNESS } from './measure';

export interface KitchenWall {
  index: number;
  def: WallDef;
  group: THREE.Group;
}

function horizontal(points: [number, number][], y: number) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  return geo;
}

export function buildShell(paint: { gray: THREE.Material; white: THREE.Material; trim: THREE.Material; floor: THREE.Material; ceiling: THREE.Material }) {
  const walls: KitchenWall[] = [];
  for (const w of scanRoom.walls) {
    // RoomPlan wall 4 (x=−1.31, 0.60 m) has no LiDAR between y=0.3 and y=1.9.
    if (w.index === 4) continue;
    const u = new THREE.Vector3(w.u[0], w.u[1], w.u[2]).normalize();
    const n = new THREE.Vector3(w.n[0], w.n[1], w.n[2]).normalize();
    const origin = new THREE.Vector3(w.origin[0], w.origin[1], w.origin[2]);
    const end = origin.clone().addScaledVector(u, w.length);
    const endExt = (p: THREE.Vector3, dir: THREE.Vector3) => {
      const probe = p.clone().addScaledVector(dir, 0.08).addScaledVector(n, -0.02);
      return insideRoom(probe.x, probe.z) ? 0 : THICKNESS;
    };
    const openings: Opening[] = w.openings.map((o) => ({
      kind: 'rect',
      u0: o.u0,
      u1: o.u1,
      v0: o.v0,
      v1: Math.min(o.v1, CEILING - 0.02),
      casing: false,
    }));
    if (w.index === 3) {
      const uOf = (x: number, z: number) => (x - origin.x) * u.x + (z - origin.z) * u.z;
      const uSplit = uOf(PASS_X, origin.z);
      const uEnd = uOf(w.b[0], w.b[1]);
      // Keep the hole off the slab edge: this end has no exterior extension (the floor continues).
      openings.push({
        kind: 'rect',
        u0: Math.min(uSplit, uEnd),
        u1: Math.max(uSplit, uEnd) - 0.02,
        v0: BAR_TOP,
        v1: CEILING - 0.02,
      });
      const uWin0 = uOf(SOUTH_WINDOW.x1, origin.z);
      const uWin1 = uOf(SOUTH_WINDOW.x0, origin.z);
      openings.push({
        kind: 'rect',
        u0: Math.min(uWin0, uWin1),
        u1: Math.max(uWin0, uWin1),
        v0: SOUTH_WINDOW.v0,
        v1: SOUTH_WINDOW.v1,
      });
    }
    const gray = w.index === 0 || w.index === 2 || w.index === 3;
    const def: WallDef = {
      name: `cocina-${w.index}`,
      origin, u, n,
      length: w.length,
      thickness: THICKNESS,
      height: CEILING,
      openings,
      panels: [],
      crown: false,
      baseboardGaps: [[-1, w.length + 1]],
      ext: [endExt(origin, u.clone().negate()), endExt(end, u)],
      material: gray ? paint.gray : paint.white,
      trimMaterial: paint.trim,
    };
    const group = buildWall(def);
    walls.push({ index: w.index, def, group });
  }

  // Mesh return at the southwest jog. Interior face z = 1.817, from the west wall to x=−1.78.
  const west = walls.find((w) => w.index === 1)!;
  const jogOrigin = new THREE.Vector3(JOG.x1, 0, JOG.z);
  const jogU = new THREE.Vector3(-1, 0, 0);
  const jogN = new THREE.Vector3(0, 0, -1);
  const jogLen = JOG.x1 - west.def.origin.x;
  const jog: WallDef = {
    name: 'cocina-jog',
    origin: jogOrigin,
    u: jogU,
    n: jogN,
    length: jogLen,
    thickness: THICKNESS,
    height: CEILING,
    openings: [],
    panels: [],
    crown: false,
    baseboardGaps: [[-1, jogLen + 1]],
    ext: [0, 0],
    material: paint.white,
    trimMaterial: paint.trim,
  };
  walls.push({ index: 5, def: jog, group: buildWall(jog) });

  const floor = mesh(horizontal(polygon, 0.014), paint.floor, 'floor');
  floor.receiveShadow = true;
  floor.castShadow = false;
  const ceiling = mesh(horizontal(polygon, CEILING), paint.ceiling, 'ceiling');
  ceiling.castShadow = false;
  // Keep the floor from sitting exactly on y=0 where cabinet bottoms also land.
  floor.position.y = FLOOR;

  return { walls, floor, ceiling };
}

export function frameOpening(wall: WallDef, u0: number, u1: number, v0: number, v1: number, bar: number, material: THREE.Material, out = 0.012) {
  const g = new THREE.Group();
  const add = (u: number, v: number, su: number, sv: number) => {
    const piece = mesh(boxUV(new THREE.BoxGeometry(su, sv, 0.02)), material);
    piece.position.copy(wallPoint(wall, u, v, out));
    piece.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(wall.u, new THREE.Vector3(0, 1, 0), wall.n));
    g.add(piece);
  };
  const cu = (u0 + u1) / 2;
  const cv = (v0 + v1) / 2;
  add(cu, v1 - bar / 2, u1 - u0, bar);
  add(cu, v0 + bar / 2, u1 - u0, bar);
  add(u0 + bar / 2, cv, bar, v1 - v0);
  add(u1 - bar / 2, cv, bar, v1 - v0);
  return g;
}
