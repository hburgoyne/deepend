-- Hook private keys never enter this database. All RPCs remain server-only.
create table deepend.hook_pairings(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references deepend.humans,
 room_id uuid not null references deepend.rooms on delete cascade,
 connection_id uuid not null references deepend.connections on delete cascade,
 request_id uuid not null, public_key text not null check(length(public_key)=43),
 key_generation int not null default 1 check(key_generation>0),
 label text not null check(length(label) between 1 and 80),
 state text not null default 'pending' check(state in ('pending','approved','denied','revoked')),
 requested_at timestamptz not null default now(),
 enrollment_expires_at timestamptz not null default now()+interval '10 minutes',
 approved_at timestamptz,expires_at timestamptz,revoked_at timestamptz,last_hook_seen timestamptz,
 unique(connection_id,request_id)
);
create index hook_pairings_owner on deepend.hook_pairings(owner_id,room_id);
create index hook_pairings_rate on deepend.hook_pairings(connection_id,requested_at);
create unique index hook_pairings_active on deepend.hook_pairings(connection_id) where state='approved';
create table deepend.hook_nonces(
 pairing_id uuid not null references deepend.hook_pairings on delete cascade,
 key_generation int not null, nonce_hash text not null check(length(nonce_hash)=64),
 received_at timestamptz not null default now(), primary key(pairing_id,key_generation,nonce_hash)
);
create index hook_nonces_cleanup on deepend.hook_nonces(received_at);
alter table deepend.hook_pairings enable row level security;
alter table deepend.hook_nonces enable row level security;
revoke all on deepend.hook_pairings,deepend.hook_nonces from public,anon,authenticated;

