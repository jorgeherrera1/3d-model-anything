import type { RoomModule } from '../packages/room-runtime/types';
export const ROOMS: RoomModule[] = [
  {id:'office-v4', label:'Wes’s office', build:async () => (await import('./office-v4')).officeV4.build()},
  {id:'casa-cocina', label:'Casa · cocina', build:async () => (await import('./casa-cocina')).casaCocina.build()},
];
export const roomById = (id:string|null) => ROOMS.find(r=>r.id===id) ?? ROOMS[0];
export type {BuiltRoom, RoomModule} from '../packages/room-runtime/types';
