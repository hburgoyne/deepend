create table deepend.room_invitations(
 id uuid primary key, creator_id uuid not null references deepend.humans,
 source_room_id uuid not null references deepend.rooms on delete cascade,
 room_id uuid not null references deepend.rooms on delete cascade,
 email text not null, token_hash text not null unique,
 input jsonb not null, created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days',
 revoked boolean not null default false, accepted_by uuid references deepend.humans,
 accepted_at timestamptz, email_state text not null default 'not_sent'
 check(email_state in ('not_sent','sending','sent','failed','unknown')),
 email_attempt uuid, email_attempt_at timestamptz
);
create index room_invitations_room on deepend.room_invitations(source_room_id,created_at);
create index room_invitations_email on deepend.room_invitations(email,expires_at);
alter table deepend.room_invitations enable row level security;
revoke all on deepend.room_invitations from public,anon,authenticated;

create function public.deepend_invitation(p_action text,p_hash text,p_body jsonb default '{}',p_ip text default 'unknown') returns jsonb
language plpgsql security definer set search_path='' as $$
declare h uuid; inv deepend.room_invitations; ro deepend.rooms; target uuid; addr text; ident uuid; result jsonb;
begin
 perform 1 from deepend.control where id=true for update;
 if not deepend.rate('invite-ip:'||p_ip,120) then return '{"error":"rate_limited"}'; end if;
 if p_action='eligible' then
  addr:=lower(trim(p_body->>'email'));
  return jsonb_build_object('eligible',exists(select 1 from deepend.humans u join deepend.members m on m.human_id=u.id where lower(u.email)=addr and m.status='active')
   or exists(select 1 from deepend.room_invitations i join deepend.members m on m.human_id=i.creator_id and m.room_id=i.source_room_id and m.status='active' and m.role='admin'
    where i.token_hash=p_body->>'token_hash' and i.email=addr and not i.revoked and i.expires_at>now() and i.accepted_by is null));
 end if;
 if p_action='context' then
  select * into inv from deepend.room_invitations where token_hash=p_body->>'token_hash' and not revoked and expires_at>now();
  if not found or not exists(select 1 from deepend.members where room_id=inv.source_room_id and human_id=inv.creator_id and status='active' and role='admin') then return '{"error":"invalid_invitation"}'; end if;
  return jsonb_build_object('id',inv.id,'room_id',inv.room_id,'title',(select title from deepend.rooms where id=inv.room_id),'email',inv.email,'expires_at',inv.expires_at);
 end if;
 select human_id into h from deepend.human_sessions where hash=p_hash and expires_at>now();
 if not found then return '{"error":"unauthorized"}'; end if;
 if p_action='accept' then
  select * into inv from deepend.room_invitations where token_hash=p_body->>'token_hash' for update;
  if not found or inv.revoked or inv.expires_at<=now() or not exists(select 1 from deepend.members where room_id=inv.source_room_id and human_id=inv.creator_id and status='active' and role='admin') then return '{"error":"invalid_invitation"}'; end if;
  if inv.email is distinct from (select lower(email) from deepend.humans where id=h) then return '{"error":"invitation_email_mismatch"}'; end if;
  if inv.accepted_by is not null then
   if inv.accepted_by=h and exists(select 1 from deepend.members where room_id=inv.room_id and human_id=h and status='active') then return jsonb_build_object('room_id',inv.room_id); end if;
   return '{"error":"invalid_invitation"}';
  end if;
  insert into deepend.members(room_id,human_id,role,status) values(inv.room_id,h,'member','active')
   on conflict(room_id,human_id) do update set status='active';
  update deepend.room_invitations set accepted_by=h,accepted_at=now() where id=inv.id;
  return jsonb_build_object('room_id',inv.room_id);
 end if;
 if p_action in ('create','list') then
  target:=(p_body->>'room_id')::uuid;
  if not exists(select 1 from deepend.members where room_id=target and human_id=h and status='active' and role='admin') then return '{"error":"forbidden"}'; end if;
  if p_action='list' then
   return jsonb_build_object('invitations',coalesce((select jsonb_agg(to_jsonb(x) order by created_at desc) from
    (select id,email,room_id,expires_at,revoked,accepted_at,email_state,email_attempt_at,created_at from deepend.room_invitations where source_room_id=target order by created_at desc limit 50) x),'[]'::jsonb));
  end if;
  ident:=(p_body->>'id')::uuid;addr:=lower(trim(p_body->>'email'));
  select * into inv from deepend.room_invitations where id=ident;
  if found then
   if inv.creator_id<>h or inv.input<>p_body then return '{"error":"request_conflict"}'; end if;
   return jsonb_build_object('id',inv.id,'room_id',inv.room_id,'email',inv.email);
  end if;
  if addr is null or length(addr)>254 or addr !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then return '{"error":"invalid_input"}'; end if;
  if not deepend.rate('invite-create:'||h::text,10) then return '{"error":"rate_limited"}'; end if;
  if (select count(*) from deepend.room_invitations where creator_id=h and created_at>now()-interval '1 day')>=30 then return '{"error":"rate_limited"}'; end if;
  select * into ro from deepend.rooms where id=target;
  if p_body->>'fresh_room'='true' then
   insert into deepend.rooms(title,budget,budget_limit) values(left(ro.title,108)||' (new group)',ro.budget_limit,ro.budget_limit) returning id into target;
   insert into deepend.members(room_id,human_id,role,status) values(target,h,'admin','active');
  elsif exists(select 1 from deepend.members m join deepend.humans u on u.id=m.human_id where m.room_id=target and m.status='active' and lower(u.email)=addr) then return '{"error":"already_member"}';
  end if;
  insert into deepend.room_invitations(id,creator_id,source_room_id,room_id,email,token_hash,input)
   values(ident,h,ro.id,target,addr,p_body->>'token_hash',p_body);
  return jsonb_build_object('id',ident,'room_id',target,'email',addr);
 end if;
 select * into inv from deepend.room_invitations where id=(p_body->>'id')::uuid for update;
 if not found then return '{"error":"not_found"}'; end if;
 if not exists(select 1 from deepend.members where room_id=inv.source_room_id and human_id=h and status='active' and role='admin') then return '{"error":"forbidden"}'; end if;
 if p_action='revoke' then
  update deepend.room_invitations set revoked=true where id=inv.id;return '{"ok":true}';
 elsif p_action='email.claim' then
  if inv.revoked or inv.accepted_by is not null or inv.expires_at<=now() then return '{"error":"invalid_invitation"}'; end if;
  if inv.email_attempt=(p_body->>'attempt')::uuid or (inv.email_state='sent' and p_body->>'resend' is distinct from 'true') then return jsonb_build_object('send',false,'state',inv.email_state); end if;
  if inv.email_attempt_at>now()-interval '60 seconds' then return '{"error":"rate_limited"}'; end if;
  if not deepend.rate('invite-email:'||h::text,5) or not deepend.rate('invite-recipient:'||inv.email,2) then return '{"error":"rate_limited"}'; end if;
  update deepend.room_invitations set email_state='sending',email_attempt=(p_body->>'attempt')::uuid,email_attempt_at=now() where id=inv.id;
  return jsonb_build_object('send',true,'email',inv.email,'room_id',inv.room_id);
 elsif p_action='email.result' then
  if p_body->>'state' not in ('sent','failed','unknown') then return '{"error":"invalid_input"}'; end if;
  update deepend.room_invitations set email_state=p_body->>'state' where id=inv.id and email_attempt=(p_body->>'attempt')::uuid and email_state='sending';
  return '{"ok":true}';
 end if;
 return '{"error":"invalid_operation"}';
