import * as THREE from 'three';
import { boxSpan, boxUV, mesh } from '../../packages/room-runtime/helpers';
import { wallPoint, type WallDef } from '../../packages/room-runtime/walls';
import type { KitchenWall } from './shell';
import { frameOpening } from './shell';
import {
  BAR_TOP, bounds, CEILING, EAST_TOP, FRIDGE_FRONT, FRIDGE_TOP, HOOD, NORTH_TOP,
  scanObjects, SEAT_Y, SLAB, SOUTH_TOP,
} from './measure';

type Mats = Record<string, THREE.Material>;

const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, material: THREE.Material) => {
  if (x1 - x0 < 0.008 || y1 - y0 < 0.004 || z1 - z0 < 0.008) return null;
  return boxSpan([x0, y0, z0], [x1, y1, z1], material);
};

function add(wall: KitchenWall | undefined, obj: THREE.Object3D | null) {
  if (wall && obj) wall.group.add(obj);
}

/** Five-sided basin, open at the top, rim flush with the counter. */
function basin(x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, material: THREE.Material) {
  const g = new THREE.Group();
  const t = 0.012;
  const parts = [
    box(x0, x1, y0, y0 + t, z0, z1, material),
    box(x0, x0 + t, y0, y1, z0, z1, material),
    box(x1 - t, x1, y0, y1, z0, z1, material),
    box(x0, x1, y0, y1, z0, z0 + t, material),
    box(x0, x1, y0, y1, z1 - t, z1, material),
  ];
  for (const p of parts) if (p) g.add(p);
  return g;
}

function stool(x: number, z: number, wood: THREE.Material, fabric: THREE.Material) {
  const g = new THREE.Group();
  g.name = 'stool';
  g.position.set(x, 0, z);
  const leg = 0.035;
  for (const lx of [-0.18, 0.18]) {
    for (const lz of [-0.16, 0.16]) {
      const p = box(lx - leg / 2, lx + leg / 2, 0, SEAT_Y - 0.04, lz - leg / 2, lz + leg / 2, wood);
      if (p) g.add(p);
    }
  }
  // Footrest is visible in the stool photos; its height is corrected against those views.
  const rail = box(-0.18, 0.18, 0.28, 0.31, -leg / 2, leg / 2, wood);
  if (rail) g.add(rail);
  const seat = box(-0.22, 0.22, SEAT_Y - 0.05, SEAT_Y + 0.03, -0.2, 0.16, fabric);
  if (seat) g.add(seat);
  const back = box(-0.2, 0.2, SEAT_Y + 0.02, 1.0, 0.12, 0.19, fabric);
  if (back) g.add(back);
  const posts = box(-0.2, 0.2, SEAT_Y, 1.0, 0.1, 0.13, wood);
  if (posts) {
    // Wood shows as a frame around the cushion: two side posts, not a full panel.
    posts.scale.x = 0.12;
    posts.position.x = -0.18;
    g.add(posts);
    const right = posts.clone();
    right.position.x = 0.18;
    g.add(right);
  }
  return g;
}

function doorLeaf(wall: WallDef, u0: number, u1: number, v1: number, mats: Mats) {
  const g = new THREE.Group();
  g.name = 'door';
  const width = u1 - u0;
  const leaf = mesh(boxUV(new THREE.BoxGeometry(width, v1, 0.04)), mats.door);
  leaf.position.copy(wallPoint(wall, (u0 + u1) / 2, v1 / 2, -0.02));
  leaf.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(wall.u, new THREE.Vector3(0, 1, 0), wall.n));
  g.add(leaf);
  // Narrow vertical lite, right of center, from photo 22. Proportions are refined against that camera.
  const liteU0 = u1 - 0.26;
  const liteU1 = u1 - 0.15;
  const lite = mesh(new THREE.PlaneGeometry(liteU1 - liteU0, 0.62), mats.glass);
  lite.position.copy(wallPoint(wall, (liteU0 + liteU1) / 2, 1.15, 0.012));
  lite.quaternion.copy(leaf.quaternion);
  g.add(lite);
  const handle = mesh(new THREE.BoxGeometry(0.09, 0.035, 0.04), mats.black);
  handle.position.copy(wallPoint(wall, u1 - 0.07, 1.02, 0.03));
  handle.quaternion.copy(leaf.quaternion);
  g.add(handle);
  return g;
}

