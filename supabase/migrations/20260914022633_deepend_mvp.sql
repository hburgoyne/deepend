-- Fresh project only. The prototype schema is intentionally not reused.
create schema if not exists deepend;
revoke all on schema deepend from public, anon, authenticated;
grant usage on schema deepend to service_role;
create table deepend.humans(id uuid primary key, email text not null);
create table deepend.human_sessions(hash text primary key, human_id uuid references deepend.humans, expires_at timestamptz not null default now()+interval '24 hours', verified_at timestamptz not null default now());
create table deepend.rooms(id uuid primary key default gen_random_uuid(), title text not null check(length(title) between 1 and 120), paused boolean not null default false, seq bigint not null default 0, budget int not null default 8 check(budget between 0 and 30), created_at timestamptz not null default now());
create table deepend.members(room_id uuid references deepend.rooms on delete cascade, human_id uuid references deepend.humans, role text not null check(role in ('admin','member')), status text not null check(status in ('pending','active','removed')), contact_id uuid, generation int not null default 0, delivery_cursor bigint not null default 0, primary key(room_id,human_id));
create table deepend.connections(id uuid primary key default gen_random_uuid(), room_id uuid not null references deepend.rooms on delete cascade, human_id uuid not null references deepend.humans, name text not null check(length(name) between 1 and 80), platform text not null check(platform in ('muse','instinct','openclaw','other')), active boolean not null default true, cursor bigint not null default 0, batch_end bigint, batch_generation int not null default 0, batch_until timestamptz, last_seen timestamptz, created_at timestamptz not null default now());
create table deepend.credentials(hash text primary key, connection_id uuid not null references deepend.connections on delete cascade, kind text not null check(kind in ('bearer','activation','session')), expires_at timestamptz not null, consumed boolean not null default false);
create table deepend.invites(hash text primary key, room_id uuid not null references deepend.rooms on delete cascade, expires_at timestamptz not null default now()+interval '7 days', consumed boolean not null default false);
create table deepend.events(room_id uuid not null references deepend.rooms on delete cascade, seq bigint not null, actor_id uuid, actor_name text not null, type text not null, body jsonb not null, created_at timestamptz not null default now(), primary key(room_id,seq));
create table deepend.tasks(id uuid primary key default gen_random_uuid(), room_id uuid not null references deepend.rooms on delete cascade, title text not null check(length(title) between 1 and 240), detail text not null default '' check(length(detail)<=4000), state text not null default 'open' check(state in ('open','running','blocked','done','cancelled')), assignee uuid references deepend.connections, holder uuid references deepend.connections, lease_until timestamptz, generation int not null default 0, version int not null default 1);
create table deepend.deliveries(id uuid primary key default gen_random_uuid(), room_id uuid not null references deepend.rooms on delete cascade, human_id uuid not null references deepend.humans, contact_id uuid not null references deepend.connections, generation int not null, source_start bigint not null, source_end bigint not null, payload text not null check(length(payload)<=4000), state text not null default 'prepared' check(state in ('prepared','sending','delivered','skipped','uncertain','cancelled')), lease_until timestamptz, created_at timestamptz not null default now());
create unique index one_delivery on deepend.deliveries(room_id,human_id) where state in ('prepared','sending','uncertain');
create table deepend.receipts(actor_id uuid not null, request_id uuid not null, room_id uuid references deepend.rooms on delete cascade, op text not null, input jsonb not null, result jsonb not null, created_at timestamptz not null default now(), primary key(actor_id,request_id));
create table deepend.drafts(id uuid primary key, actor_id uuid not null, room_id uuid references deepend.rooms on delete cascade, op text not null, input jsonb not null, created_at timestamptz not null default now());
create table deepend.rates(key text primary key, window_start timestamptz not null, count int not null);
create table deepend.control(id boolean primary key default true check(id), paused boolean not null default false);
insert into deepend.control values(true,false);
create table deepend.audit(id bigint generated always as identity primary key, actor_id uuid, op text not null, outcome text not null, created_at timestamptz not null default now());

