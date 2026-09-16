import type {Request} from 'express';
import {z} from 'zod';
import {canonicalBytes,fingerprint,registrationBytes,requestBytes,sha256,verifyProof} from '../connectors/hook/protocol.mjs';
import {esc,form,page} from './views.js';
export {fingerprint};
const uuid=z.string().uuid().refine(v=>v===v.toLowerCase());
const timestamp=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).refine(v=>Math.abs(Date.now()/1000-v)<=60);
const b64=(size:number)=>z.string().refine(v=>{try{canonicalBytes(v,size);return true;}catch{return false;}});
const registration=z.object({request_id:uuid,public_key:b64(32),label:z.string().min(1).max(80).regex(/^[^\x00-\x1f\x7f]+$/),timestamp,nonce:b64(32),signature:b64(64)}).strict();
export type HookRpc=(action:string,body:any,credential?:boolean)=>Promise<any>;
export function secureHeaders(req:Request){
 const seen=new Set<string>();let size=0;
 for(let i=0;i<(req.rawHeaders??[]).length;i+=2){
  const key=req.rawHeaders[i].toLowerCase(),value=req.rawHeaders[i+1];size+=Buffer.byteLength(key+value);
  if(key.startsWith('deepend-')||['authorization','host','content-length','transfer-encoding'].includes(key)){
   if(seen.has(key))throw new Error('invalid_input');seen.add(key);
  }
 }
 if(size>8192)throw new Error('invalid_input');
}
export async function registerHook(req:Request,origin:string,humanOrigin:string,rpc:HookRpc){
 secureHeaders(req);
 if(req.originalUrl!=='/v1/hook-pairings'||!req.get('authorization'))throw new Error('invalid_input');
 const b=registration.parse(req.body),context=await rpc('register_context',{},true);
 verifyProof(b.public_key,registrationBytes(origin,context.connection_id,b),b.signature);
 const data=await rpc('register',{...b,signature:undefined,nonce:undefined,nonce_hash:sha256(b.nonce),connection_id:context.connection_id},true);
 return {...data,fingerprint:fingerprint(b.public_key).display,approval_url:humanOrigin+'/hook-pairings/'+data.pairing_id};
}
export async function signedHook(req:Request,origin:string,path:string,action:'wake'|'status',rpc:HookRpc){
 secureHeaders(req);
 if(req.method!=='GET'||req.originalUrl!==path||req.get('authorization')||req.get('cookie')||req.get('transfer-encoding')||(req.get('content-length')&&req.get('content-length')!=='0'))throw new Error('invalid_input');
 const decimal=(key:string)=>{
  const value=req.get(key);if(!value||!/^(0|[1-9][0-9]*)$/.test(value))throw new Error('invalid_input');return Number(value);
 };
 const b={pairing_id:uuid.parse(req.get('deepend-pairing-id')),key_generation:z.number().int().positive().max(2147483647).parse(decimal('deepend-key-generation')),timestamp:timestamp.parse(decimal('deepend-timestamp')),nonce:b64(32).parse(req.get('deepend-nonce'))};
 const signature=b64(64).parse(req.get('deepend-signature'));
 const context=await rpc('lookup',{pairing_id:b.pairing_id});
 if(context.key_generation!==b.key_generation)throw new Error('unauthorized');
 verifyProof(context.public_key,requestBytes(origin,path,context.connection_id,b),signature);
 return rpc(action,{...b,nonce:undefined,nonce_hash:sha256(b.nonce),public_key:context.public_key});
}
export function pairingPage(hp:any,agentOrigin:string){
 const f=fingerprint(hp.public_key),v={room_id:hp.room_id,pairing_id:hp.id,public_key:hp.public_key};
 const expired=new Date(hp.state==='pending'?hp.enrollment_expires_at:hp.expires_at).getTime()<=Date.now();
 return page('Pair a wake hook',`<p>Room: <strong>${esc(hp.room_title)}</strong> · Agent: <strong>${esc(hp.agent_name)}</strong></p><p>Owner: ${esc(hp.owner_email)} · Label: ${esc(hp.label)}</p><p>Server: ${esc(agentOrigin)}</p><p>Requested: ${esc(hp.requested_at)} · Status: ${esc(hp.state)}${expired?' (expired)':''}</p><section><h2>Compare all eight fingerprint groups</h2><pre>${esc(f.display)}</pre><p>Match this with the fingerprint your agent’s setup helper showed you. Approve only a request you started for this room and agent.</p><details><summary>Full fingerprint</summary><code>${f.full}</code></details></section><p>This grants only “is work pending?” checks. It does not allow reading or posting messages. Approval lasts 90 days; your agent’s normal credential must also remain valid. Approving a replacement revokes the previous paired hook for this agent.</p>${hp.state==='pending'&&!expired?form('hook.approve','',v,'Review approval')+form('hook.deny','',v,'Deny request'):''}${hp.state==='approved'?`<p>Expires: ${esc(hp.expires_at)} · Last check: ${esc(hp.last_hook_seen??'Not checked yet')}</p>`+form('hook.renew','',v,'Review 90-day renewal'):''}${['pending','approved'].includes(hp.state)?form('hook.revoke','',v,'Revoke pairing'):''}<a href="/room/${hp.room_id}">Back to room</a>`);
}
export function pairingList(pairings:any[]){
 return `<section><h2>Your paired hooks</h2>${pairings.length?pairings.map(hp=>`<p><a href="/hook-pairings/${hp.id}">${esc(hp.label)}</a> · ${esc(hp.state)} · last check ${esc(hp.last_hook_seen??'not yet')}</p>`).join(''):'<p>No hooks paired. Your agent can prepare a request and give you a fingerprint to approve here.</p>'}</section>`;
}
