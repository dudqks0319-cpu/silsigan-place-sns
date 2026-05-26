-- #실시간 MVP schema.
-- Privacy invariant: user exact coordinates are never persisted. Report creation may
-- receive transient client coordinates in the API, but the database stores only
-- verified_radius_m for location proof.

create extension if not exists pgcrypto;

create type public.region_code as enum ('ulsan', 'busan', 'gyeongju');
create type public.place_category as enum (
  'tourism',
  'festival',
  'restaurant_cafe',
  'hospital',
  'public_office',
  'parking'
);
create type public.crowd_level as enum ('quiet', 'normal', 'busy', 'packed');
create type public.line_status as enum ('none', 'short', 'medium', 'long');
create type public.parking_status as enum ('available', 'limited', 'full', 'unknown');
create type public.weather_feel as enum ('good', 'rainy', 'windy', 'hot', 'cold');
create type public.question_type as enum ('crowd', 'line', 'parking', 'weather', 'photo_request', 'other');
create type public.credit_event_type as enum (
  'signup_bonus',
  'verified_report',
  'photo_report',
  'answer_question',
  'ask_question',
  'ask_photo_request',
  'confirmed_false_report'
);
create type public.flag_reason as enum (
  'false_content',
  'spam',
  'privacy_face',
  'privacy_plate',
  'sensitive_info',
  'other'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '익명 사용자' check (char_length(display_name) <= 40),
  trust_score integer not null default 0 check (trust_score >= 0 and trust_score <= 1000),
  created_at timestamptz not null default now()
);

create table public.places (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) <= 120),
  address text not null check (char_length(address) <= 240),
  region public.region_code not null,
  category public.place_category not null,
  latitude numeric(9, 6) not null check (latitude between 33 and 39),
  longitude numeric(9, 6) not null check (longitude between 124 and 132),
  created_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  category public.place_category not null,
  crowd_level public.crowd_level not null,
  line_status public.line_status not null,
  parking_status public.parking_status not null,
  weather_feel public.weather_feel not null,
  comment text check (comment is null or char_length(comment) <= 120),
  photo_path text check (photo_path is null or char_length(photo_path) <= 512),
  verified_radius_m smallint not null check (verified_radius_m in (50, 150, 300)),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '3 hours'),
  hidden_at timestamptz,
  hidden_reason text check (hidden_reason is null or char_length(hidden_reason) <= 120)
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_type public.question_type not null,
  body text not null check (char_length(body) between 4 and 160),
  credit_cost smallint not null check (credit_cost in (1, 2)),
  answered_report_id uuid references public.reports(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.credit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type public.credit_event_type not null,
  amount integer not null check (amount between -10 and 10),
  report_id uuid references public.reports(id) on delete set null,
  question_id uuid references public.questions(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint credit_event_matches_amount check (
    (event_type = 'signup_bonus' and amount = 3)
    or (event_type in ('verified_report', 'photo_report') and amount = 1)
    or (event_type = 'answer_question' and amount = 2)
    or (event_type = 'ask_question' and amount = -1)
    or (event_type = 'ask_photo_request' and amount = -2)
    or (event_type = 'confirmed_false_report' and amount = -5)
  )
);

create table public.moderation_flags (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason public.flag_reason not null,
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  unique (report_id, reporter_id, reason)
);

create index places_region_category_idx on public.places (region, category);
create index reports_place_created_idx on public.reports (place_id, created_at desc);
create index reports_visible_idx on public.reports (expires_at, hidden_at) where hidden_at is null;
create index questions_place_created_idx on public.questions (place_id, created_at desc);
create index moderation_flags_report_idx on public.moderation_flags (report_id, reason);
create index credit_events_user_idx on public.credit_events (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.places enable row level security;
alter table public.reports enable row level security;
alter table public.questions enable row level security;
alter table public.credit_events enable row level security;
alter table public.moderation_flags enable row level security;

create policy "profiles can read own profile"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles can insert own profile"
  on public.profiles for insert
  with check (id = auth.uid());

create policy "profiles can update own profile"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "places are publicly readable"
  on public.places for select
  using (true);

create policy "visible reports are publicly readable"
  on public.reports for select
  using (hidden_at is null and expires_at > now());

create policy "users can read own reports"
  on public.reports for select
  using (user_id = auth.uid());

-- Report writes intentionally have no anon/auth insert policy in the MVP schema.
-- They must go through server API/service role so transient client coordinates can
-- be verified and discarded before persistence.

create policy "users can read own questions"
  on public.questions for select
  using (user_id = auth.uid());

create policy "place questions are publicly readable"
  on public.questions for select
  using (true);

-- Question writes intentionally have no anon/auth insert policy. Server-side
-- transaction code must check and deduct question credits atomically.

create policy "users can read own credit events"
  on public.credit_events for select
  using (user_id = auth.uid());

-- Credit events intentionally have no client insert/update/delete policy.
-- Credits are accounting records and must be written only by trusted server code.

-- Moderation writes should go through the server API for duplicate prevention,
-- abuse controls, and automatic temporary hiding.

create policy "users can read own moderation flags"
  on public.moderation_flags for select
  using (reporter_id = auth.uid());

create or replace view public.active_reports as
select
  id,
  place_id,
  category,
  crowd_level,
  line_status,
  parking_status,
  weather_feel,
  comment,
  photo_path,
  verified_radius_m,
  created_at,
  expires_at
from public.reports
where hidden_at is null
  and expires_at > now();

comment on column public.reports.verified_radius_m is
  'Only persisted location proof for a user report. Exact user coordinates must not be stored.';
comment on column public.reports.photo_path is
  'Images should be EXIF-stripped or re-encoded before storage; store only the sanitized object path.';
comment on table public.moderation_flags is
  'Application moderation hides reports after privacy/sensitive 1 flag, false_content 2 flags, or 3 total flags.';
