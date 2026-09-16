import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,statSync,readFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
// Standalone helper intentionally needs no npm dependencies.
// @ts-ignore JavaScript helper exercised directly.
import {initialize,registration,bind,envelope,poll,workerState,repair} from '../connectors/hook/client.mjs';
import {verifyProof,registrationBytes,requestBytes} from '../connectors/hook/protocol.mjs';
function fixture(){const parent=mkdtempSync(join(tmpdir(),'deepend-hook-')),dir=join(parent,'key');const connection=randomUUID(),origin='https://example.com';const key=initialize(dir,origin,connection,'Test hook');bind(dir,{pairing_id:randomUUID(),connection_id:connection,key_generation:1,fingerprint:key.fingerprint});return {dir,connection,origin,key,cleanup:()=>rmSync(parent,{recursive:true,force:true})};}
test('helper protects key files and generates verifiable public proofs',()=>{const f=fixture();try{
 assert.equal(statSync(f.dir).mode&0o777,0o700);assert.equal(statSync(join(f.dir,'private.pem')).mode&0o777,0o600);
 const b=registration(f.dir);verifyProof(f.key.public_key,registrationBytes(f.origin,f.connection,b),b.signature);
 const e=envelope(f.dir,'/v1/wake-signed'),h=e.headers;
 verifyProof(f.key.public_key,requestBytes(f.origin,'/v1/wake-signed',f.connection,{pairing_id:h['Deepend-Pairing-Id'],key_generation:Number(h['Deepend-Key-Generation']),timestamp:Number(h['Deepend-Timestamp']),nonce:h['Deepend-Nonce']}),h['Deepend-Signature']);
 assert.ok(!JSON.stringify([b,e]).includes('PRIVATE KEY'));
 chmodSync(join(f.dir,'private.pem'),0o644);assert.throws(()=>registration(f.dir),/unsafe_file/);
 }finally{f.cleanup();}});
test('idle hook avoids workers, coalesces parallel wakes and requires reconciliation after a lost worker',async()=>{const f=fixture();try{
 assert.equal((await poll(f.dir,async()=>({data:{pending:false}}),100)).health,'idle');
 const results=await Promise.all([poll(f.dir,async()=>({data:{pending:true}}),121),poll(f.dir,async()=>({data:{pending:true}}),121)]);
 assert.equal(results.filter((r:any)=>r.decision==='wake').length,1);const id=results.find((r:any)=>r.decision==='wake').run_id;
 await workerState(f.dir,'active',id,122);assert.equal((await poll(f.dir,async()=>assert.fail('must not poll while running'),123)).health,'running');
 assert.equal((await poll(f.dir,async()=>assert.fail(),423)).decision,'diagnostic');
 assert.equal((await poll(f.dir,async()=>assert.fail(),424)).decision,'silent');
 await assert.rejects(repair(f.dir,async()=>({data:{state:'approved'}})),/reconciliation/);
 await workerState(f.dir,'done',id,425);await repair(f.dir,async()=>({data:{state:'approved'}}));
 assert.equal((await poll(f.dir,async()=>({data:{pending:false}}),426)).health,'idle');
 }finally{f.cleanup();}});
test('hook backs off rate limits and emits one diagnostic on revoked access',async()=>{const f=fixture();try{
 await poll(f.dir,async()=>({error:'http_429',retry_after:'120'}),100);
 assert.equal((await poll(f.dir,async()=>assert.fail('backoff must skip HTTP'),110)).health,'backing_off');
 assert.ok(JSON.parse(readFileSync(join(f.dir,'state.json'),'utf8')).next_check_at>=220);
 assert.equal((await poll(f.dir,async()=>({error:'http_401'}),230)).decision,'diagnostic');
 assert.equal((await poll(f.dir,async()=>assert.fail('disabled must skip HTTP'),260)).decision,'silent');
 }finally{f.cleanup();}});
