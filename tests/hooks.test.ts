import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,randomBytes,sign} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {createMocks} from 'node-mocks-http';
import {PGlite} from '@electric-sql/pglite';
import {createApp,hash,type Config} from '../src/app.js';
import {fingerprint,registrationBytes,requestBytes,verifyProof} from '../connectors/hook/protocol.mjs';
const db=new PGlite(),owner=randomUUID(),outsider=randomUUID();
const credential='a'.repeat(43),origin='https://agent.test',humanOrigin='https://human.test';
const config:Config={surface:'agent',humanOrigin,agentOrigin:origin,supabaseUrl:'https://db.test',publicKey:'public',serviceKey:'service',secret:'x'.repeat(48),allowedEmails:[]};
let room:string,connection:string;
const keys=generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({format:'jwk'}).x!;
async function rpc(name:string,args:any){
 const entries=Object.entries(args);
 try{return {data:(await db.query<{v:any}>(`select public.${name}(${entries.map(([k],i)=>`${k} => $${i+1}`).join(',')}) v`,entries.map(([,v])=>v!==null&&typeof v==='object'?JSON.stringify(v):v))).rows[0].v,error:null};}
 catch(e){throw e;}
}
async function human(op:string,body:any={},who='owner'){
 return (await rpc('deepend_call',{p_kind:'human',p_hash:hash(who),p_op:op,p_body:body,p_request:randomUUID(),p_ip:'local'})).data;
}
async function request(method:string,url:string,body:any={},headers:any={},surface:'agent'|'human'='agent',rawHeaders?:string[]){
 const app=createApp({...config,surface},{rpc,auth:{}});
 const {req,res}=createMocks({method:method as any,url,body,headers:{host:surface+'.test',...headers}},{eventEmitter:EventEmitter});
 if(rawHeaders)(req as any).rawHeaders=rawHeaders;
 await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('timeout')),5000);res.on('end',()=>{clearTimeout(timeout);resolve();});app(req as any,res as any);});
 let output=res._getData();try{output=JSON.parse(output);}catch{}
 return {status:res.statusCode,body:output,url:res._getRedirectUrl()};
}
const now=()=>Math.floor(Date.now()/1000);
function enrollment(overrides:any={}){
 const b={request_id:randomUUID(),public_key:publicKey,label:'Room hook',timestamp:now(),nonce:randomBytes(32).toString('base64url'),...overrides};
 return {...b,signature:sign(null,registrationBytes(origin,connection,b),keys.privateKey).toString('base64url')};
}
async function register(b=enrollment()){
 const r=await request('POST','/v1/hook-pairings',b,{authorization:'Bearer '+credential});assert.equal(r.status,200);return r.body;
}
function signed(id:string,path='/v1/wake-signed',overrides:any={}){
 const b={pairing_id:id,key_generation:1,timestamp:now(),nonce:randomBytes(32).toString('base64url'),...overrides};
 return {'deepend-pairing-id':b.pairing_id,'deepend-key-generation':String(b.key_generation),'deepend-timestamp':String(b.timestamp),'deepend-nonce':b.nonce,'deepend-signature':sign(null,requestBytes(origin,path,connection,b),keys.privateKey).toString('base64url')};
}
before(async()=>{
 await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
 for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 await db.query('select public.deepend_login($1,$2,$3)',[owner,'owner@example.test',hash('owner')]);
 await db.query('select public.deepend_login($1,$2,$3)',[outsider,'other@example.test',hash('other')]);
});
beforeEach(async()=>{
 await db.exec('delete from deepend.rates; update deepend.human_sessions set verified_at=now();');
 room=(await human('room.create',{title:'Pairing test'})).room_id;
 // Each test uses the same token, but only the current connection has it.
 await db.query('delete from deepend.credentials where hash=$1',[hash(credential)]);
 connection=(await human('connection.create',{room_id:room,name:'Muse',platform:'muse',kind:'bearer',token_hash:hash(credential)})).connection_id;
});
after(()=>db.close());
test('signed enrollment, human saved approval, wake and replay rejection work end to end',async()=>{
 const p=await register();assert.equal(p.fingerprint,fingerprint(publicKey).display);assert.match(p.approval_url,/https:\/\/human.test\/hook-pairings\//);
 assert.equal((await request('GET','/v1/wake-signed',{},signed(p.pairing_id))).status,401);
 const preview=await request('GET','/hook-pairings/'+p.pairing_id,{}, {cookie:'__Host-deepend-human=owner'},'human');
 assert.match(preview.body,new RegExp(fingerprint(publicKey).display));assert.match(preview.body,/90 days/);
 const headers={origin:humanOrigin,cookie:'__Host-deepend-human=owner'};
 const draft=await request('POST','/draft',{op:'hook.approve',room_id:room,pairing_id:p.pairing_id,public_key:publicKey,request_id:randomUUID()},headers,'human');
 assert.equal(draft.status,303);
 const id=draft.url.split('/draft/')[1].split('?')[0];
 const executed=await request('POST','/execute',{id,room_id:room},headers,'human');assert.equal(executed.status,303,executed.body);
 const envelope=signed(p.pairing_id);
 const responses=await Promise.all([request('GET','/v1/wake-signed',{},envelope),request('GET','/v1/wake-signed',{},envelope)]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.deepEqual(responses.find(r=>r.status===200)?.body,{pending:false});
 assert.equal((await request('GET','/v1/state',{},signed(p.pairing_id))).status,401);
});
test('owner binding, fresh verification, public-key binding and revocation are enforced',async()=>{
 const p=await register(),b={room_id:room,pairing_id:p.pairing_id,public_key:publicKey};
 assert.equal((await request('GET','/hook-pairings/'+p.pairing_id,{}, {cookie:'__Host-deepend-human=other'},'human')).status,404);
 assert.equal((await human('hook.approve',b,'other')).error,'forbidden');
 assert.equal((await human('hook.approve',{...b,public_key:'wrong'})).error,'request_conflict');
 await db.exec("update deepend.human_sessions set verified_at=now()-interval '16 minutes'");
 assert.equal((await human('hook.approve',b)).error,'reauthenticate');
 await db.exec('update deepend.human_sessions set verified_at=now()');
 assert.equal((await human('hook.approve',b)).ok,true);
 assert.equal((await human('hook.revoke',b)).ok,true);
 assert.equal((await human('hook.renew',b)).error,'invalid_state');
 assert.equal((await request('GET','/v1/wake-signed',{},signed(p.pairing_id))).status,401);
});
test('invalid signatures and changed request fields cannot enroll or check pending',async()=>{
 const b=enrollment();b.label='Changed label';
 assert.equal((await request('POST','/v1/hook-pairings',b,{authorization:'Bearer '+credential})).status,401);
 const p=await register();await human('hook.approve',{room_id:room,pairing_id:p.pairing_id,public_key:publicKey});
 assert.equal((await request('GET','/v1/wake-signed',{},signed(p.pairing_id,'/v1/hook-pairings/status'))).status,401);
 assert.equal((await request('GET','/v1/wake-signed?extra=1',{},signed(p.pairing_id))).status,409);
 assert.equal((await request('GET','/v1/wake-signed',{},signed(p.pairing_id,undefined,{timestamp:now()-120}))).status,409);
 const h=signed(p.pairing_id);
 assert.equal((await request('GET','/v1/wake-signed',{},h,'agent',['Deepend-Nonce',h['deepend-nonce'],'Deepend-Nonce',h['deepend-nonce']])).status,409);
 assert.equal((await request('GET','/v1/wake-signed',{}, {...h,authorization:'Bearer '+credential})).status,409);
});
test('registration retries, expiry, replacement and main-credential rotation are safe',async()=>{
 const first=enrollment(),p=await register(first);
 assert.equal((await register(enrollment({request_id:first.request_id}))).pairing_id,p.pairing_id);
 assert.equal((await request('POST','/v1/hook-pairings',enrollment({request_id:first.request_id,label:'Different'}),{authorization:'Bearer '+credential})).status,409);
 await db.query("update deepend.hook_pairings set enrollment_expires_at=now()-interval '1 second' where id=$1",[p.pairing_id]);
 const b={room_id:room,pairing_id:p.pairing_id,public_key:publicKey};
 assert.equal((await human('hook.approve',b)).error,'invalid_state');
 assert.equal((await request('GET','/v1/hook-pairings/status',{},signed(p.pairing_id,'/v1/hook-pairings/status'))).body.state,'expired');
 const p2=await register();await human('hook.approve',{...b,pairing_id:p2.pairing_id});
 const p3=await register();await human('hook.approve',{...b,pairing_id:p3.pairing_id});
 assert.equal((await request('GET','/v1/wake-signed',{},signed(p2.pairing_id))).status,401);
 await human('connection.rotate',{room_id:room,connection_id:connection,kind:'bearer',token_hash:'new-hash'});
 assert.equal((await request('GET','/v1/wake-signed',{},signed(p3.pairing_id))).status,401);
});
test('fingerprints are stable; cryptographic signatures bind every canonical byte',()=>{
 assert.equal(fingerprint('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA').display,'DFE4-1CA8-194C-67B4-44F9-29DF-5F3C-E915');
 const bytes=Buffer.from('test'),signature=sign(null,bytes,keys.privateKey).toString('base64url');
 verifyProof(publicKey,bytes,signature);
 assert.throws(()=>verifyProof(publicKey,Buffer.from('tesT'),signature));
 assert.throws(()=>fingerprint(publicKey+'='));
});
test('public database roles cannot call hook RPCs or read pairings',async()=>{
 await db.exec('set role anon');
 await assert.rejects(db.query('select * from deepend.hook_pairings'));
 await assert.rejects(db.query("select public.deepend_hook('lookup','','{}','test')"));
 await db.exec('reset role');
});
