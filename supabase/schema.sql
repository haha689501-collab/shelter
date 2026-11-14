-- 쉼터 3D — Supabase 테이블 · 보안 규칙(RLS)
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 실행하세요.
-- (또는 Claude Code 에서 Supabase 커넥터를 연결한 뒤 "이 파일대로 테이블을 만들어 줘" 라고 요청)

-- 1) 쪽지(note) · 소원(wish)
create table if not exists public.shelter_messages (
  id          bigint generated always as identity primary key,
  room        text not null default 'main' check (char_length(room) between 1 and 30),
  kind        text not null check (kind in ('note', 'wish')),
  text        text not null check (char_length(text) between 1 and 40),
  hidden      boolean not null default false,   -- 운영자가 true 로 바꾸면 화면에서 사라짐
  created_at  timestamptz not null default now()
);
create index if not exists shelter_messages_room_kind on public.shelter_messages (room, kind, created_at desc);

-- 2) 함께 쌓는 숫자 (온실 물 주기, 카페 응원)
create table if not exists public.shelter_counters (
  room   text not null check (char_length(room) between 1 and 30),
  name   text not null check (name in ('water', 'cheer')),
  value  bigint not null default 0,
  primary key (room, name)
);

-- 3) RLS: 행 단위 보안
alter table public.shelter_messages enable row level security;
alter table public.shelter_counters enable row level security;

-- 숨김 처리되지 않은 글만 읽을 수 있음
drop policy if exists "read visible messages" on public.shelter_messages;
create policy "read visible messages" on public.shelter_messages
  for select to anon, authenticated using (hidden = false);

-- 새 글은 쓸 수 있지만, 처음부터 숨김 상태로 넣거나 남의 글을 고치고 지울 수는 없음
-- (update / delete 정책이 없으므로 수정 · 삭제는 대시보드에서 운영자만 가능)
drop policy if exists "insert messages" on public.shelter_messages;
create policy "insert messages" on public.shelter_messages
  for insert to anon, authenticated with check (hidden = false);

-- 숫자는 누구나 읽을 수 있음. 직접 쓰기는 막고, 아래 함수로 +1 만 가능
drop policy if exists "read counters" on public.shelter_counters;
create policy "read counters" on public.shelter_counters
  for select to anon, authenticated using (true);

create or replace function public.shelter_increment(p_room text, p_name text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v bigint;
begin
  if p_name not in ('water', 'cheer') then raise exception 'invalid counter'; end if;
  if char_length(p_room) not between 1 and 30 then raise exception 'invalid room'; end if;
  insert into shelter_counters (room, name, value) values (p_room, p_name, 1)
  on conflict (room, name) do update set value = shelter_counters.value + 1
  returning value into v;
  return v;
end;
$$;
revoke all on function public.shelter_increment(text, text) from public;
grant execute on function public.shelter_increment(text, text) to anon, authenticated;

-- 4) 새 쪽지 · 소원이 다른 사람 화면에 바로 나타나도록 실시간 전송 켜기
do $$
begin
  alter publication supabase_realtime add table public.shelter_messages;
exception when duplicate_object then null;
end $$;