-- Private schema plus RLS: no public data API and no client-executable functions.
do $$ declare t record; begin for t in select tablename from pg_tables where schemaname='deepend' loop execute format('alter table deepend.%I enable row level security',t.tablename); end loop; end $$;
grant all on all tables in schema deepend to service_role;
grant usage,select on all sequences in schema deepend to service_role;

create function deepend.rate(k text, lim int) returns boolean language plpgsql set search_path='' as $$
declare n int; begin
 insert into deepend.rates as r values(k,date_trunc('minute',now()),1) on conflict(key) do update set window_start=excluded.window_start,count=case when r.window_start=excluded.window_start then r.count+1 else 1 end returning count into n;
 return n<=lim;
end $$;
create function deepend.emit(r uuid,a uuid,n text,t text,b jsonb) returns bigint language plpgsql set search_path='' as $$
declare s bigint; begin
 update deepend.rooms set seq=seq+1 where id=r returning seq into s;
 insert into deepend.events(room_id,seq,actor_id,actor_name,type,body) values(r,s,a,n,t,b); return s;
end $$;
create function public.deepend_login(p_id uuid,p_email text,p_hash text) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into deepend.humans values(p_id,p_email) on conflict(id) do update set email=excluded.email;
 insert into deepend.human_sessions(hash,human_id) values(p_hash,p_id);
end $$;

create function deepend.dispatch(p_kind text,p_hash text,p_op text,p_body jsonb default '{}',p_request uuid default null,p_ip text default 'unknown') returns jsonb language plpgsql security definer set search_path='' as $$
declare
 h uuid; a uuid; r uuid; cname text; fresh boolean; agent boolean:=p_kind='agent';
 co deepend.connections; ro deepend.rooms; me deepend.members; cr deepend.credentials;
 task deepend.tasks; dl deepend.deliveries; inv deepend.invites; rec deepend.receipts; dr deepend.drafts;
 result jsonb; vals jsonb; num bigint; ident uuid; contact uuid; lim int; until_seq bigint;
 read_op boolean:=p_op in ('home','state','events','receipt','draft.get','room.export','delivery.check');
