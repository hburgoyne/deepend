-- Timestamp is when the room accepted the event, not when the contact delivers it.
-- Keep existing receipts/payloads immutable to preserve native-send reconciliation.
do $migration$
declare definition text; old_fragment text; new_fragment text;
begin
 definition:=pg_get_functiondef('deepend.dispatch(text,text,text,jsonb,uuid,text)'::regprocedure);
 old_fragment:=$old$transcript:='[#'||until_seq||'] '||previous_event.actor_name$old$;
 new_fragment:=$new$transcript:='[#'||until_seq||'] '||to_char(previous_event.created_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS')||' UTC · '||previous_event.actor_name$new$;
 if strpos(definition,old_fragment)=0 then raise exception 'unexpected transcript formatter'; end if;
 execute replace(definition,old_fragment,new_fragment);
end $migration$;
