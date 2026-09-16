export function sha256(value:string|Buffer):string;
export function canonicalBytes(value:unknown,size:number):Buffer;
export function fingerprint(publicKey:string):{full:string;display:string};
export function registrationBytes(origin:string,connectionId:string,b:{request_id:string;public_key:string;label:string;timestamp:number;nonce:string}):Buffer;
export function requestBytes(origin:string,path:string,connectionId:string,b:{pairing_id:string;key_generation:number;timestamp:number;nonce:string}):Buffer;
export function verifyProof(publicKey:string,bytes:Buffer,signature:string):void;
