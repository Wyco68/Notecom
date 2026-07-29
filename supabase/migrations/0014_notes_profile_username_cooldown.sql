-- Username change cooldown: 30 days -> 15 days.
--
-- `public.profiles` is the shared identity pool (docs/collaboration.md
-- "Identity") — BookCommunity reads and writes the same table, so this
-- shortens the cooldown for that app too. That is the intent: one identity,
-- one rule about how often its name may change. Nothing else in the trigger
-- changes; it is restated in full because Postgres has no way to patch a
-- function body.
--
-- The app mirrors this number in app/api/collab/me/profile/route.ts
-- (USERNAME_COOLDOWN_DAYS) purely to *predict* the next allowed date for the
-- UI. This trigger is what enforces it — the client value is a label, never a
-- gate.

create or replace function public.enforce_profiles_username()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_cooldown interval := interval '15 days';
begin
  if new.username is null or btrim(new.username) = '' then
    raise exception 'username is required';
  end if;

  new.username := lower(btrim(new.username));

  if not public.is_valid_username(new.username) then
    raise exception 'invalid username: at least 3 characters, lowercase letters, numbers, underscore or hyphen only, no spaces';
  end if;

  if tg_op = 'UPDATE' then
    if old.username is distinct from new.username then
      if old.username_updated_at is not null
         and old.username_updated_at + v_cooldown > now() then
        raise exception 'username can only be changed once every 15 days';
      end if;
      new.username_updated_at := now();
    end if;
  end if;

  return new;
end;
$function$;
