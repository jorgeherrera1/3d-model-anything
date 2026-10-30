import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { batchStatic } from '../../packages/room-runtime/batch';
import { loadTextures, textured } from '../../packages/room-runtime/materials';
import type { RoomModule } from '../../packages/room-runtime/types';
import { buildFixtures } from './fixtures';
import { CEILING, insideRoom, polygon, scanObjects, scanRoom } from './measure';
import { buildShell } from './shell';

function finish(color: string, roughness: number, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, ...extra });
}

export const casaCocina: RoomModule = {
  id: 'casa-cocina',
  label: 'Casa · cocina',
  async build() {
    await loadTextures();
    const mats = {
      gray: finish('#b7b2a8', 0.92),
      white: finish('#f4f1ea', 0.9),
      trim: finish('#e6e1d8', 0.7, { side: THREE.DoubleSide }),
      floor: finish('#f3eadc', 0.16, { metalness: 0.08 }),
      ceiling: finish('#f7f4ee', 0.95, { side: THREE.DoubleSide }),
      wood: textured({ color: '#7a4b30', set: 'oak', repeat: 1.8, roughness: 0.5 }),
      upper: finish('#5c6168', 0.48),
      counter: finish('#26272b', 0.18, { metalness: 0.06 }),
      steel: finish('#c8ccd1', 0.28, { metalness: 0.84 }),
      fridge: finish('#c2c6cb', 0.22, { metalness: 0.9 }),
      black: finish('#121212', 0.18, { metalness: 0.35 }),
      glass: finish('#1c2830', 0.05, { metalness: 0.15, transparent: true, opacity: 0.45, depthWrite: false }),
      visor: finish('#9aadae', 0.05, { metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
      door: finish('#5c3018', 0.52),
      frame: finish('#d8dbdf', 0.32, { metalness: 0.55 }),
      stoolWood: finish('#8d5a32', 0.48),
      stoolFabric: finish('#514c46', 0.86),
    };
    const shell = buildShell(mats);
    const fixtures = buildFixtures(mats, shell.walls);
    const group = new THREE.Group();
    group.name = 'casa-cocina';
    group.add(shell.floor, shell.ceiling, fixtures.root, ...shell.walls.map((w) => w.group));

    RectAreaLightUniformsLib.init();
    const lights = new THREE.Group();
    lights.name = 'cocina-lights';
    lights.add(new THREE.HemisphereLight('#e4e7ee', '#cbbba6', 0.55));
    const spot = new THREE.SpotLight('#fff3e4', 18, 0, THREE.MathUtils.degToRad(70), 0.85, 1.4);
    spot.position.set(0.2, CEILING - 0.04, -0.1);
    spot.target.position.set(0.2, 0, -0.1);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0004;
    spot.shadow.normalBias = 0.02;
    spot.shadow.camera.near = 0.1;
    spot.shadow.camera.far = 6;
    lights.add(spot, spot.target);
    // Night window: a weak cool fill, not daylight. The opening is on the east wall.
    const win = shell.walls.find((w) => w.index === 2)?.def.openings.find((o) => o.v0 > 0.5);
    if (win && win.kind === 'rect') {
      const east = shell.walls.find((w) => w.index === 2)!.def;
      const u = (win.u0 + win.u1) / 2;
      const v = (win.v0 + win.v1) / 2;
      const rect = new THREE.RectAreaLight('#c9d6e6', 2.2, win.u1 - win.u0, win.v1 - win.v0);
      rect.position.copy(east.origin).addScaledVector(east.u, u).add(new THREE.Vector3(0, v, 0)).addScaledVector(east.n, 0.05);
      rect.lookAt(rect.position.clone().add(east.n));
      lights.add(rect);
    }

    let optimized: ReturnType<typeof batchStatic> | undefined;
    return {
      layout: {
        note: 'RoomPlan boxes in the converted frame. South pass-through is cut where the mesh is open above the bar. RoomPlan wall 4 is omitted: the LiDAR has no surface there.',
        polygon,
        walls: scanRoom.walls.filter((w) => w.index !== 4).map((w) => ({
          a: w.a, b: w.b, u: w.u, length: w.length,
          openings: w.openings.map((o) => ({ kind: o.kind, u0: o.u0, u1: o.u1 })),
        })),
        objects: scanObjects.map((o) => ({ category: o.category, center: o.center, size: o.size, rotY: o.rotY })),
      },
      group,
      lights,
      walls: shell.walls.map((w) => ({ def: w.def, group: w.group })),
      ceiling: [shell.ceiling],
      wallTop: CEILING,
      exposure: 1.05,
      walkable: (x, z) => insideRoom(x, z)
        && insideRoom(x + 0.16, z) && insideRoom(x - 0.16, z)
        && insideRoom(x, z + 0.16) && insideRoom(x, z - 0.16)
        && !fixtures.blocked(x, z),
      camera: {
        orbit: [-1.55, 1.85, -0.85],
        target: [1.35, 1.05, 0.45],
        walk: [-0.4, 1.6, 0.0],
        walkLook: [1.8, 1.15, 0.35],
      },
      environment: { center: [0.15, 1.2, -0.05], intensity: 0.8 },
      async loadReference(onProgress) {
        const geo = await new PLYLoader().loadAsync('/casa-cocina/scan-room.ply', (e) => {
          if (e.lengthComputable) onProgress?.(e.loaded / e.total);
        });
        geo.computeVertexNormals();
        const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
        const scan = new THREE.Mesh(geo, material);
        scan.name = 'cocina-scan';
        onProgress?.(1);
        return scan;
      },
      referenceAvailable: true,
      referenceKind: 'scan',
      optimize(opts) {
        if (!optimized) optimized = batchStatic(group, [...shell.walls.map((w) => w.group), shell.ceiling], { mergeDynamic: !!opts?.static });
        return optimized;
      },
      photos: scanRoom.photos.map((p, i) => ({
        url: `/casa-cocina/photos/${String(i).padStart(4, '0')}.jpg`,
        position: p.position,
        forward: p.forward,
        up: p.up,
        fovY: p.fovY,
        aspect: p.aspect,
      })),
    };
  },
};
