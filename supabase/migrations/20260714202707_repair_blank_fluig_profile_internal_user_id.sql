update public.app_user_profiles
set
  fluig_user_id = '00130',
  updated_at = now()
where fluig_user_id = '132'
  and nullif(trim(fluig_username), '') is null;
