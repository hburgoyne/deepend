import {z} from 'zod';
const uuid=z.string().uuid(), room={room_id:uuid.optional()}, str=(n:number)=>z.string().min(1).max(n);
const gen=z.coerce.number().int().positive(), seq=z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const operations:Record<string,z.ZodType>={
 home:z.object({}),state:z.object(room),events:z.object({...room,after:seq.default(0),limit:z.coerce.number().int().min(1).max(500).default(100)}),
 receipt:z.object({...room,id:uuid}), 'room.export':z.object({room_id:uuid}),
 'room.create':z.object({title:str(120)}), 'room.settings':z.object({room_id:uuid,title:str(120).optional(),budget:z.coerce.number().int().min(1).max(30).optional(),paused:z.enum(['true','false']).optional()}),
 'room.delete':z.object({room_id:uuid}), 'invite.create':z.object({room_id:uuid}), 'invite.accept':z.object({token:str(128)}),
 'member.promote':z.object({room_id:uuid,human_id:uuid}),
 'member.confirm':z.object({room_id:uuid,human_id:uuid}), 'member.remove':z.object({room_id:uuid,human_id:uuid}),
 'connection.create':z.object({room_id:uuid,name:str(80),platform:z.enum(['muse','instinct','openclaw','other']),kind:z.enum(['bearer','activation'])}),
 'connection.rotate':z.object({room_id:uuid,connection_id:uuid,kind:z.enum(['bearer','activation'])}),
 'hook.approve':z.object({room_id:uuid,pairing_id:uuid,public_key:str(43)}),
 'hook.renew':z.object({room_id:uuid,pairing_id:uuid,public_key:str(43)}),
 'hook.deny':z.object({room_id:uuid,pairing_id:uuid,public_key:str(43)}),
 'hook.revoke':z.object({room_id:uuid,pairing_id:uuid,public_key:str(43)}),
 'connection.wake':z.object({room_id:uuid,connection_id:uuid}),
 'connection.revoke':z.object({room_id:uuid,connection_id:uuid}), 'contact.set':z.object({room_id:uuid,connection_id:uuid}),
 message:z.object({...room,body:str(4000),reply_to:seq.optional(),causation:seq.optional(),recipients:z.array(uuid).max(8).default([]),relay:z.enum(['true','false']).optional(),source_message_id:str(240).optional()}),
 'batch.claim':z.object(room), 'batch.finish':z.object({...room,generation:gen,outcome:z.enum(['handled','skipped'])}),
 'task.create':z.object({...room,title:str(240),detail:z.string().max(4000).default(''),assignee:uuid.optional()}),
 'task.claim':z.object({...room,task_id:uuid}), 'task.renew':z.object({...room,task_id:uuid,generation:gen}),
 'task.update':z.object({...room,task_id:uuid,generation:gen,state:z.enum(['running','blocked','done','cancelled']),detail:z.string().max(4000).optional()}),
 'delivery.prepare':z.object({...room,through:seq,payload:z.string().max(4000).optional()}),
 'delivery.resolve':z.object({room_id:uuid,delivery_id:uuid,outcome:z.enum(['delivered','skipped'])}),
 'delivery.check':z.object({...room,delivery_id:uuid}),
 'delivery.claim':z.object({...room,delivery_id:uuid}),
 'delivery.result':z.object({...room,delivery_id:uuid,outcome:z.enum(['delivered','skipped','uncertain'])}),
};
export const reads=new Set(['home','state','events','receipt','room.export','delivery.check']);
export function validate(op:string,body:unknown):Record<string,unknown>{
 const schema=operations[op]; if(!schema) throw new Error('invalid_operation');
 return schema.parse(body) as Record<string,unknown>;
}