begin
 -- Consistent global lock first; intentionally simple for small MVP, including kill switch ordering.
 perform 1 from deepend.control where id=true for update;
 if not deepend.rate('global',6000) then return '{"error":"rate_limited"}'; end if;
 if not deepend.rate('ip:'||p_ip,600) then return jsonb_build_object('error','rate_limited'); end if;
 if p_op='auth.rate' and p_kind='public' then
  if not deepend.rate('auth:'||p_ip,15) then return jsonb_build_object('error','rate_limited'); end if;
  return '{"ok":true}';
 end if;
 if p_op='activate' and p_kind='public' then
  select * into cr from deepend.credentials where hash=p_hash and kind='activation' and not consumed and expires_at>now() for update;
  if not found then return '{"error":"invalid_activation"}'; end if;
  select * into co from deepend.connections where id=cr.connection_id and active;
  if not found or not exists(select 1 from deepend.members where room_id=co.room_id and human_id=co.human_id and status='active') then return '{"error":"unauthorized"}'; end if;
  update deepend.credentials set consumed=true where hash=p_hash;
  insert into deepend.credentials values(p_body->>'session_hash',co.id,'session',now()+interval '30 days',false);
  return jsonb_build_object('connection_id',co.id);
 end if;
 if agent then
  select * into cr from deepend.credentials where hash=p_hash and kind in ('bearer','session') and not consumed and expires_at>now();
  if not found then return '{"error":"unauthorized"}'; end if;
  select * into co from deepend.connections where id=cr.connection_id and active;
  if not found then return '{"error":"unauthorized"}'; end if;
  a:=co.id; h:=co.human_id; r:=co.room_id; cname:=co.name;
 else
  if p_kind<>'human' then return '{"error":"unauthorized"}'; end if;
  select human_id,verified_at>now()-interval '15 minutes' into h,fresh from deepend.human_sessions where hash=p_hash and expires_at>now();
  if not found then return '{"error":"unauthorized"}'; end if;
  a:=h; cname:='Human'; r:=nullif(p_body->>'room_id','')::uuid;
 end if;
 if not deepend.rate('actor:'||a::text||case when read_op then ':read' else ':write' end,case when read_op then 120 else 30 end) then return '{"error":"rate_limited"}'; end if;
 if agent and p_body ? 'room_id' and (p_body->>'room_id')::uuid<>r then return '{"error":"forbidden"}'; end if;
 if not read_op and p_request is null then return '{"error":"request_id_required"}'; end if;
 if not agent and p_op in ('invite.create','member.confirm','member.remove','member.promote','room.settings','room.delete','connection.create','connection.rotate','connection.revoke','contact.set','delivery.resolve','member.promote') and not fresh then return '{"error":"reauthenticate"}'; end if;
 -- Stable receipts are scoped to server-derived actor, never supplied sender IDs.
 if p_request is not null then
  select * into rec from deepend.receipts where actor_id=a and request_id=p_request;
  if found then
   if rec.op<>p_op or rec.input<>p_body then return '{"error":"request_conflict"}'; end if;
   -- Access rechecked below before returning room receipts.
   if rec.room_id is null or exists(select 1 from deepend.members where room_id=rec.room_id and human_id=h and status='active') then return rec.result; end if;
   return '{"error":"forbidden"}';
  end if;
 end if;
 if r is not null then
  select * into ro from deepend.rooms where id=r for update;
  if not found then return '{"error":"not_found"}'; end if;
  select * into me from deepend.members where room_id=r and human_id=h and status='active';
  if not found then return '{"error":"forbidden"}'; end if;
  if not read_op and not deepend.rate('room:'||r::text,300) then return '{"error":"rate_limited"}'; end if;
 end if;
 if agent then update deepend.connections set last_seen=now() where id=a; end if;
 if agent and p_op not in ('state','events','receipt','draft.create','draft.get','message','batch.claim','batch.finish','task.create','task.claim','task.update','task.renew','delivery.prepare','delivery.claim','delivery.result','delivery.check') then return '{"error":"forbidden"}'; end if;
 if agent and not read_op and p_op not in ('draft.create','batch.finish','delivery.result') and (ro.paused or (select paused from deepend.control where id=true)) then return '{"error":"paused"}'; end if;

 if not agent and p_op in ('invite.create','member.confirm','member.remove','member.promote','room.settings','room.delete','room.export') and (r is null or me.role<>'admin') then return '{"error":"forbidden"}'; end if;
 if p_op='home' and not agent then
  result:=jsonb_build_object('human_id',h,'email',(select email from deepend.humans where id=h),'rooms',coalesce((select jsonb_agg(to_jsonb(x)) from(select rooms.*,members.role,members.status from deepend.rooms rooms join deepend.members members on rooms.id=members.room_id where members.human_id=h and members.status<>'removed') x),'[]'::jsonb));
 elsif p_op='room.create' and not agent then
  insert into deepend.rooms(title) values(p_body->>'title') returning id into r;
  insert into deepend.members(room_id,human_id,role,status) values(r,h,'admin','active');
  result:=jsonb_build_object('room_id',r);
 elsif p_op='invite.accept' and not agent then
  select * into inv from deepend.invites where hash=p_body->>'token_hash' and not consumed and expires_at>now() for update;
  if not found then return '{"error":"invalid_invitation"}'; end if;
  if exists(select 1 from deepend.members where room_id=inv.room_id and human_id=h) then return '{"error":"already_member"}'; end if;
  update deepend.invites set consumed=true where hash=inv.hash;
  insert into deepend.members(room_id,human_id,role,status) values(inv.room_id,h,'member','pending');
  result:=jsonb_build_object('status','pending');
 elsif p_op='logout' and not agent then
  delete from deepend.human_sessions where hash=p_hash; result:='{"ok":true}';
 elsif p_op='receipt' then
  select result into result from deepend.receipts where actor_id=a and request_id=(p_body->>'id')::uuid and (room_id is null or room_id=r);
  if result is null then return '{"error":"not_found"}'; end if;
 elsif p_op='draft.create' then
  if p_body->>'op' not in ('message','task.create','task.claim','task.update','task.renew','batch.claim','batch.finish','delivery.prepare','delivery.claim','delivery.result','room.create','invite.create','invite.accept','member.confirm','member.remove','member.promote','room.settings','room.delete','connection.create','connection.rotate','connection.revoke','contact.set','delivery.resolve') then return '{"error":"invalid_operation"}'; end if;
  ident:=gen_random_uuid(); insert into deepend.drafts values(ident,a,r,p_body->>'op',p_body->'input',now());
  result:=jsonb_build_object('draft_id',ident);
 elsif p_op='draft.get' then
  select * into dr from deepend.drafts where id=(p_body->>'id')::uuid and actor_id=a and created_at>now()-interval '24 hours';
  if not found then return '{"error":"not_found"}'; end if;
  if dr.room_id is not null and not exists(select 1 from deepend.members where room_id=dr.room_id and human_id=h and status='active') then return '{"error":"forbidden"}'; end if;
  result:=to_jsonb(dr)-'actor_id';
 elsif r is null then return '{"error":"room_required"}';
 elsif p_op='state' or p_op='room.export' then
  result:=jsonb_build_object('room',to_jsonb(ro),'credential_expires_at',case when agent then cr.expires_at else null end,'connection',case when agent then to_jsonb(co) else null end,'contact_id',me.contact_id,'generation',me.generation,
   'connections',coalesce((select jsonb_agg(to_jsonb(c)) from deepend.connections c where room_id=r),'[]'),
   'tasks',coalesce((select jsonb_agg(to_jsonb(t)) from deepend.tasks t where room_id=r),'[]'),
   'members',case when not agent then coalesce((select jsonb_agg(jsonb_build_object('human_id',m.human_id,'email',u.email,'status',m.status,'role',m.role,'contact_id',m.contact_id)) from deepend.members m join deepend.humans u on u.id=m.human_id where m.room_id=r),'[]') else '[]'::jsonb end,
   'deliveries',coalesce((select jsonb_agg(to_jsonb(d)) from deepend.deliveries d where room_id=r and human_id=h and state in ('prepared','sending','uncertain')),'[]'));
  if p_op='room.export' then result:=result||jsonb_build_object('events',coalesce((select jsonb_agg(to_jsonb(e) order by seq) from deepend.events e where room_id=r),'[]')); end if;
 elsif p_op='events' then
  lim:=least(500,greatest(1,coalesce((p_body->>'limit')::int,100))); num:=greatest(0,coalesce((p_body->>'after')::bigint,0));
  select coalesce(jsonb_agg(to_jsonb(e) order by seq),'[]') into vals from(select * from deepend.events where room_id=r and seq>num order by seq limit lim) e;
  result:=jsonb_build_object('events',vals,'latest_seq',ro.seq,'has_more',ro.seq>coalesce((vals->-1->>'seq')::bigint,num));
 elsif p_op='invite.create' then
  insert into deepend.invites(hash,room_id) values(p_body->>'token_hash',r); result:='{"ok":true}';
 elsif p_op='member.confirm' then
  update deepend.members set status='active' where room_id=r and human_id=(p_body->>'human_id')::uuid and status='pending';
  if not found then return '{"error":"not_found"}'; end if; result:='{"ok":true}';
 elsif p_op='member.promote' then
  update deepend.members set role='admin' where room_id=r and human_id=(p_body->>'human_id')::uuid and status='active';
  if not found then return '{"error":"not_found"}'; end if; result:='{"ok":true}';
 elsif p_op='member.remove' then
  ident:=(p_body->>'human_id')::uuid;
  if exists(select 1 from deepend.members where room_id=r and human_id=ident and role='admin') and (select count(*) from deepend.members where room_id=r and role='admin' and status='active')<=1 then return '{"error":"admin_transfer_required"}'; end if;
  update deepend.members set status='removed',contact_id=null,generation=generation+1 where room_id=r and human_id=ident;
  update deepend.connections set active=false where room_id=r and human_id=ident; result:='{"ok":true}';
 elsif p_op='room.settings' then
  update deepend.rooms set paused=coalesce((p_body->>'paused')::boolean,paused),budget=coalesce((p_body->>'budget')::int,budget),title=coalesce(p_body->>'title',title) where id=r;
  result:='{"ok":true}';
 elsif p_op='room.delete' then
  delete from deepend.rooms where id=r; r:=null; result:='{"ok":true}';
 elsif p_op in ('connection.create','connection.rotate','connection.revoke') then
  if p_op='connection.create' then
   if (select count(*) from deepend.connections where room_id=r and active)>=8 then return '{"error":"member_limit"}'; end if;
   insert into deepend.connections(room_id,human_id,name,platform) values(r,h,p_body->>'name',p_body->>'platform') returning id into ident;
  else
   ident:=(p_body->>'connection_id')::uuid;
   if not exists(select 1 from deepend.connections where id=ident and room_id=r and (human_id=h or (p_op='connection.revoke' and me.role='admin'))) then return '{"error":"forbidden"}'; end if;
   delete from deepend.credentials where connection_id=ident;
  end if;
  if p_op='connection.revoke' then
   update deepend.connections set active=false where id=ident;
   update deepend.members set contact_id=null,generation=generation+1 where room_id=r and contact_id=ident;
  else
   if p_body->>'kind' not in ('activation','bearer') then return '{"error":"invalid_kind"}'; end if;
   insert into deepend.credentials values(p_body->>'token_hash',ident,p_body->>'kind',now()+case when p_body->>'kind'='activation' then interval '30 minutes' else interval '30 days' end,false);
  end if; result:=jsonb_build_object('connection_id',ident);
 elsif p_op='delivery.resolve' and not agent then
  select * into dl from deepend.deliveries where id=(p_body->>'delivery_id')::uuid and room_id=r and human_id=h and state in ('sending','uncertain') for update;
  if not found then return '{"error":"not_found"}'; end if;
  if p_body->>'outcome' not in ('delivered','skipped') then return '{"error":"invalid_outcome"}'; end if;
  update deepend.deliveries set state=p_body->>'outcome',lease_until=null where id=dl.id;
  update deepend.members set delivery_cursor=dl.source_end where room_id=r and human_id=h; result:='{"ok":true}';
 elsif p_op='contact.set' then
  contact:=(p_body->>'connection_id')::uuid;
  if not exists(select 1 from deepend.connections where id=contact and room_id=r and human_id=h and active) then return '{"error":"forbidden"}'; end if;
  if exists(select 1 from deepend.deliveries where room_id=r and human_id=h and state in ('sending','uncertain')) then return '{"error":"delivery_reconciliation_required"}'; end if;
  update deepend.members set contact_id=contact,generation=generation+1 where room_id=r and human_id=h;
  update deepend.deliveries set contact_id=contact,generation=me.generation+1 where room_id=r and human_id=h and state='prepared'; result:='{"ok":true}';
 elsif p_op='message' and agent then
  if length(p_body->>'body') not between 1 and 4000 then return '{"error":"invalid_body"}'; end if;
  if ro.budget=0 then return '{"error":"human_input_required"}'; end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(p_body->'recipients','[]')) x where not exists(select 1 from deepend.connections where id=x.value::uuid and room_id=r and active)) then return '{"error":"invalid_recipient"}'; end if;
  update deepend.rooms set budget=budget-1 where id=r;
  num:=deepend.emit(r,a,cname,'message',jsonb_build_object('text',p_body->>'body','reply_to',p_body->'reply_to','causation',p_body->'causation','recipients',coalesce(p_body->'recipients','[]'),'represented_human',case when p_body->>'relay'='true' then h else null end));
  if ro.budget=1 then perform deepend.emit(r,null,'Deepend','system','{"text":"Conversation paused: owner input required to resume."}'); end if;
  result:=jsonb_build_object('seq',num);
 elsif p_op='batch.claim' and agent then
  if co.batch_until>now() then return '{"error":"lease_busy"}'; end if;
  until_seq:=least(ro.seq,co.cursor+100);
  update deepend.connections set batch_end=until_seq,batch_until=now()+interval '15 minutes',batch_generation=batch_generation+1 where id=a returning * into co;
  result:=jsonb_build_object('after',co.cursor,'through',co.batch_end,'generation',co.batch_generation,'lease_until',co.batch_until);
 elsif p_op='batch.finish' and agent then
  if co.batch_until<=now() or co.batch_until is null or co.batch_generation is distinct from (p_body->>'generation')::int then return '{"error":"stale_lease"}'; end if;
  if p_body->>'outcome' not in ('handled','skipped') then return '{"error":"invalid_outcome"}'; end if;
  update deepend.connections set cursor=batch_end,batch_until=null,batch_end=null where id=a;
  result:=jsonb_build_object('cursor',co.batch_end);
 elsif p_op='task.create' and agent then
  if p_body ? 'assignee' and not exists(select 1 from deepend.connections where id=(p_body->>'assignee')::uuid and room_id=r and active) then return '{"error":"invalid_recipient"}'; end if;
  insert into deepend.tasks(room_id,title,detail,assignee) values(r,p_body->>'title',coalesce(p_body->>'detail',''),(p_body->>'assignee')::uuid) returning * into task;
  perform deepend.emit(r,a,cname,'task',to_jsonb(task)); result:=to_jsonb(task);
 elsif p_op in ('task.claim','task.update','task.renew') and agent then
  select * into task from deepend.tasks where id=(p_body->>'task_id')::uuid and room_id=r for update;
  if not found then return '{"error":"not_found"}'; end if;
  if p_op='task.claim' then
   if task.assignee is not null and task.assignee<>a then return '{"error":"forbidden"}'; end if;
   if task.state in ('done','cancelled') or task.lease_until>now() then return '{"error":"lease_busy"}'; end if;
   update deepend.tasks set holder=a,lease_until=now()+interval '15 minutes',generation=generation+1,state='running',version=version+1 where id=task.id returning * into task;
  else
   if task.holder is distinct from a or task.lease_until<=now() or task.lease_until is null or task.generation is distinct from (p_body->>'generation')::int then return '{"error":"stale_lease"}'; end if;
   if p_op='task.renew' then update deepend.tasks set lease_until=now()+interval '15 minutes' where id=task.id returning * into task;
   else
    if p_body->>'state' not in ('running','blocked','done','cancelled') then return '{"error":"invalid_state"}'; end if;
    update deepend.tasks set state=p_body->>'state',detail=coalesce(p_body->>'detail',detail),version=version+1,lease_until=case when p_body->>'state'='running' then lease_until else null end where id=task.id returning * into task;
   end if;
  end if;
  perform deepend.emit(r,a,cname,'task',to_jsonb(task)); result:=to_jsonb(task);
 elsif p_op='delivery.prepare' and agent then
  if me.contact_id is distinct from a then return '{"error":"not_contact"}'; end if;
  select * into dl from deepend.deliveries where room_id=r and human_id=h and state in ('prepared','sending','uncertain');
  if found then result:=to_jsonb(dl);
  else
   until_seq:=(p_body->>'through')::bigint;
   if until_seq is null or until_seq<=me.delivery_cursor or until_seq>ro.seq then return '{"error":"invalid_cursor"}'; end if;
   insert into deepend.deliveries(room_id,human_id,contact_id,generation,source_start,source_end,payload) values(r,h,a,me.generation,me.delivery_cursor+1,until_seq,coalesce(p_body->>'payload','')) returning * into dl; result:=to_jsonb(dl);
  end if;
 elsif p_op in ('delivery.claim','delivery.result','delivery.check') and agent then
  select * into dl from deepend.deliveries where id=(p_body->>'delivery_id')::uuid and room_id=r and human_id=h for update;
  if not found or dl.contact_id<>a or me.contact_id is distinct from a or dl.generation<>me.generation then return '{"error":"not_contact"}'; end if;
  if p_op='delivery.check' then
   if dl.state<>'sending' or dl.lease_until is null or dl.lease_until<=now() or ro.paused or (select paused from deepend.control where id=true) then return '{"error":"reconcile_before_retry"}'; end if;
   result:=to_jsonb(dl);
  elsif p_op='delivery.claim' then
   if dl.state<>'prepared' then return '{"error":"reconcile_before_retry"}'; end if;
   update deepend.deliveries set state='sending',lease_until=now()+interval '5 minutes' where id=dl.id returning * into dl;
  else
   if p_body->>'outcome' not in ('delivered','skipped','uncertain') then return '{"error":"invalid_outcome"}'; end if;
   if dl.state not in ('prepared','sending','uncertain') or (p_body->>'outcome'='delivered' and dl.state='prepared') then return '{"error":"invalid_state"}'; end if;
   update deepend.deliveries set state=p_body->>'outcome',lease_until=null where id=dl.id returning * into dl;
   if dl.state in ('delivered','skipped') then update deepend.members set delivery_cursor=dl.source_end where room_id=r and human_id=h; end if;
  end if; result:=to_jsonb(dl);
 else return '{"error":"invalid_operation"}';
 end if;
 if result is null then return '{"error":"invalid_input"}'; end if;
 if not read_op then
  insert into deepend.receipts values(a,p_request,r,p_op,p_body,result,now());
 end if;
 return result;
