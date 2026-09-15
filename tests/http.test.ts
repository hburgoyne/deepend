import {test} from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {createMocks} from 'node-mocks-http';
import {createApp,hash,type Config} from '../src/app.js';import {validate} from '../src/contracts.js';
const config:Config={surface:'agent',humanOrigin:'https://human.example.test',agentOrigin:'https://agent.example.test',supabaseUrl:'https://supabase.example.test',publicKey:'public',serviceKey:'secret-service-key',secret:'x'.repeat(48),allowedEmails:[]};
async function request(surface:'human'|'agent',method:string,url:string,headers:any={},body:any={},data:any={ok:true}){
 const calls:any[]=[];const app=createApp({...config,surface},{rpc:async(name,args)=>{calls.push({name,args});return {data,error:null};},auth:{}});
 const {req,res}=createMocks({method:method as any,url,headers:{host:surface+'.example.test',...headers},body},{eventEmitter:EventEmitter});
 await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('request timeout')),2000);res.on('end',()=>{clearTimeout(timer);resolve();});app(req as any,res as any);});
 return {status:res.statusCode,body:res._getData(),headers:res._getHeaders(),calls};
}
test('separate origins reject wrong host, human credential fallback and cross-origin writes',async()=>{
 assert.equal((await request('agent','GET','/',{host:'human.example.test'})).status,421);
 assert.equal((await request('agent','GET','/v1/state',{cookie:'__Host-deepend-human=owner'})).status,401);
 assert.equal((await request('agent','POST','/draft',{origin:'https://attacker.test'},{op:'message',body:'x'})).status,403);
 assert.equal((await request('human','GET','/v1/state',{authorization:'Bearer '+'a'.repeat(43)})).status,404);
});
test('scoped API hashes credentials, ignores sender fields and validates stable request IDs',async()=>{
 const authorization='Bearer '+'a'.repeat(43),id='11111111-1111-4111-8111-111111111111';
 const r=await request('agent','POST','/v1/message',{authorization,'idempotency-key':id},{body:'Hello',from_member:'imposter'});
 assert.equal(r.status,200);assert.equal(r.calls[0].args.p_hash,hash('a'.repeat(43)));assert.deepEqual(r.calls[0].args.p_body,{body:'Hello',recipients:[]});
 assert.equal((await request('agent','POST','/v1/message',{authorization},{body:'Hello'})).status,409);
 assert.throws(()=>validate('task.update',{task_id:id,state:'done'}));
});
test('public surface is only login; authenticated data is no-store and inert',async()=>{
 const r=await request('human','GET','/');assert.equal(r.status,200);assert.match(String(r.headers['cache-control']),/no-store/);assert.match(String(r.headers['content-security-policy']),/default-src 'none'/);
 // no-referrer makes browsers send Origin: null on same-origin form posts, which the origin check rejects.
 assert.equal(r.headers['referrer-policy'],'same-origin');assert.equal(r.calls.length,0);
 const x=await request('human','GET','/',{cookie:'__Host-deepend-human=owner'}, {},{email:'<script>alert(1)</script>',rooms:[]});
 assert.match(x.body,/&lt;script&gt;/);assert.doesNotMatch(x.body,/<script>/);
 assert.doesNotMatch(x.body,/secret-service-key/);
});
test('agent activation stores only a scoped host cookie; no session secret returned',async()=>{
 const r=await request('agent','POST','/activate',{origin:config.agentOrigin},{token:'a'.repeat(43)},{connection_id:'c'});
 assert.equal(r.status,303);const cookie=String(r.headers['set-cookie']);
 assert.match(cookie,/__Host-deepend-agent=/);assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Strict/);assert.doesNotMatch(cookie,/Domain=/);
 assert.equal(r.calls[0].args.p_hash,hash('a'.repeat(43)));assert.notEqual(r.calls[0].args.p_body.session_hash,'a'.repeat(43));
});
test('database throttling returns standard retry header',async()=>{
 const r=await request('agent','GET','/v1/state',{authorization:'Bearer '+'a'.repeat(43)},{},{error:'rate_limited'});
 assert.equal(r.status,429);assert.equal(r.headers['retry-after'],'60');
});
