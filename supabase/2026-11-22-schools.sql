-- ============================================================
-- ישיבות / תיכונים לבדיקה (2026-11-22)
-- להריץ פעם אחת ב-Supabase → SQL Editor. בטוח להריץ שוב.
-- ============================================================
create table if not exists public.schools (
  id           bigint generated always as identity primary key,
  name         text not null check (length(trim(name)) between 1 and 100),
  kind         text not null default 'ישיבה' check (kind in ('ישיבה', 'תיכון')),
  contact_name text check (contact_name is null or length(contact_name) <= 80),
  phone        text check (phone is null or length(phone) <= 30),
  email        text check (email is null or length(email) <= 120),
  notes        text check (notes is null or length(notes) <= 1000),
  status       text not null default 'todo' check (status in ('todo', 'done')),
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid()
);

alter table public.schools enable row level security;
drop policy if exists "staff all schools" on public.schools;
create policy "staff all schools" on public.schools for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

revoke all on public.schools from anon;
grant select, insert, update, delete on public.schools to authenticated;

-- יומן פעילות
create or replace function public.log_school_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity (action, detail) values ('נוספה ' || new.kind || ' לבדיקה', new.name);
  elsif tg_op = 'DELETE' then
    insert into public.activity (action, detail) values ('נמחקה ' || old.kind || ' מהרשימה', old.name);
    return old;
  elsif old.status <> new.status then
    insert into public.activity (action, detail)
      values (case when new.status = 'done' then 'סומנה כנבדקה' else 'הוחזרה לבדיקה' end, new.name);
  else
    insert into public.activity (action, detail) values ('עודכנו פרטי ' || new.kind, new.name);
  end if;
  return new;
exception when others then
  return coalesce(new, old);  -- היומן לעולם לא חוסם שמירה
end $$;

drop trigger if exists schools_log on public.schools;
create trigger schools_log after insert or update or delete on public.schools
  for each row execute function public.log_school_change();

-- עדכון חי בין אנשי הצוות
do $$
begin
  begin alter publication supabase_realtime add table public.schools; exception when others then null; end;
end $$;

-- בדיקה: צריך להופיע "ok"
select 'ok' as result, count(*) as schools from public.schools;
