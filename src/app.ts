import express,{type Request,type Response,type NextFunction} from 'express';
import {createClient} from '@supabase/supabase-js';
import {createHash,createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {parseCookie as parse,stringifySetCookie} from 'cookie';
import {z} from 'zod';
import {registerHook,signedHook,pairingPage,pairingList} from './hooks.js';
import {invitationForm,invitationList,joinLanding,joinConfirmation,connectPage} from './invitations.js';
import {operations,reads,validate} from './contracts.js';
import {humanAction,needsReview,setupInstructions,successNotice} from './onboarding.js';
import {esc,page,login,home,roomView,agentView,hidden,json,codeEntry,existingCode} from './views.js';
export const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
export interface Config {surface:'human'|'agent';humanOrigin:string;agentOrigin:string;supabaseUrl:string;publicKey:string;serviceKey:string;secret:string;allowedEmails:string[];cronSecret?:string}
export function configuration():Config {
 const e=process.env; const c={surface:e.DEEPEND_SURFACE as 'human'|'agent',cronSecret:e.CRON_SECRET,humanOrigin:e.DEEPEND_HUMAN_ORIGIN!,agentOrigin:e.DEEPEND_AGENT_ORIGIN!,supabaseUrl:e.SUPABASE_URL!,publicKey:e.SUPABASE_PUBLISHABLE_KEY!,serviceKey:e.SUPABASE_SERVICE_ROLE_KEY!,secret:e.DEEPEND_APP_SECRET!,allowedEmails:(e.DEEPEND_ALLOWED_EMAILS??'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean)};
 if(!['human','agent'].includes(c.surface)||c.secret?.length<43||!c.secret||!c.publicKey||!c.serviceKey) throw new Error('configuration_required');
 for(const s of [c.humanOrigin,c.agentOrigin,c.supabaseUrl]){const u=new URL(s);if(u.protocol!=='https:'||u.origin!==s)throw new Error('invalid_origin');}
 if(c.humanOrigin===c.agentOrigin)throw new Error('separate_origins_required');return c;
}
export function createApp(c:Config, injected?:{rpc:(name:string,args:any)=>Promise<any>;auth:any}){
 const app=express(), isAgent=c.surface==='agent', origin=isAgent?c.agentOrigin:c.humanOrigin;
 const db=injected??createClient(c.supabaseUrl,c.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const auth=injected?.auth??createClient(c.supabaseUrl,c.publicKey,{auth:{persistSession:false,autoRefreshToken:false}}).auth;
 const cookieName=isAgent?'__Host-deepend-agent':'__Host-deepend-human';
 const ip=(req:Request)=>createHmac('sha256',c.secret).update(req.headers['x-vercel-forwarded-for']?.toString().split(',')[0]??req.socket.remoteAddress??'unknown').digest('hex');
 const setCookie=(res:Response,v:string,age:number)=>res.setHeader('Set-Cookie',stringifySetCookie({name:cookieName,value:v,httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:age}));
 const identity=(req:Request)=>{
  const bearer=req.get('authorization');
  if(bearer){if(!isAgent||!/^Bearer [A-Za-z0-9_-]{43}$/.test(bearer))throw new Error('unauthorized');return bearer.slice(7);}
  const value=parse(req.headers.cookie??'')[cookieName];if(!value)throw new Error('unauthorized');return value;
 };
 const call=async(req:Request,op:string,body:any={},request:string|null=null,kind?:string,raw?:string)=>{
  const result=await db.rpc('deepend_call',{p_kind:kind??c.surface,p_hash:hash(raw??identity(req)),p_op:op,p_body:body,p_request:request,p_ip:ip(req)});
  if(result.error)throw new Error('database_rejected');
  if(result.data?.error)throw new Error(result.data.error);return result.data;
 };
 const hookCall=(req:Request)=>(async(action:string,body:any,credential=false)=>{
  const result=await db.rpc('deepend_hook',{p_action:action,p_hash:credential?hash(identity(req)):'',p_body:body,p_ip:ip(req)});
  if(result.error)throw new Error('database_rejected');
  if(result.data?.error)throw new Error(result.data.error);return result.data;
 });
 const inviteCookie='__Host-deepend-invitation';
 const pendingToken=(req:Request)=>{const v=parse(req.headers.cookie??'')[inviteCookie];return v&&/^[A-Za-z0-9_-]{43}$/.test(v)?v:undefined;};
 const inviteSecret=(id:string)=>createHmac('sha256',c.secret).update('room-invite:'+id).digest('base64url');
 const inviteLink=(id:string)=>c.humanOrigin+'/join#'+inviteSecret(id);
 const invitation=async(req:Request,action:string,body:any={},authenticated=true)=>{
  const r=await db.rpc('deepend_invitation',{p_action:action,p_hash:authenticated?hash(identity(req)):'',p_body:body,p_ip:ip(req)});
  if(r.error)throw new Error('database_rejected');if(r.data?.error)throw new Error(r.data.error);return r.data;
 };
 const eligible=async(req:Request,email:string)=>!c.allowedEmails.length||c.allowedEmails.includes(email)||(await invitation(req,'eligible',{email,token_hash:pendingToken(req)?hash(pendingToken(req)!):''},false)).eligible;
 const authDestination=(req:Request)=>pendingToken(req)?'/join/confirm':'/';
 const mailInvitation=async(req:Request,id:string,attempt:string,resend=false)=>{
  const claimed=await invitation(req,'email.claim',{id,attempt,resend:String(resend)});
  if(!claimed.send)return;
  let state='unknown';
  try{const r=await auth.signInWithOtp({email:claimed.email,options:{emailRedirectTo:inviteLink(id)}});state=r.error?'failed':'sent';}catch{}
  await invitation(req,'email.result',{id,attempt,state});
 };
 const show=(res:Response,html:string)=>{
  const style=html.match(/<style>([\s\S]*?)<\/style>/)?.[1]??'';
  const scriptHashes=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>"'sha256-"+createHash('sha256').update(m[1]).digest('base64')+"'").join(' ');
  res.setHeader('Content-Security-Policy',`default-src 'none'; ${scriptHashes?'script-src '+scriptHashes+'; ':''}style-src 'sha256-${createHash('sha256').update(style).digest('base64')}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`);
  res.type('html').send(html);
 };
 app.disable('x-powered-by');
 app.use((req,res,next)=>{
  res.set({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Strict-Transport-Security':'max-age=31536000','Permissions-Policy':'camera=(), microphone=(), geolocation=()','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"});
  if(req.get('host')!==new URL(origin).host){res.status(421).send('Unexpected host');return;}
  if(!['GET','HEAD','POST'].includes(req.method)){res.sendStatus(405);return;}
  if(req.method==='POST'){
   const b=req.get('authorization');const apiBearer=isAgent&&req.path.startsWith('/v1/')&&!!b;
   if(!apiBearer&&req.get('origin')!==origin){res.status(403).send('Invalid origin');return;}
   if(apiBearer&&req.get('origin')&&req.get('origin')!==origin){res.status(403).send('Invalid origin');return;}
  } next();
 });
 app.use(express.urlencoded({extended:false,limit:'24kb'}));app.use(express.json({limit:'24kb'}));
 app.get('/health',(_req,res)=>res.json({service:'deepend',surface:c.surface,status:'configured'}));
 app.get('/',async(req,res)=>{
  try{identity(req);}catch{return show(res,login(isAgent));}
  if(isAgent){const d=await call(req,'state');const e=await call(req,'events',{after:d.connection.cursor,limit:100});return show(res,agentView(d,e));}
  let data;try{data=await call(req,'home');}catch(e:any){if(e.message==='unauthorized')return show(res,login(false));throw e;}
  show(res,home(data,successNotice(req.query.saved)));
 });
 app.get('/internal/maintenance',async(req,res)=>{
   if(!c.cronSecret||!timingSafeEqual(Buffer.from(hash(req.get('authorization')??'')),Buffer.from(hash('Bearer '+c.cronSecret)))){res.sendStatus(401);return;}
   if(isAgent){res.json({ok:true,skipped:'agent_surface'});return;}
   const r=await db.rpc('deepend_maintenance',{});if(r.error)throw new Error('database_rejected');res.json({ok:true});
  });
 if(!isAgent){
  app.get('/join',(_req,res)=>show(res,joinLanding()));
  app.post('/join/open',async(req,res)=>{
   const value=z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(req.body.token);
   await invitation(req,'context',{token_hash:hash(value)},false);
   res.setHeader('Set-Cookie',stringifySetCookie({name:inviteCookie,value,httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:7*86400}));
   res.redirect(303,'/join/confirm');
  });
  app.get('/join/confirm',async(req,res)=>{
   const value=pendingToken(req);if(!value)throw new Error('invalid_invitation');
   const token_hash=hash(value),inv=await invitation(req,'context',{token_hash},false);
   let signed:any;try{signed=await call(req,'home');}catch(e:any){if(e.message!=='unauthorized')throw e;}
   if(!signed)return show(res,codeEntry(inv.email,false,'Sign in to review your invitation to '+inv.title+'. Use the code in the invitation email, or request a new one below.'));
   if(signed.email.toLowerCase()!==inv.email)return show(res,page('Use your invited email',`<p>This invitation is for ${esc(inv.email)}. You’re signed in as ${esc(signed.email)}.</p><form method="post" action="/logout"><button>Sign out and use the invited email</button></form>`));
   show(res,joinConfirmation({...inv,token_hash},signed.email));
  });
  app.post('/join/accept',async(req,res)=>{
   const value=pendingToken(req);if(!value||req.body.token_hash!==hash(value))throw new Error('invalid_invitation');
   const joined=await invitation(req,'accept',{token_hash:hash(value)});
   res.setHeader('Set-Cookie',stringifySetCookie({name:inviteCookie,value:'',httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:0}));
   res.redirect(303,'/room/'+joined.room_id+'/connect');
  });
  app.post('/invitations/create',async(req,res)=>{
   const b=z.object({id:z.string().uuid(),room_id:z.string().uuid(),email:z.string().trim().email().max(254).transform(v=>v.toLowerCase()),fresh_room:z.enum(['true','false']).default('false')}).parse(req.body);
   const inv=await invitation(req,'create',{...b,token_hash:hash(inviteSecret(b.id))});
   // Creation is durable even if the email service fails. The room lists its link/status.
   try{await mailInvitation(req,inv.id,b.id);}catch(e:any){if(!['rate_limited','invalid_invitation'].includes(e.message))throw e;}
   res.redirect(303,'/room/'+b.room_id+'#invitations');
  });
  app.post('/invitations/send',async(req,res)=>{
   const id=z.string().uuid().parse(req.body.id),attempt=z.string().uuid().parse(req.body.attempt),room=z.string().uuid().parse(req.body.room_id);
   await mailInvitation(req,id,attempt,true);res.redirect(303,'/room/'+room+'#invitations');
  });
  app.post('/invitations/revoke',async(req,res)=>{
   const id=z.string().uuid().parse(req.body.id),room=z.string().uuid().parse(req.body.room_id);
   await invitation(req,'revoke',{id});res.redirect(303,'/room/'+room+'#invitations');
  });
  app.get('/room/:id/connection/:connectionId',async(req,res)=>{
   const room_id=z.string().uuid().parse(req.params.id),id=z.string().uuid().parse(req.params.connectionId),h=await call(req,'home'),d=await call(req,'state',{room_id});
   const connection=d.connections.find((x:any)=>x.id===id&&x.human_id===h.human_id&&x.active);if(!connection)throw new Error('not_found');
   const ready=!!connection.last_seen;
   const html=page(ready?'Agent connected':'Waiting for your agent',`<p>${esc(connection.name)} ${ready?'has connected to Deepend. Confirm its hello message and group delivery in your agent chat.':'has not checked in yet. Paste the instructions first, then provide the credential through its secure entry flow.'}</p><p>${d.contact_id===id?'This is your selected contact for the group conversation.':'This agent is a contributor. Choose a contact in room settings to receive the group discussion.'}</p><a class="button" href="/room/${room_id}">Back to room</a>${ready?'':'<p>This page checks again every five seconds. If the activation credential expires, use Reconnect in room settings.</p>'}`);
   show(res,ready?html:html.replace('</head>','<meta http-equiv="refresh" content="5"></head>'));
  });
  app.get('/room/:id/connect',async(req,res)=>{const room_id=z.string().uuid().parse(req.params.id),h=await call(req,'home');show(res,connectPage(await call(req,'state',{room_id}),h.human_id));});
  app.get('/auth/code',(_req,res)=>show(res,existingCode()));
  app.get('/reauth',(_req,res)=>show(res,login(false)));
  app.post('/auth/send',async(req,res)=>{
   await call(req,'auth.rate',{},null,'public','');const email=z.string().trim().email().max(254).parse(req.body.email).toLowerCase();
   if(!await eligible(req,email))throw new Error('enrollment_closed');
   const invite=pendingToken(req);
   const {error}=await auth.signInWithOtp({email,...(invite?{options:{emailRedirectTo:c.humanOrigin+'/join#'+invite}}:{})});if(error)throw new Error('email_not_sent');
   show(res,codeEntry(email));
  });
  app.post('/auth/verify',async(req,res)=>{
   await call(req,'auth.rate',{},null,'public','');const email=z.string().trim().email().max(254).parse(req.body.email).toLowerCase(),code=z.string().trim().regex(/^\d{6,10}$/).parse(req.body.code);
   if(!await eligible(req,email))throw new Error('enrollment_closed');
   const {data,error}=await auth.verifyOtp({email,token:code,type:'email'});if(error||!data.user?.id||!data.session){
    // A second submission can arrive after the first has consumed the one-use code.
    // Recognize an existing same-account session without renewing its freshness.
    let signedIn=false;
    try{signedIn=(await call(req,'home')).email===email;}catch{}
    if(signedIn&&pendingToken(req))return res.redirect(303,'/join/confirm');
    if(signedIn)return show(res,page('You’re already signed in','<p>Your existing sign-in is active. This code could not be used again.</p><a class="button" href="/">Continue to Deepend</a><p>If you were verifying your identity for a protected action, request a new code.</p><a href="/reauth">Get a new code</a>'));
    res.status(409);return show(res,codeEntry(email,true));
   }
   const session=token();const saved=await db.rpc('deepend_login',{p_id:data.user.id,p_email:data.user.email,p_hash:hash(session)});if(saved.error)throw new Error('database_rejected');
   setCookie(res,session,86400);res.redirect(303,authDestination(req));
  });
  app.post('/logout',async(req,res)=>{await call(req,'logout',{},randomUUID());setCookie(res,'',0);res.redirect(303,authDestination(req));});
  app.get('/hook-pairings/:id',async(req,res)=>{const pairing_id=z.string().uuid().parse(req.params.id);show(res,pairingPage(await hookCall(req)('owner.get',{pairing_id},true),c.agentOrigin));});
  app.get('/room/:id',async(req,res)=>{
   const room_id=z.string().uuid().parse(req.params.id),h=await call(req,'home'),d=await call(req,'state',{room_id});
   const admin=d.members.some((m:any)=>m.human_id===h.human_id&&m.role==='admin'&&m.status==='active');
   const invites=admin?invitationForm(room_id)+invitationList((await invitation(req,'list',{room_id})).invitations,inviteLink,room_id):'';
   show(res,roomView(d,h.human_id,successNotice(req.query.saved),pairingList((await hookCall(req)('owner.list',{room_id},true)).pairings),invites));
  });
  app.get('/export/:id',async(req,res)=>{const room_id=z.string().uuid().parse(req.params.id);res.attachment('deepend-room.json').json(await call(req,'room.export',{room_id}));});
 }else{
  app.post('/activate',async(req,res)=>{
   const t=z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(req.body.token),s=token();
   await call(req,'activate',{session_hash:hash(s)},null,'public',t);setCookie(res,s,30*86400);res.redirect(303,'/');
  });
  app.get('/delivery/:id/check',async(req,res)=>{const delivery_id=z.string().uuid().parse(req.params.id);show(res,page('Native send authorization',json(await call(req,'delivery.check',{delivery_id}))+'<p>Send the stored payload now, then record the outcome. A stale or paused result prohibits sending.</p><a href="/">Workspace</a>',true));});
  app.get('/events',async(req,res)=>{const b=validate('events',req.query),d=await call(req,'events',b);const next=d.events.at(-1)?.seq??b.after;show(res,page('Event data',json(d)+`<a href="/events?after=${next}">Next page</a> · <a href="/">Workspace</a>`,true));});
  app.post('/v1/hook-pairings',async(req,res)=>res.json(await registerHook(req,c.agentOrigin,c.humanOrigin,hookCall(req))));
  app.get('/v1/hook-pairings/status',async(req,res)=>res.json(await signedHook(req,c.agentOrigin,'/v1/hook-pairings/status','status',hookCall(req))));
  app.get('/v1/wake-signed',async(req,res)=>res.json(await signedHook(req,c.agentOrigin,'/v1/wake-signed','wake',hookCall(req))));
  app.get('/v1/wake',async(req,res)=>{
   if(!req.get('authorization'))throw new Error('unauthorized');
   const result=await db.rpc('deepend_wake',{p_hash:hash(identity(req)),p_ip:ip(req)});
   if(result.error)throw new Error('database_rejected');
   if(result.data?.error)throw new Error(result.data.error);
   res.json(result.data);
  });
  app.all('/v1/:operation',async(req,res)=>{
   const op=String(req.params.operation);if(!operations[op]||['home','room.export'].includes(op))throw new Error('invalid_operation');
   if((reads.has(op)&&req.method!=='GET')||(!reads.has(op)&&req.method!=='POST')){res.sendStatus(405);return;}
   const b=validate(op,req.method==='GET'?req.query:req.body);const id=reads.has(op)?null:z.string().uuid().parse(req.get('idempotency-key'));
   res.json(await call(req,op,b,id));
  });
 }
 app.post('/draft',async(req,res)=>{
  const op=z.string().parse(req.body.op);if(reads.has(op))throw new Error('invalid_operation');
  const body=validate(op,req.body);
  if(op==='connection.create')body.kind=body.platform==='instinct'?'activation':'bearer'; // strip form metadata; sender authority is never accepted
  if(op==='invite.accept'){body.token_hash=hash(body.token as string);delete body.token;}
  const id=z.string().uuid().parse(req.body.request_id);
  const d=await call(req,'draft.create',{op,input:body,...(body.room_id?{room_id:body.room_id}:{})},id);
  if(!isAgent&&!needsReview(op))return executeDraft(req,res,d.draft_id,body.room_id as string|undefined);
  res.redirect(303,`/draft/${d.draft_id}${body.room_id?'?room_id='+body.room_id:''}`);
 });
 app.get('/draft/:id',async(req,res)=>{
  const id=z.string().uuid().parse(req.params.id),room_id=req.query.room_id?z.string().uuid().parse(req.query.room_id):undefined;
  const d=await call(req,'draft.get',{id,...(room_id?{room_id}:{})});
  const context=!isAgent&&room_id?await call(req,'state',{room_id}):undefined;
  const review=humanAction(d.op,d.input,context);
  show(res,page(isAgent?'Review '+d.op:review.title,`${isAgent?'<p>This intent is saved. Retry this same form if submission times out.</p>'+json(d.input):'<p>'+esc(review.detail)+'</p>'}<form method="post" action="/execute">${hidden('id',id)}${room_id?hidden('room_id',room_id):''}<button>${esc(isAgent?'Confirm '+d.op:review.title)}</button></form><a href="${!isAgent&&room_id?'/room/'+room_id:'/'}">Cancel</a>`,isAgent));
 });
 async function executeDraft(req:Request,res:Response,id:string,room_id?:string){
  res.locals.retryUrl=`/draft/${id}${room_id?'?room_id='+room_id:''}`;
  const d=await call(req,'draft.get',{id,...(room_id?{room_id}:{})});const body={...d.input};
  let issued:string|undefined;
  if(['connection.create','connection.rotate','connection.wake','invite.create'].includes(d.op)){
   // Deterministic only under a server secret: retry produces the same credential, never a lost key.
   issued=createHmac('sha256',c.secret).update('issue:'+id).digest('base64url');body.token_hash=hash(issued);
  }
  const result=await call(req,d.op,body,id);
  let instructions='';
  if(issued){
   instructions=d.op==='connection.wake'?`<section><h2>Wake-check key</h2><p>This key only reports whether work is pending. It cannot read or post messages. Store it in your platform’s approved secret storage, never in chat or script source. Issuing a new wake key replaces the previous one.</p><pre>${esc(issued)}</pre><p>Endpoint: ${esc(c.agentOrigin)}/v1/wake</p><p><a href="https://github.com/hburgoyne/deepend/blob/mvp-build/connectors/WAKE.md">Hook setup and limitations</a></p></section>`:d.op==='invite.create'?`<section><h2>Invitation code</h2><p>Share this code with the person you want to invite.</p><pre>${esc(issued)}</pre></section>`:setupInstructions(c.agentOrigin,body,result,issued);
  }
  const destination=!isAgent&&d.op!=='room.delete'&&(body.room_id||result.room_id)?'/room/'+(body.room_id||result.room_id):'/';
  if(!isAgent&&!issued)return res.redirect(303,destination+'?saved='+encodeURIComponent(d.op));
  show(res,page(isAgent?'Saved':d.op==='invite.create'?'Invite someone':'Connect your agent',`${isAgent?'<p>Receipt <code>'+id+'</code></p>'+json(result):''}${instructions}<a class="button" href="${destination}">${isAgent?'Continue':'Back to room'}</a>`,isAgent));
 }
 app.post('/execute',async(req,res)=>{
  const id=z.string().uuid().parse(req.body.id),room_id=req.body.room_id?z.string().uuid().parse(req.body.room_id):undefined;
  return executeDraft(req,res,id,room_id);
 });
 app.use((_req,res)=>res.status(404).send('Not found'));
 app.use((err:any,req:Request,res:Response,_next:NextFunction)=>{
  const code=err instanceof z.ZodError?'invalid_input':err.message??'internal_error';
  const safe=new Set(['invitation_email_mismatch','replay_detected','source_message_required','delivery_required','invalid_input','unauthorized','forbidden','not_found','rate_limited','reauthenticate','invalid_code','invalid_activation','email_not_sent','enrollment_closed','database_rejected','request_conflict','invalid_operation','paused','human_input_required','lease_busy','stale_lease','not_contact','delivery_reconciliation_required','reconcile_before_retry','invalid_invitation','already_member','invalid_state','invalid_cursor','member_limit','admin_transfer_required']);
  const out=safe.has(code)?code:'request_rejected';const status=out==='rate_limited'?429:['unauthorized','reauthenticate'].includes(out)?401:out==='forbidden'?403:out==='not_found'?404:out==='database_rejected'?503:409;
  if(status===429)res.setHeader('Retry-After','60');res.status(status);
  if(req.path.startsWith('/v1/'))res.json({code:out,message:out.replaceAll('_',' '),...(status===429?{retry_after_seconds:60}:{})});
  else if(out==='invalid_invitation')show(res,page('Invitation unavailable','<p>This invitation has expired, was revoked, or is no longer valid. Ask the room administrator for a new invitation.</p><a href="/">Go to Deepend</a>'));
  else show(res,page('Action needs attention',`<p>${esc(out.replaceAll('_',' '))}</p>${out==='reauthenticate'?'<p>Verify a new email code, then return to this saved review form.</p><a href="/reauth">Verify identity</a>':'<a href="/">Return to Deepend</a>'}${res.locals.retryUrl?'<p><a href="'+esc(res.locals.retryUrl)+'">Return to your saved action</a> to retry without creating a duplicate.</p>':''}`,isAgent));
 });
 return app;
}
