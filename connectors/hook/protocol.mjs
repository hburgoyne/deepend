import {createHash, createPublicKey, verify} from 'node:crypto';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function canonicalBytes(value, size) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid_input');
  const bytes=Buffer.from(value,'base64url');
  if(bytes.length!==size || bytes.toString('base64url')!==value)throw new Error('invalid_input');
  return bytes;
}
export function fingerprint(publicKey) {
  const raw=canonicalBytes(publicKey,32);
  const full=createHash('sha256').update('Deepend hook key v1\n').update(raw).digest('hex').toUpperCase();
  return {full,display:full.slice(0,32).match(/.{4}/g).join('-')};
}
export function registrationBytes(origin,connectionId,b) {
  return Buffer.from(['DEEPEND-HOOK-REGISTER-V1',origin,connectionId,b.request_id,b.public_key,sha256(b.label),String(b.timestamp),b.nonce].join('\n'));
}
export function requestBytes(origin,path,connectionId,b) {
  return Buffer.from(['DEEPEND-HOOK-REQUEST-V1','GET',path,origin,b.pairing_id,connectionId,String(b.key_generation),String(b.timestamp),b.nonce,sha256('')].join('\n'));
}
export function verifyProof(publicKey,bytes,signature) {
  const raw=canonicalBytes(publicKey,32),sig=canonicalBytes(signature,64);
  const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),raw]),format:'der',type:'spki'});
  if(!verify(null,bytes,key,sig))throw new Error('unauthorized');
}
