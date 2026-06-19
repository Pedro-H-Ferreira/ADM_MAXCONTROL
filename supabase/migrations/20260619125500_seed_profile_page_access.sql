insert into public.app_user_page_access (user_id, page_slug, can_view, can_create, can_update, can_approve)
select id, 'perfil', true, false, false, false
from public.app_user_profiles
on conflict (user_id, page_slug) do nothing;