-- Invoked only after the dispatcher verifies a human session and room membership.
create function deepend.hook_owner(h uuid,fresh boolean,op text,b jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare hp deepend.hook_pairings;
begin
 if not fresh then return '{"error":"reauthenticate"}'; end if;
 select * into hp from deepend.hook_pairings where id=(b->>'pairing_id')::uuid and owner_id=h and room_id=(b->>'room_id')::uuid for update;
 if not found then return '{"error":"not_found"}'; end if;
 if hp.public_key is distinct from b->>'public_key' then return '{"error":"request_conflict"}'; end if;
 if op in ('hook.approve','hook.renew') then
  if not exists(select 1 from deepend.connections where id=hp.connection_id and active)
   or not exists(select 1 from deepend.credentials where connection_id=hp.connection_id and kind in ('bearer','session') and not consumed and expires_at>now()) then return '{"error":"unauthorized"}'; end if;
  if op='hook.approve' and (hp.state<>'pending' or hp.enrollment_expires_at<=now()) then return '{"error":"invalid_state"}'; end if;
  if op='hook.renew' and hp.state<>'approved' then return '{"error":"invalid_state"}'; end if;
  update deepend.hook_pairings set state='revoked',revoked_at=now() where connection_id=hp.connection_id and state='approved' and id<>hp.id;
  update deepend.hook_pairings set state='approved',approved_at=now(),expires_at=now()+interval '90 days' where id=hp.id;
 elsif op='hook.deny' then
  if hp.state<>'pending' then return '{"error":"invalid_state"}'; end if;
  update deepend.hook_pairings set state='denied' where id=hp.id;
 elsif op='hook.revoke' then
  update deepend.hook_pairings set state='revoked',revoked_at=coalesce(revoked_at,now()) where id=hp.id;
 else return '{"error":"invalid_operation"}'; end if;
 return jsonb_build_object('ok',true,'room_id',hp.room_id);
end $$;
revoke all on function deepend.hook_owner(uuid,boolean,text,jsonb) from public,anon,authenticated;

-- The trusted HTTP server verifies Ed25519 proofs before register/status/wake.
-- lookup returns public metadata to that server only, never directly to a client.
create function public.deepend_hook(p_action text,p_hash text,p_body jsonb default '{}',p_ip text default 'unknown') returns jsonb
language plpgsql security definer set search_path='' as $$
declare hp deepend.hook_pairings; co deepend.connections; me deepend.members; ro deepend.rooms;
 h uuid; ident uuid; used_nonce text; pending boolean; result jsonb;
begin
 perform 1 from deepend.control where id=true for update;
 if not deepend.rate('hook-global',6000) or not deepend.rate('hook-ip:'||p_ip,600) then return '{"error":"rate_limited"}'; end if;
 delete from deepend.hook_nonces where (pairing_id,key_generation,nonce_hash) in (select pairing_id,key_generation,nonce_hash from deepend.hook_nonces where received_at<now()-interval '5 minutes' order by received_at limit 100);
 if p_action in ('register_context','register') then
  select c.* into co from deepend.credentials k join deepend.connections c on c.id=k.connection_id
   where k.hash=p_hash and k.kind in ('bearer','session') and not k.consumed and k.expires_at>now() and c.active;
  if not found or not exists(select 1 from deepend.members where room_id=co.room_id and human_id=co.human_id and status='active') then return '{"error":"unauthorized"}'; end if;
  if not deepend.rate('hook-setup:'||co.id::text,30) then return '{"error":"rate_limited"}'; end if;
  if p_action='register_context' then return jsonb_build_object('connection_id',co.id); end if;
  if p_body->>'connection_id' is distinct from co.id::text then return '{"error":"unauthorized"}'; end if;
  if abs(extract(epoch from now())-(p_body->>'timestamp')::bigint)>60 then return '{"error":"unauthorized"}'; end if;
  select * into hp from deepend.hook_pairings where connection_id=co.id and request_id=(p_body->>'request_id')::uuid;
  if found then
   if hp.public_key is distinct from p_body->>'public_key' or hp.label is distinct from p_body->>'label' then return '{"error":"request_conflict"}'; end if;
   if hp.state<>'pending' or hp.enrollment_expires_at<=now() then return '{"error":"invalid_state"}'; end if;
  else
   if (select count(*) from deepend.hook_pairings where connection_id=co.id and requested_at>now()-interval '1 hour')>=5
    or (select count(*) from deepend.hook_pairings where connection_id=co.id and state='pending' and enrollment_expires_at>now())>=3 then return '{"error":"rate_limited"}'; end if;
   insert into deepend.hook_pairings(owner_id,room_id,connection_id,request_id,public_key,label)
    values(co.human_id,co.room_id,co.id,(p_body->>'request_id')::uuid,p_body->>'public_key',p_body->>'label') returning * into hp;
  end if;
  insert into deepend.hook_nonces values(hp.id,0,p_body->>'nonce_hash',now()) on conflict do nothing returning nonce_hash into used_nonce;
  if used_nonce is null then return '{"error":"replay_detected"}'; end if;
  return jsonb_build_object('pairing_id',hp.id,'connection_id',co.id,'key_generation',hp.key_generation,'expires_at',hp.enrollment_expires_at);
 elsif p_action in ('owner.get','owner.list') then
  select human_id into h from deepend.human_sessions where hash=p_hash and expires_at>now();
  if not found then return '{"error":"unauthorized"}'; end if;
  if p_action='owner.list' then
   if not exists(select 1 from deepend.members where room_id=(p_body->>'room_id')::uuid and human_id=h and status='active') then return '{"error":"forbidden"}'; end if;
   return jsonb_build_object('pairings',coalesce((select jsonb_agg(to_jsonb(x) order by requested_at desc) from
    (select hp.* from deepend.hook_pairings hp where owner_id=h and room_id=(p_body->>'room_id')::uuid order by requested_at desc limit 100) x),'[]'::jsonb));
  end if;
  select * into hp from deepend.hook_pairings where id=(p_body->>'pairing_id')::uuid and owner_id=h;
  if not found or not exists(select 1 from deepend.members where room_id=hp.room_id and human_id=h and status='active') then return '{"error":"not_found"}'; end if;
  return to_jsonb(hp)||jsonb_build_object('room_title',(select title from deepend.rooms where id=hp.room_id),'agent_name',(select name from deepend.connections where id=hp.connection_id),'owner_email',(select email from deepend.humans where id=h));
 elsif p_action='lookup' then
  select * into hp from deepend.hook_pairings where id=(p_body->>'pairing_id')::uuid;
  if not found then return '{"error":"unauthorized"}'; end if;
  return jsonb_build_object('public_key',hp.public_key,'connection_id',hp.connection_id,'key_generation',hp.key_generation);
 elsif p_action in ('status','wake') then
  select * into hp from deepend.hook_pairings where id=(p_body->>'pairing_id')::uuid for update;
  if not found or hp.public_key is distinct from p_body->>'public_key' or hp.key_generation is distinct from (p_body->>'key_generation')::int
   or abs(extract(epoch from now())-(p_body->>'timestamp')::bigint)>60 then return '{"error":"unauthorized"}'; end if;
  select * into co from deepend.connections where id=hp.connection_id and active;
  if not found then return '{"error":"unauthorized"}'; end if;
  select * into me from deepend.members where room_id=hp.room_id and human_id=hp.owner_id and status='active';
  if not found or not exists(select 1 from deepend.credentials where connection_id=co.id and kind in ('bearer','session') and not consumed and expires_at>now()) then return '{"error":"unauthorized"}'; end if;
  if hp.state='revoked' then return '{"error":"unauthorized"}'; end if;
  if p_action='wake' and (hp.state<>'approved' or hp.expires_at<=now()) then return '{"error":"unauthorized"}'; end if;
  if not deepend.rate('wake:'||co.id::text,6) then return '{"error":"rate_limited"}'; end if;
  insert into deepend.hook_nonces values(hp.id,hp.key_generation,p_body->>'nonce_hash',now()) on conflict do nothing returning nonce_hash into used_nonce;
  if used_nonce is null then return '{"error":"replay_detected"}'; end if;
  if p_action='status' then
   return jsonb_build_object('state',case when hp.state='pending' and hp.enrollment_expires_at<=now() or hp.state='approved' and hp.expires_at<=now() then 'expired' else hp.state end,'expires_at',case when hp.state='approved' then hp.expires_at else hp.enrollment_expires_at end);
  end if;
  select * into ro from deepend.rooms where id=hp.room_id;
  update deepend.hook_pairings set last_hook_seen=now() where id=hp.id;
  update deepend.connections set last_hook_seen=now() where id=co.id;
  if ro.paused or (select paused from deepend.control where id=true) or co.batch_until>now()
   or exists(select 1 from deepend.deliveries where contact_id=co.id and state='sending' and lease_until>now()) then return '{"pending":false}'; end if;
  pending:=co.cursor<ro.seq or (me.contact_id=co.id and me.delivery_cursor<ro.seq)
   or exists(select 1 from deepend.tasks where room_id=co.room_id and holder=co.id and state='running');
  return jsonb_build_object('pending',coalesce(pending,false));
 end if;
 return '{"error":"invalid_operation"}';
end $$;
revoke all on function public.deepend_hook(text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.deepend_hook(text,text,jsonb,text) to service_role;

-- Rotation deletes the old connection credentials; invalidate paired identities too.
create function deepend.revoke_hooks_on_credential_delete() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.kind in ('bearer','session') then
  update deepend.hook_pairings set state='revoked',revoked_at=now() where connection_id=old.connection_id and state in ('pending','approved');
 end if;
 return old;
end $$;
revoke all on function deepend.revoke_hooks_on_credential_delete() from public,anon,authenticated;
create trigger revoke_hook_credentials after delete on deepend.credentials for each row execute function deepend.revoke_hooks_on_credential_delete();

-- Extend the existing saved-draft and receipt flow, without replacing unrelated logic.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('deepend.dispatch(text,text,text,jsonb,uuid,text)'::regprocedure);
 if strpos(definition,'''connection.wake'',''message'',''task.create''')=0 then raise exception 'unexpected dispatcher version'; end if;
 definition:=replace(definition,'''connection.wake'',''message'',''task.create''','''hook.approve'',''hook.renew'',''hook.deny'',''hook.revoke'',''connection.wake'',''message'',''task.create''');
 if strpos(definition,' elsif p_op=''contact.set'' then')=0 then raise exception 'unexpected dispatcher hook branch'; end if;
 definition:=replace(definition,' elsif p_op=''contact.set'' then',E' elsif p_op in (''hook.approve'',''hook.renew'',''hook.deny'',''hook.revoke'') and not agent then\n  result:=deepend.hook_owner(h,fresh,p_op,p_body);\n  if result ? ''error'' then return result; end if;\n elsif p_op=''contact.set'' then');
 execute definition;
 definition:=pg_get_functiondef('public.deepend_maintenance()'::regprocedure);
 definition:=replace(definition,'begin',E'begin\n delete from deepend.hook_nonces where received_at<now()-interval ''5 minutes'';\n delete from deepend.hook_pairings where state in (''pending'',''denied'') and requested_at<now()-interval ''7 days'';');
 execute definition;
end $migration$;
