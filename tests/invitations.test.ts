import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {createMocks} from 'node-mocks-http';
import {PGlite} from '@electric-sql/pglite';
import {createApp,hash,type Config} from '../src/app.js';
const db=new PGlite(),owner=randomUUID(),guest=randomUUID(),wrong=randomUUID();
const config:Config={surface:'human',humanOrigin:'https://human.test',agentOrigin:'https://agent.test',supabaseUrl:'https://db.test',publicKey:'public',serviceKey:'service',secret:'x'.repeat(48),allowedEmails:['owner@example.test']};
let room:string,sends:any[],failMail=false;
async function rpc(name:string,args:any){const es=Object.entries(args);return {data:(await db.query<{v:any}>(`select public.${name}(${es.map(([k],i)=>`${k}=>$${i+1}`).join(',')}) v`,es.map(([,v])=>v!==null&&typeof v==='object'?JSON.stringify(v):v))).rows[0].v,error:null};}
async function human(op:string,body:any={},who='owner'){return (await rpc('deepend_call',{p_kind:'human',p_hash:hash(who),p_op:op,p_body:body,p_request:randomUUID(),p_ip:'test'})).data;}
async function invite(action:string,body:any,who='owner'){return (await rpc('deepend_invitation',{p_action:action,p_hash:hash(who),p_body:body,p_ip:'test'})).data;}
const secret=(id:string)=>createHmac('sha256',config.secret).update('room-invite:'+id).digest('base64url');
const cookies=(who?:string,token?:string)=>[who?'__Host-deepend-human='+who:'',token?'__Host-deepend-invitation='+token:''].filter(Boolean).join('; ');
async function request(method:string,url:string,body:any={},cookie='',origin=config.humanOrigin){
 const auth={signInWithOtp:async(b:any)=>{sends.push(b);return {error:failMail?{code:'failed'}:null};},verifyOtp:async(b:any)=>b.token==='123456'?{data:{user:{id:guest,email:'guest@example.test'},session:{}},error:null}:{data:{},error:{code:'expired'}}};
 const app=createApp(config,{rpc,auth});const {req,res}=createMocks({method:method as any,url,body,headers:{host:'human.test',origin,cookie}},{eventEmitter:EventEmitter});
 await new Promise<void>((resolve,reject)=>{const t=setTimeout(()=>reject(Error('timeout')),5000);res.on('end',()=>{clearTimeout(t);resolve();});app(req as any,res as any);});
 return {status:res.statusCode,body:res._getData(),url:res._getRedirectUrl(),cookie:res._getHeaders()['set-cookie']};
}
before(async()=>{await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));for(const [id,name] of [[owner,'owner'],[guest,'guest'],[wrong,'wrong']])await db.query('select public.deepend_login($1,$2,$3)',[id,name+'@example.test',hash(name)]);});
beforeEach(async()=>{await db.query('delete from deepend.members where human_id=$1',[guest]);await db.exec("delete from deepend.rates;update deepend.human_sessions set verified_at=now()-interval '1 hour'");room=(await human('room.create',{title:'Invite room'})).room_id;sends=[];failMail=false;});
after(()=>db.close());
async function create(fresh=false){const id=randomUUID();const r=await request('POST','/invitations/create',{id,room_id:room,email:'guest@example.test',fresh_room:String(fresh)},cookies('owner'));assert.equal(r.status,303,r.body);return {id,token:secret(id),hash:hash(secret(id))};}
test('invitation email, sign-in continuation, matching-email confirmation and first-agent setup',async()=>{
 const p=await create();assert.equal(sends.length,1);assert.equal(sends[0].options.emailRedirectTo,config.humanOrigin+'/join#'+p.token);
 const list=await request('GET','/room/'+room,{},cookies('owner'));assert.equal(list.status,200,list.body);assert.match(list.body,/Copy link/);assert.ok(list.body.includes('/join#'+p.token));
 const open=await request('POST','/join/open',{token:p.token});assert.equal(open.url,'/join/confirm');assert.match(String(open.cookie),/HttpOnly/);
 const pending=cookies(undefined,p.token);const screen=await request('GET','/join/confirm',{},pending);assert.match(screen.body,/Use the code in the invitation email/);
 const login=await request('POST','/auth/verify',{email:'guest@example.test',code:'123456'},pending);assert.equal(login.url,'/join/confirm');assert.ok(login.cookie);
 const session=String(login.cookie).split(';')[0]+'; __Host-deepend-invitation='+p.token;
 const confirmation=await request('GET','/join/confirm',{},session);assert.match(confirmation.body,/Join Invite room/);
 const accepted=await request('POST','/join/accept',{token_hash:p.hash},session);assert.equal(accepted.url,'/room/'+room+'/connect');
 assert.equal((await request('POST','/join/accept',{token_hash:p.hash},session)).url,accepted.url);
 const choose=await request('GET',accepted.url,{},session);assert.match(choose.body,/Use this agent to send and receive/);
 const connection=await request('POST','/draft',{op:'connection.create',request_id:randomUUID(),room_id:room,platform:'muse',kind:'bearer',name:'Muse',use_as_contact:'true'},session);
 assert.equal(connection.status,200,connection.body);assert.ok(connection.body.indexOf('1. Give your agent')<connection.body.indexOf('2. When your agent asks'));
 const state=await human('state',{room_id:room},'guest');assert.equal(state.contact_id,state.connections.find((x:any)=>x.human_id===guest).id);
 assert.equal((await invite('eligible',{email:'guest@example.test',token_hash:''})).eligible,true);
});
test('forwarded links cannot authorize another email; outsiders and cross-origin requests cannot invite',async()=>{
 const p=await create();assert.equal((await invite('accept',{token_hash:p.hash},'wrong')).error,'invitation_email_mismatch');
 assert.equal((await invite('eligible',{email:'wrong@example.test',token_hash:p.hash})).eligible,false);
 assert.match((await request('GET','/join/confirm',{},cookies('wrong',p.token))).body,/Use your invited email/);
 assert.equal((await request('POST','/invitations/create',{id:randomUUID(),room_id:room,email:'x@example.test'},cookies('wrong'))).status,403);
 assert.equal((await request('POST','/join/accept',{token_hash:p.hash},cookies('guest',p.token),'https://evil.test')).status,403);
 assert.equal((await request('POST','/auth/send',{email:'nobody@example.test'})).status,409);
});
test('fresh room and repeated submissions preserve original history and create only one room/email',async()=>{
 const id=randomUUID(),b={id,room_id:room,email:'guest@example.test',fresh_room:'true'};
 const count=async()=>Number((await db.query<{n:number}>('select count(*) n from deepend.rooms')).rows[0].n),before=await count();
 await request('POST','/invitations/create',b,cookies('owner'));await request('POST','/invitations/create',b,cookies('owner'));
 assert.equal(await count(),before+1);assert.equal(sends.length,1);
 const inv=(await invite('list',{room_id:room})).invitations[0];assert.notEqual(inv.room_id,room);
 const state=await human('state',{room_id:inv.room_id});assert.equal(state.room.seq,0);assert.equal(state.connections.length,0);assert.equal(state.members.length,1);
 assert.equal((await invite('create',{...b,email:'changed@example.test',token_hash:hash(secret(id))})).error,'request_conflict');
});
test('revocation, expiry, failed email and retry status are explicit',async()=>{
 failMail=true;const p=await create();let list=await invite('list',{room_id:room});assert.equal(list.invitations[0].email_state,'failed');
 await db.query("update deepend.room_invitations set email_attempt_at=now()-interval '2 minutes' where id=$1",[p.id]);
 failMail=false;await request('POST','/invitations/send',{id:p.id,room_id:room,attempt:randomUUID()},cookies('owner'));
 list=await invite('list',{room_id:room});assert.equal(list.invitations[0].email_state,'sent');
 await invite('revoke',{id:p.id});assert.equal((await invite('accept',{token_hash:p.hash},'guest')).error,'invalid_invitation');
 assert.equal((await invite('eligible',{email:'guest@example.test',token_hash:p.hash})).eligible,false);
 const other=await create();await db.query("update deepend.room_invitations set expires_at=now()-interval '1 second' where id=$1",[other.id]);
 assert.equal((await invite('context',{token_hash:other.hash})).error,'invalid_invitation');
});
test('public roles cannot access invitation data or invoke privileged RPC',async()=>{
 await db.exec('set role anon');try{await assert.rejects(db.exec('select * from deepend.room_invitations'));await assert.rejects(db.exec("select public.deepend_invitation('list','','{}','test')"));}finally{await db.exec('reset role');}
});
