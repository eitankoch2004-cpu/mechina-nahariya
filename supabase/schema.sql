-- ============================================================
-- מכינת נהריה — מסד הנתונים
-- להריץ פעם אחת ב-Supabase → SQL Editor → New query → Run.
-- אפשר להריץ שוב בלי נזק (create if not exists / or replace).
--
-- אבטחה: כל טבלה נעולה ב-RLS. רק מי שרשום בטבלת staff (הצוות)
-- רואה או משנה משהו. אדם שנכנס עם המפתח הציבורי בלבד מקבל רשימות ריקות.
-- ============================================================

-- ---------- צוות ----------
create table if not exists public.staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text not null default '' check (length(name) <= 60),
  role       text not null default 'staff' check (role in ('admin', 'staff')),
  created_at timestamptz not null default now()
);

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid());
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and role = 'admin');
$$;

-- ---------- קבוצות ----------
create table if not exists public.groups (
  id         bigint generated always as identity primary key,
  name       text not null unique check (length(trim(name)) between 1 and 40),
  sort       int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- חניכים (כולל פרטי שני הורים) ----------
create table if not exists public.students (
  id            uuid primary key default gen_random_uuid(),
  first_name    text not null check (length(trim(first_name)) between 1 and 40),
  last_name     text not null default '' check (length(last_name) <= 40),
  phone         text not null default '' check (length(phone) <= 20),
  city          text not null default '' check (length(city) <= 40),
  birth_date    date,
  group_id      bigint references public.groups(id) on delete set null,
  active        boolean not null default true,
  parent1_name  text not null default '' check (length(parent1_name) <= 40),
  parent1_phone text not null default '' check (length(parent1_phone) <= 20),
  parent2_name  text not null default '' check (length(parent2_name) <= 40),
  parent2_phone text not null default '' check (length(parent2_phone) <= 20),
  notes         text not null default '' check (length(notes) <= 2000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid default auth.uid()
);
create index if not exists students_group_idx on public.students (group_id);

-- ---------- נוכחות: שורה אחת לחניך ליום ----------
create table if not exists public.attendance (
  student_id uuid not null references public.students(id) on delete cascade,
  day        date not null,
  status     text not null check (status in ('present', 'late', 'absent', 'excused')),
  note       text not null default '' check (length(note) <= 200),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (student_id, day)
);
create index if not exists attendance_day_idx on public.attendance (day desc);

-- ---------- תבניות הודעה ----------
create table if not exists public.templates (
  id         bigint generated always as identity primary key,
  title      text not null check (length(trim(title)) between 1 and 60),
  body       text not null check (length(body) between 1 and 1000),
  audience   text not null default 'parents' check (audience in ('parents', 'students')),
  sort       int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- יומן פעילות: מי הוסיף / שינה / מחק חניך ----------
create table if not exists public.activity (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  user_id uuid default auth.uid(),
  action  text not null,
  detail  text not null default ''
);
create index if not exists activity_at_idx on public.activity (at desc);

-- ---------- תקלות (ניטור) ----------
create table if not exists public.app_errors (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  app         text not null,
  message     text not null,
  stack       text,
  page        text,
  user_agent  text,
  user_id     uuid
);
create index if not exists app_errors_created_idx on public.app_errors (created_at desc);

-- ============================================================
-- טריגרים
-- ============================================================
create or replace function public.touch_student() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists students_touch on public.students;
create trigger students_touch before update on public.students
  for each row execute function public.touch_student();

create or replace function public.log_student_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if tg_op = 'DELETE' then
    v_name := trim(old.first_name || ' ' || old.last_name);
    insert into public.activity (action, detail) values ('נמחק חניך', v_name);
    return old;
  end if;
  v_name := trim(new.first_name || ' ' || new.last_name);
  if tg_op = 'INSERT' then
    insert into public.activity (action, detail) values ('נוסף חניך', v_name);
  elsif old.active and not new.active then
    insert into public.activity (action, detail) values ('חניך סומן כעזב', v_name);
  elsif not old.active and new.active then
    insert into public.activity (action, detail) values ('חניך הוחזר לפעילים', v_name);
  else
    insert into public.activity (action, detail) values ('עודכנו פרטי חניך', v_name);
  end if;
  return new;
exception when others then
  return coalesce(new, old);  -- היומן לעולם לא חוסם שמירה
end $$;

drop trigger if exists students_log on public.students;
create trigger students_log after insert or update or delete on public.students
  for each row execute function public.log_student_change();

-- ============================================================
-- RLS — רק הצוות
-- ============================================================
alter table public.staff      enable row level security;
alter table public.groups     enable row level security;
alter table public.students   enable row level security;
alter table public.attendance enable row level security;
alter table public.templates  enable row level security;
alter table public.activity   enable row level security;
alter table public.app_errors enable row level security;

drop policy if exists "staff reads staff" on public.staff;
create policy "staff reads staff" on public.staff for select to authenticated using (public.is_staff());

drop policy if exists "staff all groups" on public.groups;
create policy "staff all groups" on public.groups for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "staff all students" on public.students;
create policy "staff all students" on public.students for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "staff all attendance" on public.attendance;
create policy "staff all attendance" on public.attendance for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "staff all templates" on public.templates;
create policy "staff all templates" on public.templates for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "staff reads activity" on public.activity;
create policy "staff reads activity" on public.activity for select to authenticated using (public.is_staff());

drop policy if exists "admin reads errors" on public.app_errors;
create policy "admin reads errors" on public.app_errors for select to authenticated using (public.is_admin());
drop policy if exists "admin deletes errors" on public.app_errors;
create policy "admin deletes errors" on public.app_errors for delete to authenticated using (public.is_admin());

-- הרשאות מפורשות (פרויקטים חדשים לא נותנים אותן אוטומטית). RLS עדיין מסנן.
revoke all on public.staff, public.groups, public.students, public.attendance,
              public.templates, public.activity, public.app_errors from anon;
grant select on public.staff, public.activity to authenticated;
grant select, insert, update, delete on public.groups, public.students,
      public.attendance, public.templates to authenticated;
grant select, delete on public.app_errors to authenticated;

-- ============================================================
-- פונקציות
-- ============================================================

-- הראשון שנכנס כשאין עדיין צוות בכלל — הופך למנהל. אחר כך זה לא עושה כלום.
create or replace function public.claim_first_admin() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  lock table public.staff in exclusive mode;
  if exists (select 1 from public.staff) then return false; end if;
  insert into public.staff (user_id, name, role) values (auth.uid(), '', 'admin');
  return true;
end $$;

-- רשימת הצוות עם המייל (המייל נמצא ב-auth.users, לכן דרך פונקציה)
create or replace function public.staff_list()
returns table (user_id uuid, name text, role text, email text, last_sign_in timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  return query
    select s.user_id, s.name, s.role, u.email::text, u.last_sign_in_at
      from public.staff s join auth.users u on u.id = s.user_id
     order by s.created_at;
end $$;

create or replace function public.set_my_name(p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  update public.staff set name = left(trim(p_name), 60) where user_id = auth.uid();
end $$;

-- מנהל מוסיף איש צוות לפי מייל (את המשתמש יוצרים קודם ב-Authentication → Add user)
create or replace function public.admin_add_staff(p_email text, p_name text, p_role text default 'staff')
returns text
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_role not in ('admin', 'staff') then raise exception 'bad role'; end if;
  select id into v_id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_id is null then return 'no_user'; end if;
  insert into public.staff (user_id, name, role) values (v_id, left(trim(p_name), 60), p_role)
    on conflict (user_id) do update set name = excluded.name, role = excluded.role;
  insert into public.activity (action, detail) values ('נוסף איש צוות', trim(p_email));
  return 'ok';
end $$;

create or replace function public.admin_remove_staff(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_user = auth.uid() then raise exception 'cannot remove yourself'; end if;
  delete from public.staff where user_id = p_user;
  insert into public.activity (action, detail) values ('הוסר איש צוות', p_user::text);
end $$;

-- ניטור תקלות: כל אחד יכול לדווח, בגודל מוגבל ועם הגנה מהצפה
create or replace function public.log_error(
  p_app text, p_message text,
  p_stack text default null, p_page text default null, p_ua text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_message is null or length(trim(p_message)) = 0 then return; end if;
  if exists (
    select 1 from public.app_errors e
     where e.message = left(p_message, 500)
       and e.user_id is not distinct from auth.uid()
       and e.user_agent is not distinct from left(p_ua, 300)
       and e.created_at > now() - interval '60 seconds'
  ) then return; end if;
  if (select count(*) from public.app_errors where created_at > now() - interval '1 hour') >= 500 then
    return;
  end if;
  insert into public.app_errors (app, message, stack, page, user_agent, user_id)
  values (left(coalesce(p_app, 'unknown'), 40), left(p_message, 500),
          left(p_stack, 4000), left(p_page, 300), left(p_ua, 300), auth.uid());
end $$;

revoke all on function public.claim_first_admin() from public, anon;
revoke all on function public.staff_list() from public, anon;
revoke all on function public.set_my_name(text) from public, anon;
revoke all on function public.admin_add_staff(text, text, text) from public, anon;
revoke all on function public.admin_remove_staff(uuid) from public, anon;
revoke all on function public.log_error(text, text, text, text, text) from public;
grant execute on function public.claim_first_admin() to authenticated;
grant execute on function public.staff_list() to authenticated;
grant execute on function public.set_my_name(text) to authenticated;
grant execute on function public.admin_add_staff(text, text, text) to authenticated;
grant execute on function public.admin_remove_staff(uuid) to authenticated;
grant execute on function public.log_error(text, text, text, text, text) to anon, authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ============================================================
-- עדכון חי: חניך שנוסף בטלפון מופיע מיד במחשב
-- ============================================================
do $$
begin
  begin alter publication supabase_realtime add table public.students;   exception when others then null; end;
  begin alter publication supabase_realtime add table public.attendance; exception when others then null; end;
  begin alter publication supabase_realtime add table public.groups;     exception when others then null; end;
end $$;

-- ============================================================
-- תבניות התחלה (רק אם עוד אין תבניות)
-- ============================================================
insert into public.templates (title, body, audience, sort)
select * from (values
  ('עדכון על חיסור', 'שלום {הורה}, כאן צוות מכינת נהריה. רצינו לעדכן ש{חניך} לא הגיע/ה היום ({תאריך}). נשמח לשמוע שהכול בסדר 🙏', 'parents', 1),
  ('כמה חיסורים ברצף', 'שלום {הורה}, כאן צוות מכינת נהריה. שמנו לב ש{חניך} חיסר/ה כמה ימים ברצף. נשמח לדבר — מתי נוח לך?', 'parents', 2),
  ('תזכורת לאירוע', 'שלום {הורה}, תזכורת מצוות מכינת נהריה: ___ ביום ___ בשעה ___. נתראה!', 'parents', 3),
  ('יום הולדת', 'מזל טוב {חניך}! 🎉 כל צוות מכינת נהריה מאחל לך יום הולדת שמח ושנה מעולה', 'students', 4),
  ('הודעה לחניכים', 'היי {חניך}, ___ . צוות מכינת נהריה', 'students', 5)
) as t(title, body, audience, sort)
where not exists (select 1 from public.templates);
