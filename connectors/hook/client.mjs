#!/usr/bin/env node
// Dependency-free Node 24+ helper. Private bytes never leave this process.
import {generateKeyPairSync,createPrivateKey,sign,randomBytes,randomUUID} from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import {fileURLToPath} from 'node:url';
import {fingerprint,registrationBytes,requestBytes} from './protocol.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail=code=>{throw new Error(code);};
export function checkedOrigin(value){const u=new URL(value);if(u.protocol!=='https:'||u.origin!==value||u.username||u.password)fail('invalid_origin');return value;}
function directory(dir){const s=fs.lstatSync(dir);if(s.isSymbolicLink()||!s.isDirectory()||s.uid!==process.getuid()||(s.mode&0o077))fail('unsafe_directory');return path.resolve(dir);}
function readSecure(file){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==process.getuid()||(s.mode&0o077)||s.size>16384)fail('unsafe_file');return fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}
}
function writeNew(file,value){fs.writeFileSync(file,value,{mode:0o600,flag:'wx'});}
function save(dir,name,data){const tmp=path.join(dir,'.'+randomUUID());writeNew(tmp,JSON.stringify(data));fs.renameSync(tmp,path.join(dir,name));}
function config(dir){const c=JSON.parse(readSecure(path.join(directory(dir),'config.json')));checkedOrigin(c.origin);if(!uuid.test(c.connection_id))fail('invalid_configuration');return c;}
function privateKey(dir){return createPrivateKey(readSecure(path.join(directory(dir),'private.pem')));}
export function initialize(dir,origin,connectionId,label){
 checkedOrigin(origin);if(!uuid.test(connectionId)||typeof label!=='string'||label.length<1||label.length>80||/[\x00-\x1f\x7f]/.test(label))fail('invalid_configuration');
 fs.mkdirSync(dir,{mode:0o700});directory(dir);
 const pair=generateKeyPairSync('ed25519');
 writeNew(path.join(dir,'private.pem'),pair.privateKey.export({format:'pem',type:'pkcs8'}));
 const c={origin,connection_id:connectionId,label,request_id:randomUUID(),public_key:pair.publicKey.export({format:'jwk'}).x};
 writeNew(path.join(dir,'config.json'),JSON.stringify(c));
 return {fingerprint:fingerprint(c.public_key).display,public_key:c.public_key};
}
export function registration(dir){const c=config(dir);const b={request_id:c.request_id,public_key:c.public_key,label:c.label,timestamp:Math.floor(Date.now()/1000),nonce:randomBytes(32).toString('base64url')};return {...b,signature:sign(null,registrationBytes(c.origin,c.connection_id,b),privateKey(dir)).toString('base64url')};}
export function bind(dir,response){
 const c=config(dir);if(!uuid.test(response.pairing_id)||response.connection_id!==c.connection_id||response.key_generation!==1||response.fingerprint!==fingerprint(c.public_key).display)fail('pairing_mismatch');
 save(dir,'config.json',{...c,pairing_id:response.pairing_id,key_generation:1});return {paired_request_saved:true,fingerprint:response.fingerprint};
}
export function envelope(dir,requestPath){
 const c=config(dir);if(!uuid.test(c.pairing_id))fail('pairing_required');
 if(!['/v1/wake-signed','/v1/hook-pairings/status'].includes(requestPath))fail('invalid_path');
 const b={pairing_id:c.pairing_id,key_generation:c.key_generation,timestamp:Math.floor(Date.now()/1000),nonce:randomBytes(32).toString('base64url')};
 return {origin:c.origin,headers:{'Deepend-Pairing-Id':b.pairing_id,'Deepend-Key-Generation':String(b.key_generation),'Deepend-Timestamp':String(b.timestamp),'Deepend-Nonce':b.nonce,'Deepend-Signature':sign(null,requestBytes(c.origin,requestPath,c.connection_id,b),privateKey(dir)).toString('base64url')}};
}
export function request(origin,requestPath,headers){
 checkedOrigin(origin);
 return new Promise((resolve,reject)=>{
  const req=https.request(origin+requestPath,{method:'GET',headers},res=>{
   let size=0;const parts=[];
   res.on('data',chunk=>{size+=chunk.length;if(size>1024){res.destroy();reject(new Error('invalid_response'));}else parts.push(chunk);});
   res.on('error',()=>reject(new Error('transport_failure')));
   res.on('end',()=>{
    if(res.statusCode!==200){resolve({error:'http_'+res.statusCode,retry_after:res.headers['retry-after']});return;}
    try{resolve({data:JSON.parse(Buffer.concat(parts).toString('utf8'))});}catch{reject(new Error('invalid_response'));}
   });
  });
  const timer=setTimeout(()=>req.destroy(new Error('timeout')),10000);
  req.on('close',()=>clearTimeout(timer));req.on('error',()=>reject(new Error('transport_failure')));req.end();
 });
}
async function signedRequest(dir,requestPath,transport=request){const e=envelope(dir,requestPath);return transport(e.origin,requestPath,e.headers);}
function loadState(dir){try{return JSON.parse(readSecure(path.join(dir,'state.json')));}catch(e){if(e.code==='ENOENT')return {};throw e;}}
async function locked(dir,fn){
 directory(dir);const lock=path.join(dir,'lock');
 try{fs.mkdirSync(lock,{mode:0o700});}catch(e){if(e.code==='EEXIST')return {decision:'silent',health:'locked'};throw e;}
 // Never guess a crashed lock is safe to steal. An operator must check the recorded PID before removing a crashed lock.
 try{writeNew(path.join(lock,'pid'),String(process.pid));return await fn();}finally{fs.rmSync(lock,{recursive:true});}
}
function notice(state,reason,now){
 const day=new Date(now*1000).toISOString().slice(0,10);
 if(state.notice_day!==day){state.notice_day=day;state.notice_count=0;}
 if(!state.notified&&(state.notice_count??0)<3){state.notified=true;state.notice_count=(state.notice_count??0)+1;return {decision:'diagnostic',reason};}
 return {decision:'silent',health:reason};
}
export async function poll(dir,transport=request,now=Math.floor(Date.now()/1000)){
 return locked(dir,async()=>{
  const s=loadState(dir);const done=result=>{save(dir,'state.json',s);return result;};
  if(s.disabled)return done(notice(s,s.health??'needs_repair',now));
  if(s.run){
   if(s.run.expires_at>now)return {decision:'silent',health:s.run.phase};
   s.disabled=true;s.health='worker_reconciliation_required';return done(notice(s,s.health,now));
  }
  if((s.next_check_at??0)>now)return {decision:'silent',health:'backing_off'};
  let response;try{response=await signedRequest(dir,'/v1/wake-signed',transport);}catch(e){response={error:['pairing_required','unsafe_file','unsafe_directory','invalid_configuration','invalid_origin'].includes(e.message)?e.message:'transport_failure'};}
  if(response.data&&Object.keys(response.data).length===1&&typeof response.data.pending==='boolean'){
   Object.assign(s,{errors:0,notified:false,health:'healthy',last_success:now,next_check_at:now+20});
   if(!response.data.pending)return done({decision:'silent',health:'idle'});
   const id=randomUUID();s.run={id,phase:'queued',expires_at:now+120};return done({decision:'wake',run_id:id});
  }
  const error=response.error??'invalid_response';
  if(['http_401','http_403','pairing_required','unsafe_file','unsafe_directory','invalid_configuration','invalid_origin'].includes(error)||/^http_3/.test(error)){
   s.disabled=true;s.health=error;return done(notice(s,error,now));
  }
  s.errors=(s.errors??0)+1;s.health=error;
  let delay=Math.min(300,20*2**Math.min(s.errors-1,4));
  if(error==='http_429'){
   const raw=String(response.retry_after??'');
   delay=/^\d+$/.test(raw)?Number(raw):Math.ceil((Date.parse(raw)-now*1000)/1000);
   if(!Number.isFinite(delay))delay=60;delay=Math.min(86400,Math.max(20,delay));
  }
  s.next_check_at=now+delay+Math.floor(Math.random()*5);
  return done(s.errors>=5?notice(s,error,now):{decision:'silent',health:error});
 });
}
export async function workerState(dir,action,id,now=Math.floor(Date.now()/1000)){
 return locked(dir,async()=>{
  const s=loadState(dir);if(!s.run||s.run.id!==id)fail('stale_run');
  if(action==='done'){delete s.run;}else{
   if(s.disabled||s.run.expires_at<=now)fail('stale_run');
   s.run.phase='running';s.run.expires_at=now+300;
  }
  save(dir,'state.json',s);return {ok:true};
 });
}
export async function repair(dir,transport=request){
 return locked(dir,async()=>{
  const s=loadState(dir);if(s.run)fail('worker_reconciliation_required');
  const r=await signedRequest(dir,'/v1/hook-pairings/status',transport);
  if(r.data?.state!=='approved')fail('pairing_not_approved');
  save(dir,'state.json',{...s,disabled:false,notified:false,errors:0,next_check_at:0,health:'healthy'});return {ok:true};
 });
}
export async function main(args){
 const [command,dir,...rest]=args;if(!dir)fail('usage');
 if(command==='init')return initialize(dir,...rest);
 if(command==='register-proof')return registration(dir);
 if(command==='bind')return bind(dir,JSON.parse(fs.readFileSync(0,'utf8')));
 if(command==='status')return signedRequest(dir,'/v1/hook-pairings/status');
 if(command==='poll')return poll(dir);
 if(command==='worker-start'||command==='worker-heartbeat'||command==='worker-done')return workerState(dir,command==='worker-done'?'done':'active',rest[0]);
 if(command==='repair')return repair(dir);
 if(command==='health')return loadState(directory(dir));
 fail('usage');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result))).catch(()=>{console.log(JSON.stringify({error:'hook_helper_failed',action:'inspect_configuration_or_reconcile_worker'}));process.exitCode=2;});
}
