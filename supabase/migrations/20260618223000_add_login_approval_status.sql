alter table public.app_user_profiles
  add column if not exists approval_status text not null default 'APPROVED'
    check (approval_status in ('PENDING', 'APPROVED', 'REJECTED')),
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_reason text;

update public.app_user_profiles
set approval_status = case when active then 'APPROVED' else 'PENDING' end,
    approved_at = case when active then coalesce(approved_at, updated_at, created_at, now()) else approved_at end
where approval_status is null
   or approval_status = 'APPROVED';

create index if not exists app_user_profiles_approval_status_idx
  on public.app_user_profiles (approval_status, active);
