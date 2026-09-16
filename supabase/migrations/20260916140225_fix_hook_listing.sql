-- Avoid collision between the hp record variable and the table alias.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.deepend_hook(text,text,jsonb,text)'::regprocedure);
 if strpos(definition,'select hp.* from deepend.hook_pairings hp')=0 then
  raise exception 'unexpected hook listing version';
 end if;
 definition:=replace(definition,'select hp.* from deepend.hook_pairings hp','select listed.* from deepend.hook_pairings listed');
 execute definition;
end $migration$;