end $$;
create function public.deepend_call(p_kind text,p_hash text,p_op text,p_body jsonb default '{}',p_request uuid default null,p_ip text default 'unknown') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; actor uuid; begin
 begin
  result:=deepend.dispatch(p_kind,p_hash,p_op,p_body,p_request,p_ip);
 exception when invalid_text_representation or check_violation or not_null_violation or foreign_key_violation or numeric_value_out_of_range then result:='{"error":"invalid_input"}';
 end;
 if p_kind='human' then select human_id into actor from deepend.human_sessions where hash=p_hash;
 elsif p_kind='agent' then select connection_id into actor from deepend.credentials where hash=p_hash; end if;
 insert into deepend.audit(actor_id,op,outcome) values(actor,left(p_op,40),coalesce(result->>'error','ok'));
 return result;
end $$;
create function public.deepend_maintenance() returns void language plpgsql security definer set search_path='' as $$
begin
 delete from deepend.audit where created_at<now()-interval '30 days';
 delete from deepend.rates where window_start<now()-interval '1 day';
 delete from deepend.human_sessions where expires_at<now();
 delete from deepend.drafts where created_at<now()-interval '24 hours';
 delete from deepend.invites where expires_at<now();
 -- Receipts remain for the room lifetime: offline retry must never duplicate work.
end $$;
revoke all on function public.deepend_maintenance() from public,anon,authenticated;
grant execute on function public.deepend_maintenance() to service_role;
revoke all on all functions in schema deepend from public,anon,authenticated;
revoke all on function public.deepend_login(uuid,text,text) from public,anon,authenticated;
revoke all on function public.deepend_call(text,text,text,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.deepend_login(uuid,text,text) to service_role;
grant execute on function public.deepend_call(text,text,text,jsonb,uuid,text) to service_role;
