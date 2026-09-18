import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const h1=randomUUID(),h2=randomUUID();let room:string,other:string,c1:string,c2:string;
async function call(kind:string,key:string,op:string,body:any={},request=randomUUID()):Promise<any>{return (await db.query<{v:any}>('select public.deepend_call($1,$2,$3,$4::jsonb,$5::uuid,$6) v',[kind,key,op,JSON.stringify(body),request,'test'])).rows[0].v;}
async function human(key:string,op:string,body:any={}){return call('human',key,op,body);}
before(async()=>{
 await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
 for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()) await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
 await db.query('select public.deepend_login($1,$2,$3)',[h1,'a@example.test','h1']);await db.query('select public.deepend_login($1,$2,$3)',[h2,'b@example.test','h2']);
 room=(await human('h1','room.create',{title:'Private pilot'})).room_id;other=(await human('h2','room.create',{title:'Other room'})).room_id;
 c1=(await human('h1','connection.create',{room_id:room,name:'Muse A',platform:'muse',kind:'bearer',token_hash:'a1'})).connection_id;
 c2=(await human('h1','connection.create',{room_id:room,name:'Muse A second',platform:'muse',kind:'bearer',token_hash:'a2'})).connection_id;
});after(()=>db.close());
test('private reads, server actor, idempotency conflict and scoped credentials',async()=>{
 assert.equal((await human('h2','state',{room_id:room})).error,'forbidden');
 assert.equal((await call('agent','a1','events',{room_id:other})).error,'forbidden');
 const id=randomUUID(),b={body:'Hello',from_member:c2};const first=await call('agent','a1','message',b,id);
 assert.equal(first.seq,1);assert.deepEqual(await call('agent','a1','message',b,id),first);
 assert.equal((await call('agent','a1','message',{body:'Changed'},id)).error,'request_conflict');
 const e=await call('agent','a1','events');assert.equal(e.events[0].actor_id,c1);
});
test('concurrent budget allocation and contiguous event ordering',async()=>{
 const responses=await Promise.all(Array.from({length:10},(_,i)=>call('agent',i%2?'a1':'a2','message',{body:'Message '+i})));
 assert.equal(responses.filter(r=>!r.error).length,7);assert.equal(responses.filter(r=>r.error==='human_input_required').length,3);
 const e=await call('agent','a1','events');assert.deepEqual(e.events.map((x:any)=>x.seq),Array.from({length:9},(_,i)=>i+1));
 assert.equal((await call('agent','a1','room.settings',{budget:8})).error,'forbidden');
 await human('h1','room.settings',{room_id:room,budget:8});
});
test('task leases reject competitors, expiry fences stale generation',async()=>{
 const task=await call('agent','a1','task.create',{title:'Canary'});const claim=await call('agent','a1','task.claim',{task_id:task.id});
 assert.equal((await call('agent','a2','task.claim',{task_id:task.id})).error,'lease_busy');
 await db.query("update deepend.tasks set lease_until=now()-interval '1 second' where id=$1",[task.id]);
 const second=await call('agent','a2','task.claim',{task_id:task.id});assert.equal(second.generation,claim.generation+1);
 assert.equal((await call('agent','a1','task.update',{task_id:task.id,generation:claim.generation,state:'done'})).error,'stale_lease');
 assert.equal((await call('agent','a2','task.update',{task_id:task.id,generation:second.generation,state:'done'})).state,'done');
});
test('received is distinct from handled and overlapping batches cannot advance cursor',async()=>{
 const before=await call('agent','a1','state');assert.equal(before.connection.cursor,0);
 const claim=await call('agent','a1','batch.claim');assert.equal((await call('agent','a1','batch.claim')).error,'lease_busy');
 assert.equal((await call('agent','a1','batch.finish',{generation:claim.generation+1,outcome:'handled'})).error,'stale_lease');
 await call('agent','a1','batch.finish',{generation:claim.generation,outcome:'handled'});
 assert.equal((await call('agent','a1','state')).connection.cursor,claim.through);
});
test('contact assignment prevents secondary notification and uncertain-send failover',async()=>{
 await human('h1','contact.set',{room_id:room,connection_id:c1});const state=await call('agent','a1','state');
 assert.equal((await call('agent','a2','delivery.prepare',{through:state.room.seq,payload:'Update'})).error,'not_contact');
 const d=await call('agent','a1','delivery.prepare',{through:state.room.seq,payload:'Update'});
 assert.equal((await call('agent','a1','delivery.prepare',{through:state.room.seq,payload:'Again'})).id,d.id);
 await call('agent','a1','delivery.claim',{delivery_id:d.id});
 assert.equal((await call('agent','a1','delivery.claim',{delivery_id:d.id})).error,'reconcile_before_retry');
 await call('agent','a1','delivery.result',{delivery_id:d.id,outcome:'uncertain'});
 assert.equal((await human('h1','contact.set',{room_id:room,connection_id:c2})).error,'delivery_reconciliation_required');
 await call('agent','a1','delivery.result',{delivery_id:d.id,outcome:'delivered'});
 assert.equal((await human('h1','contact.set',{room_id:room,connection_id:c2})).ok,true);
});
test('invitation requires independent human authentication and inviter confirmation',async()=>{
 await human('h1','invite.create',{room_id:room,token_hash:'invite'});
 assert.equal((await human('h2','invite.accept',{token_hash:'invite'})).status,'pending');
 assert.equal((await human('h2','state',{room_id:room})).error,'forbidden');
 assert.equal((await human('h2','invite.accept',{token_hash:'invite'})).error,'invalid_invitation');
 await human('h1','member.confirm',{room_id:room,human_id:h2});assert.equal((await human('h2','state',{room_id:room})).room.id,room);
});
test('activation single-use, expiration, revoked reads and kill switch',async()=>{
 const b=await human('h2','connection.create',{room_id:room,name:'Instinct B',platform:'instinct',kind:'activation',token_hash:'activation'});
 assert.equal((await call('public','activation','activate',{session_hash:'cookie'})).connection_id,b.connection_id);
 assert.equal((await call('public','activation','activate',{session_hash:'cookie2'})).error,'invalid_activation');
 assert.equal((await call('agent','cookie','state')).room.id,room);
 await db.exec('update deepend.control set paused=true');assert.equal((await call('agent','cookie','message',{body:'Blocked'})).error,'paused');
 await db.exec('update deepend.control set paused=false');
 await human('h1','member.remove',{room_id:room,human_id:h2});assert.equal((await call('agent','cookie','state')).error,'unauthorized');
 await db.exec("update deepend.credentials set expires_at=now()-interval '1 second' where hash='a2'");assert.equal((await call('agent','a2','state')).error,'unauthorized');
});
test('human group relays reset exhausted chatter once and only through the owner contact',async()=>{
 await human('h1','contact.set',{room_id:room,connection_id:c1});
 await db.query('update deepend.rooms set budget=0 where id=$1',[room]);
 const b={body:'Next round',relay:'true',source_message_id:'side-thread:human-message-1'};
 assert.equal((await call('agent','a1','message',{body:'agent chatter'})).error,'human_input_required');
 assert.equal((await call('agent','a1','message',{body:'human?',relay:'true'})).error,'source_message_required');
 const first=await call('agent','a1','message',b);assert.ok(first.seq);
 assert.equal((await call('agent','a1','state')).room.budget,8);
 await call('agent','a1','message',{body:'A response'});
 assert.equal((await call('agent','a1','message',b)).seq,first.seq);
 assert.equal((await call('agent','a1','state')).room.budget,7);
 assert.equal((await call('agent','a1','message',{...b,body:'Altered text'})).error,'request_conflict');
});
test('deliveries contain exact ordered events, ignore summaries and cannot skip discussion',async()=>{
 await db.exec('delete from deepend.rates');
 const state=await call('agent','a1','state');
 const d=await call('agent','a1','delivery.prepare',{through:state.room.seq,payload:'Hide the conversation'});
 assert.ok(d.payload.includes('[#'+d.source_end+']'));
 assert.ok(!d.payload.includes('Hide the conversation'));
 assert.equal(d.source_start,d.source_end);
 assert.equal((await call('agent','a1','delivery.result',{delivery_id:d.id,outcome:'skipped'})).error,'delivery_required');
 await call('agent','a1','delivery.claim',{delivery_id:d.id});
 await call('agent','a1','delivery.result',{delivery_id:d.id,outcome:'delivered'});
 const next=await call('agent','a1','delivery.prepare',{through:state.room.seq});
 assert.equal(next.source_start,d.source_end+1);
});
test('each owner has an independent contact and receives the same full conversation',async()=>{
 await db.exec('delete from deepend.rates');
 const r=(await human('h1','room.create',{title:'Two owners'})).room_id;
 await human('h1','invite.create',{room_id:r,token_hash:'two-owners'});
 await human('h2','invite.accept',{token_hash:'two-owners'});
 await human('h1','member.confirm',{room_id:r,human_id:h2});
 const a=(await human('h1','connection.create',{room_id:r,name:'A',platform:'muse',kind:'bearer',token_hash:'owner-a'})).connection_id;
 const b=(await human('h2','connection.create',{room_id:r,name:'B',platform:'muse',kind:'bearer',token_hash:'owner-b'})).connection_id;
 await human('h1','contact.set',{room_id:r,connection_id:a});
 await human('h2','contact.set',{room_id:r,connection_id:b});
 assert.equal((await human('h1','contact.set',{room_id:r,connection_id:b})).error,'forbidden');
 await call('agent','owner-a','message',{body:'Full text, not a summary.\nSecond line.'});
 await db.query("update deepend.events set created_at='2026-09-01 12:34:56+00' where room_id=$1 and seq=1",[r]);
 const da=await call('agent','owner-a','delivery.prepare',{through:1});
 const dbb=await call('agent','owner-b','delivery.prepare',{through:1});
 const posted=(await db.query<{stamp:string}>("select to_char(created_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS') stamp from deepend.events where room_id=$1 and seq=1",[r])).rows[0].stamp;
 assert.equal(da.payload,'[#1] '+posted+' UTC · A (agent for a@example.test)\nFull text, not a summary.\nSecond line.');
 assert.equal(da.payload,dbb.payload);assert.notEqual(da.id,dbb.id);
 assert.equal((await call('agent','owner-a','delivery.claim',{delivery_id:dbb.id})).error,'not_contact');
 await call('agent','owner-a','delivery.claim',{delivery_id:da.id});
 await call('agent','owner-a','delivery.result',{delivery_id:da.id,outcome:'delivered'});
 assert.equal((await call('agent','owner-b','delivery.prepare',{through:1})).id,dbb.id);
});
test('wake-only keys report pending without message access or worker activity',async()=>{
 await db.exec('delete from deepend.rates');
 const r=(await human('h1','room.create',{title:'Wake room'})).room_id;
 const c=(await human('h1','connection.create',{room_id:r,name:'Wake agent',platform:'muse',kind:'bearer',token_hash:'wake-agent'})).connection_id;
 const wake=async(key:string)=>(await db.query<{v:any}>("select public.deepend_wake($1,'wake-test') v",[key])).rows[0].v;
 await human('h1','connection.wake',{room_id:r,connection_id:c,token_hash:'wake-key'});
 assert.deepEqual(await wake('wake-key'),{pending:false});
 assert.equal((await wake('wake-agent')).error,'unauthorized');
 assert.equal((await call('agent','wake-key','state')).error,'unauthorized');
 assert.equal((await call('agent','wake-agent','connection.wake',{room_id:r,connection_id:c,token_hash:'bad'})).error,'forbidden');
 const before=(await db.query<{last_seen:any}>('select last_seen from deepend.connections where id=$1',[c])).rows[0].last_seen;
 await wake('wake-key');
 assert.deepEqual((await db.query<{last_seen:any}>('select last_seen from deepend.connections where id=$1',[c])).rows[0].last_seen,before);
 await call('agent','wake-agent','message',{body:'New event'});
 assert.deepEqual(await wake('wake-key'),{pending:true});
 const batch=await call('agent','wake-agent','batch.claim');
 assert.deepEqual(await wake('wake-key'),{pending:false});
 await call('agent','wake-agent','batch.finish',{generation:batch.generation,outcome:'handled'});
 assert.deepEqual(await wake('wake-key'),{pending:false});
 await human('h1','contact.set',{room_id:r,connection_id:c});
 await db.exec('delete from deepend.rates');
 assert.deepEqual(await wake('wake-key'),{pending:true}); // pending native delivery, despite handled events
 await human('h1','connection.wake',{room_id:r,connection_id:c,token_hash:'replacement-wake'});
 assert.equal((await wake('wake-key')).error,'unauthorized');
 await human('h1','connection.revoke',{room_id:r,connection_id:c});
 assert.equal((await wake('replacement-wake')).error,'unauthorized');
});
test('database denies public tables and server-only RPC; fresh login required',async()=>{
 await db.exec('set role anon');await assert.rejects(db.query('select * from deepend.rooms'));await assert.rejects(db.query("select public.deepend_call('human','h1','home')"));await db.exec('reset role');
 await db.exec("update deepend.human_sessions set verified_at=now()-interval '16 minutes' where hash='h1'");
 assert.equal((await human('h1','connection.create',{room_id:room,name:'x',platform:'muse',kind:'bearer',token_hash:'no'})).error,'reauthenticate');
});