end $$;
revoke all on function public.deepend_invitation(text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.deepend_invitation(text,text,jsonb,text) to service_role;

-- Routine first-agent onboarding uses the normal signed-in session. Other sensitive
-- settings retain fresh verification. Contact selection is atomic with first creation.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('deepend.dispatch(text,text,text,jsonb,uuid,text)'::regprocedure);
 if strpos(definition,'''room.delete'',''connection.create'',''connection.rotate''')=0 or strpos(definition,' elsif p_op=''member.remove'' then')=0 then raise exception 'unexpected onboarding dispatcher'; end if;
 definition:=replace(definition,
  'if not agent and p_op in (''invite.create'',''member.confirm'',''member.remove'',''member.promote'',''room.settings'',''room.delete'',''connection.create'',''connection.rotate'',''connection.revoke'',''contact.set'',''delivery.resolve'',''member.promote'') and not fresh',
  'if not agent and p_op in (''invite.create'',''member.confirm'',''member.remove'',''member.promote'',''room.settings'',''room.delete'',''connection.rotate'',''connection.revoke'',''contact.set'',''delivery.resolve'',''member.promote'') and not fresh');
 if strpos(definition,'returning id into ident;')=0 then raise exception 'unexpected connection dispatcher'; end if;
 definition:=replace(definition,'   insert into deepend.connections(',E'   if p_body->>''use_as_contact''=''true'' and me.contact_id is null and exists(select 1 from deepend.deliveries where room_id=r and human_id=h and state in (''sending'',''uncertain'')) then return ''{"error":"delivery_reconciliation_required"}''; end if;\n   insert into deepend.connections(');
 definition:=replace(definition,'returning id into ident;',E'returning id into ident;\n   if p_body->>''use_as_contact''=''true'' and me.contact_id is null then\n    update deepend.members set contact_id=ident,generation=generation+1 where room_id=r and human_id=h;\n   end if;');
 -- Removed members cannot reuse an outstanding invite; an admin may explicitly reinvite.
 definition:=replace(definition,' elsif p_op=''member.remove'' then',E' elsif p_op=''member.remove'' then\n  update deepend.room_invitations set revoked=true where room_id=r and email=(select lower(email) from deepend.humans where id=(p_body->>''human_id'')::uuid);');
 execute definition;
end $migration$;