export function buildFixtures(mats: Mats, walls: KitchenWall[]) {
  const wall = (index: number) => walls.find((w) => w.index === index);
  const blocks: [number, number, number, number][] = [];
  const block = (x0: number, x1: number, z0: number, z1: number) => blocks.push([x0 - 0.04, x1 + 0.04, z0 - 0.04, z1 + 0.04]);

  const storage = scanObjects.filter((o) => o.category === 'storage' && Math.min(o.size[0], o.size[2]) > 0.05);
  const uppers = storage.filter((o) => o.center[1] > 1.4);
  const bases = storage.filter((o) => o.center[1] < 1.2);
  const east = bases.find((o) => o.center[0] > 2);
  const north = bases.filter((o) => o.center[2] < -1).sort((a, b) => a.center[0] - b.center[0]);
  const south = bases.find((o) => o.center[2] > 1);
  const northWall = wall(0)!;
  const eastWall = wall(2)!;
  const southWall = wall(3)!;
  const northZ = northWall.def.origin.z;

  if (east) {
    const b = bounds(east);
    const x0 = b.x0;
    const x1 = eastWall.def.origin.x;
    const z0 = b.z0;
    const z1 = b.z1;
    const sink = bounds(scanObjects.find((o) => o.category === 'sink')!);
    const bowl = sink.y0;
    add(eastWall, box(x0, x1, 0, bowl, z0, z1, mats.wood));
    add(eastWall, box(x0, sink.x0, bowl, EAST_TOP - SLAB, sink.z0, sink.z1, mats.wood));
    add(eastWall, box(sink.x1, x1, bowl, EAST_TOP - SLAB, sink.z0, sink.z1, mats.wood));
    add(eastWall, box(x0, x1, bowl, EAST_TOP - SLAB, z0, sink.z0, mats.wood));
    add(eastWall, box(x0, x1, bowl, EAST_TOP - SLAB, sink.z1, z1, mats.wood));
    const counter = (za: number, zb: number, xa = x0, xb = x1) => add(eastWall, box(xa, xb, EAST_TOP - SLAB, EAST_TOP, za, zb, mats.counter));
    counter(z0, sink.z0);
    counter(sink.z1, z1);
    counter(sink.z0, sink.z1, x0, sink.x0);
    counter(sink.z0, sink.z1, sink.x1, x1);
    const midZ = (sink.z0 + sink.z1) / 2;
    add(eastWall, basin(sink.x0, sink.x1, sink.z0 + 0.01, midZ - 0.008, sink.y0, EAST_TOP, mats.steel));
    add(eastWall, basin(sink.x0, sink.x1, midZ + 0.008, sink.z1 - 0.01, sink.y0, EAST_TOP, mats.steel));
    block(x0, x1, z0, z1);
  }

  const fridge = bounds(scanObjects.find((o) => o.category === 'refrigerator')!);
  // Unlabeled span between the fridge and the first RoomPlan base box. The mesh has cabinet points there.
  if (north.length) {
    const first = bounds(north[0]);
    if (first.x0 - fridge.x1 > 0.15) {
      const gap = { x0: fridge.x1, x1: first.x0, z0: northZ, z1: first.z1 };
      add(northWall, box(gap.x0, gap.x1, 0, NORTH_TOP - SLAB, gap.z0, gap.z1, mats.wood));
      add(northWall, box(gap.x0, gap.x1, NORTH_TOP - SLAB, NORTH_TOP, gap.z0, gap.z1, mats.counter));
      block(gap.x0, gap.x1, gap.z0, gap.z1);
    }
  }

  north.forEach((cab, i) => {
    const b = bounds(cab);
    let x1 = b.x1;
    // Close a few centimetres between the last north box and the east run.
    if (i === north.length - 1 && east) x1 = Math.max(x1, bounds(east).x0);
    add(northWall, box(b.x0, x1, 0, NORTH_TOP - SLAB, northZ, b.z1, mats.wood));
    add(northWall, box(b.x0, x1, NORTH_TOP - SLAB, NORTH_TOP, northZ, b.z1, mats.counter));
    block(b.x0, x1, northZ, b.z1);
  });

  const stove = bounds(scanObjects.find((o) => o.category === 'stove')!);
  add(northWall, box(stove.x0 + 0.02, stove.x1 - 0.02, NORTH_TOP, NORTH_TOP + 0.008, stove.z0 + 0.04, stove.z1 - 0.02, mats.black));

  // Chimney widened from the LiDAR stub to the metal column in photo 43. Visor is the curved glass, drawn flat.
  add(northWall, box(HOOD.chimney.x0, HOOD.chimney.x1, HOOD.chimney.y0, HOOD.chimney.y1, northZ, HOOD.chimney.z1, mats.steel));
  add(northWall, box(HOOD.glass.x0, HOOD.glass.x1, HOOD.glass.y0, HOOD.glass.y1, HOOD.chimney.z1, HOOD.glass.z1, mats.visor));

  const fridgeBody = box(fridge.x0, fridge.x1, 0, FRIDGE_TOP, northZ, FRIDGE_FRONT, mats.fridge);
  add(northWall, fridgeBody);
  const seam = (fridge.x0 + fridge.x1) / 2;
  add(northWall, box(seam - 0.008, seam + 0.008, 0.04, FRIDGE_TOP - 0.02, FRIDGE_FRONT, FRIDGE_FRONT + 0.012, mats.black));
  for (const side of [-1, 1]) {
    add(northWall, box(seam + side * 0.03, seam + side * 0.045, 0.7, FRIDGE_TOP - 0.35, FRIDGE_FRONT, FRIDGE_FRONT + 0.03, mats.steel));
  }
  // Dispenser on the west door. Size is a fraction of that door, checked against photo 4.
  add(northWall, box(fridge.x0 + 0.08, seam - 0.06, 0.95, 1.42, FRIDGE_FRONT, FRIDGE_FRONT + 0.008, mats.black));
  block(fridge.x0, fridge.x1, northZ, FRIDGE_FRONT);

  if (south) {
    const b = bounds(south);
    const x1 = east ? Math.min(b.x1, bounds(east).x0) : b.x1;
    add(southWall, box(b.x0, x1, 0, SOUTH_TOP - SLAB, b.z0, b.z1, mats.wood));
    add(southWall, box(b.x0, x1, SOUTH_TOP - SLAB, SOUTH_TOP, b.z0, b.z1, mats.counter));
    const oven = bounds(scanObjects.find((o) => o.category === 'oven')!);
    add(southWall, box(oven.x0, Math.min(oven.x1, x1), 0.06, SOUTH_TOP - SLAB - 0.01, b.z0 - 0.01, b.z0 + 0.02, mats.steel));
    add(southWall, box(oven.x0 + 0.04, Math.min(oven.x1, x1) - 0.04, 0.55, SOUTH_TOP - SLAB - 0.08, b.z0 - 0.012, b.z0 + 0.004, mats.black));
    block(b.x0, x1, b.z0, b.z1);
  }

  for (const cab of uppers) {
    const b = bounds(cab);
    const y1 = Math.min(b.y1, CEILING - 0.004);
    if (cab.center[0] > 2) {
      add(eastWall, box(b.x0, b.x1, b.y0, y1, b.z0, b.z1, mats.upper));
      const mid = (b.y0 + y1) / 2;
      add(eastWall, box(b.x0 - 0.006, b.x0 + 0.004, mid - 0.008, mid + 0.008, b.z0, b.z1, mats.black));
    } else {
      // The RoomPlan box is the whole south run. Photos show one open bay at the
      // near end (about as deep as the box is wide) and closed doors over the window.
      const t = 0.018;
      const split = b.x0 + Math.min(0.48, b.x1 - b.x0);
      add(southWall, box(split, b.x1, b.y0, y1, b.z0, b.z1, mats.upper));
      add(southWall, box(b.x0, split, b.y0, y1, b.z1 - t, b.z1, mats.upper));
      add(southWall, box(b.x0, b.x0 + t, b.y0, y1, b.z0, b.z1, mats.upper));
      add(southWall, box(split - t, split, b.y0, y1, b.z0, b.z1, mats.upper));
      add(southWall, box(b.x0, split, y1 - t, y1, b.z0, b.z1, mats.upper));
      add(southWall, box(b.x0, split, b.y0, b.y0 + t, b.z0, b.z1, mats.upper));
      const shelfY = (b.y0 + y1) / 2;
      add(southWall, box(b.x0 + t, split - t, shelfY - t / 2, shelfY + t / 2, b.z0 + 0.02, b.z1 - t, mats.upper));
    }
  }

  const bar = bounds(scanObjects.find((o) => o.category === 'table')!);
  const slab = 0.03;
  add(southWall, box(bar.x0, bar.x1, 0, BAR_TOP - slab, bar.z0, bar.z1, mats.white));
  add(southWall, box(bar.x0, bar.x1, BAR_TOP - slab, BAR_TOP, bar.z0, bar.z1, mats.counter));
  block(bar.x0, bar.x1, bar.z0, bar.z1);

  const root = new THREE.Group();
  root.name = 'stools';
  for (const chair of scanObjects.filter((o) => o.category === 'chair')) {
    const b = bounds(chair);
    root.add(stool((b.x0 + b.x1) / 2, bar.z0 - 0.28, mats.stoolWood, mats.stoolFabric));
  }

  const west = wall(1)!;
  const door = west.def.openings.find((o) => o.v0 === 0);
  if (door && door.kind === 'rect') add(west, doorLeaf(west.def, door.u0, door.u1, door.v1, mats));

  const glaze = (host: KitchenWall, opening: { u0: number; u1: number; v0: number; v1: number }, mullion: boolean) => {
    add(host, frameOpening(host.def, opening.u0, opening.u1, opening.v0, opening.v1, 0.025, mats.frame, 0.01));
    const basis = new THREE.Matrix4().makeBasis(host.def.u, new THREE.Vector3(0, 1, 0), host.def.n);
    if (mullion) {
      const bar = mesh(boxUV(new THREE.BoxGeometry(0.02, opening.v1 - opening.v0, 0.02)), mats.frame);
      bar.position.copy(wallPoint(host.def, (opening.u0 + opening.u1) / 2, (opening.v0 + opening.v1) / 2, 0.012));
      bar.quaternion.setFromRotationMatrix(basis);
      add(host, bar);
    }
    const glass = mesh(new THREE.PlaneGeometry(opening.u1 - opening.u0 - 0.04, opening.v1 - opening.v0 - 0.04), mats.glass);
    glass.position.copy(wallPoint(host.def, (opening.u0 + opening.u1) / 2, (opening.v0 + opening.v1) / 2, -0.015));
    glass.quaternion.setFromRotationMatrix(basis);
    add(host, glass);
  };
  for (const host of [eastWall, southWall]) {
    for (const opening of host.def.openings) {
      if (opening.kind === 'rect' && opening.v0 > 0.5 && opening.v1 < 2) glaze(host, opening, host.index === 2);
    }
  }

  return {
    root,
    blocked(x: number, z: number) {
      return blocks.some(([x0, x1, z0, z1]) => x > x0 && x < x1 && z > z0 && z < z1);
    },
  };
}
