-- Tags stop being access.
--
-- 0009–0019 made a tag a credential: follow someone, they grant a tag, you
-- accept, and every folder carrying it opens. It was precise and it was hard
-- to explain — a brand-new account could read nothing until two people had
-- acted, which is what 0025's self-serve demo tag was patching over.
--
-- The social flow replaces it with three ways into a folder, all of them an
-- explicit `notes_folder_members` row: own it, be invited, or ask and be
-- approved (plus the featured-folder onboarding in 0028). So membership is now
-- the only thing that reads files, and `notes_is_folder_member()` says exactly
-- that.
--
-- Nothing is stranded: `notes_user_tags` had no rows when this shipped, so no
-- one was reading anything through a tag. The tag tables and columns
-- (`notes_user_tags`, `notes_tag_grants`, `grants_join`, `self_serve`) stay as
-- inert leftovers — same precedent as 0012, dropping a column is not worth a
-- migration — but every RPC that wrote or read them as credentials loses
-- EXECUTE, so nothing can put a tag back into the access path by accident.
-- Tags live on as topics (0027).

begin;

create or replace function public.notes_is_folder_member(p_folder uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and exists (
       select 1 from public.notes_folders f
        where f.id = p_folder and f.deleted = false
     )
     and public.notes_folder_role(p_folder) is not null;
$$;

revoke execute on function
  public.notes_grant_tag(text, text),
  public.notes_respond_tag_grant(uuid, boolean),
  public.notes_revoke_tag(text, text),
  public.notes_granted_tags(),
  public.notes_claim_tag(text)
from public, anon, authenticated;

commit;
