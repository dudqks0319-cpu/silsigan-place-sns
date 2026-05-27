-- Place-SNS production store tables.
-- Privacy invariant: exact client GPS is transient API input only. Persist only
-- location_verified and verified_radius_m.

create table if not exists public.silsigan_places (
  id text primary key check (char_length(id) between 3 and 80),
  name text not null check (char_length(name) <= 120),
  address text not null check (char_length(address) <= 240),
  category public.place_category not null,
  latitude numeric(9, 6) not null check (latitude between 33 and 39),
  longitude numeric(9, 6) not null check (longitude between 124 and 132),
  region public.region_code not null,
  created_at timestamptz not null default now()
);

create table if not exists public.silsigan_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  creator_name text not null default '실시간러버' check (char_length(creator_name) <= 40),
  creator_badge text not null default '지역 현장러' check (char_length(creator_badge) <= 60),
  place_id text not null references public.silsigan_places(id) on delete cascade,
  caption text check (caption is null or char_length(caption) <= 120),
  crowd_level public.crowd_level not null,
  parking_status public.parking_status not null,
  line_status public.line_status not null,
  weather_feel public.weather_feel not null,
  location_verified boolean not null default false,
  verified_radius_m smallint check (verified_radius_m in (50, 150, 300)),
  photo_count int not null default 0 check (photo_count between 0 and 4),
  photo_label text not null default '상태 제보' check (char_length(photo_label) <= 120),
  helpful_count int not null default 0 check (helpful_count >= 0),
  comment_count int not null default 0 check (comment_count >= 0),
  hidden_at timestamptz,
  created_at timestamptz not null default now(),
  constraint silsigan_posts_verified_radius_matches check (
    (location_verified = true and verified_radius_m is not null)
    or (location_verified = false and verified_radius_m is null)
  )
);

create table if not exists public.silsigan_hashtags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 24 and name !~ '[#[:space:]]'),
  tag_type text not null check (tag_type in ('place', 'status', 'purpose', 'time', 'region')),
  post_count int not null default 0 check (post_count >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.silsigan_post_hashtags (
  post_id uuid not null references public.silsigan_posts(id) on delete cascade,
  hashtag_id uuid not null references public.silsigan_hashtags(id) on delete cascade,
  primary key (post_id, hashtag_id)
);

create table if not exists public.silsigan_post_flags (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.silsigan_posts(id) on delete cascade,
  reporter_id uuid references auth.users(id) on delete set null,
  reason public.flag_reason not null,
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now()
);

create table if not exists public.silsigan_place_follows (
  user_id uuid not null references auth.users(id) on delete cascade,
  place_id text not null references public.silsigan_places(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);

create table if not exists public.silsigan_hashtag_follows (
  user_id uuid not null references auth.users(id) on delete cascade,
  hashtag_id uuid not null references public.silsigan_hashtags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, hashtag_id)
);

create table if not exists public.silsigan_post_saves (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.silsigan_posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table if not exists public.silsigan_post_helpfuls (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.silsigan_posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table if not exists public.user_reputation (
  user_id uuid primary key references auth.users(id) on delete cascade,
  trust_score int not null default 50 check (trust_score between 0 and 100),
  verified_report_count int not null default 0 check (verified_report_count >= 0),
  helpful_received_count int not null default 0 check (helpful_received_count >= 0),
  false_report_count int not null default 0 check (false_report_count >= 0),
  privacy_violation_count int not null default 0 check (privacy_violation_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.silsigan_admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor text not null check (char_length(actor) <= 80),
  action text not null check (action in ('keep', 'hide', 'delete', 'restrict_author')),
  post_id uuid references public.silsigan_posts(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.external_live_sources (
  id uuid primary key default gen_random_uuid(),
  place_id text not null references public.silsigan_places(id) on delete cascade,
  provider text not null check (provider in ('naver', 'kakao', 'its', 'seoul_citydata', 'youtube')),
  source_type text not null check (source_type in ('map', 'traffic', 'cctv', 'citydata', 'livecam')),
  source_name text not null,
  source_url text,
  api_endpoint text,
  latitude double precision,
  longitude double precision,
  coverage_radius_m int not null default 500,
  can_embed boolean not null default false,
  can_analyze boolean not null default false,
  license_note text,
  last_checked_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists silsigan_posts_place_created_idx on public.silsigan_posts(place_id, created_at desc);
create index if not exists silsigan_posts_visible_idx on public.silsigan_posts(created_at desc) where hidden_at is null;
create index if not exists silsigan_post_flags_post_idx on public.silsigan_post_flags(post_id, reason);
create index if not exists silsigan_post_hashtags_hashtag_idx on public.silsigan_post_hashtags(hashtag_id, post_id);
create index if not exists external_live_sources_place_idx on public.external_live_sources(place_id);
create index if not exists external_live_sources_provider_idx on public.external_live_sources(provider, source_type);

alter table public.silsigan_places enable row level security;
alter table public.silsigan_posts enable row level security;
alter table public.silsigan_hashtags enable row level security;
alter table public.silsigan_post_hashtags enable row level security;
alter table public.silsigan_post_flags enable row level security;
alter table public.silsigan_place_follows enable row level security;
alter table public.silsigan_hashtag_follows enable row level security;
alter table public.silsigan_post_saves enable row level security;
alter table public.silsigan_post_helpfuls enable row level security;
alter table public.user_reputation enable row level security;
alter table public.silsigan_admin_audit enable row level security;
alter table public.external_live_sources enable row level security;

drop policy if exists "silsigan places public read" on public.silsigan_places;
create policy "silsigan places public read" on public.silsigan_places for select using (true);

drop policy if exists "silsigan visible posts public read" on public.silsigan_posts;
create policy "silsigan visible posts public read" on public.silsigan_posts for select using (hidden_at is null);

drop policy if exists "silsigan users read own hidden posts" on public.silsigan_posts;
create policy "silsigan users read own hidden posts" on public.silsigan_posts for select using (user_id = auth.uid());

drop policy if exists "silsigan hashtags public read" on public.silsigan_hashtags;
create policy "silsigan hashtags public read" on public.silsigan_hashtags for select using (true);

drop policy if exists "silsigan post hashtags public read" on public.silsigan_post_hashtags;
create policy "silsigan post hashtags public read" on public.silsigan_post_hashtags for select using (true);

drop policy if exists "silsigan users read own flags" on public.silsigan_post_flags;
create policy "silsigan users read own flags" on public.silsigan_post_flags for select using (reporter_id = auth.uid());

drop policy if exists "silsigan users manage own place follows" on public.silsigan_place_follows;
create policy "silsigan users manage own place follows" on public.silsigan_place_follows
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "silsigan users manage own hashtag follows" on public.silsigan_hashtag_follows;
create policy "silsigan users manage own hashtag follows" on public.silsigan_hashtag_follows
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "silsigan users manage own saves" on public.silsigan_post_saves;
create policy "silsigan users manage own saves" on public.silsigan_post_saves
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "silsigan users manage own helpfuls" on public.silsigan_post_helpfuls;
create policy "silsigan users manage own helpfuls" on public.silsigan_post_helpfuls
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "silsigan users read own reputation" on public.user_reputation;
create policy "silsigan users read own reputation" on public.user_reputation for select using (user_id = auth.uid());

drop policy if exists "external sources public read active" on public.external_live_sources;
create policy "external sources public read active" on public.external_live_sources for select using (is_active = true);

insert into public.silsigan_places (id, name, address, category, latitude, longitude, region)
values
  ('ulsan-taehwagang', '태화강 국가정원', '울산 중구 태화강국가정원길', 'tourism', 35.548600, 129.300500, 'ulsan'),
  ('busan-gwangalli', '광안리해수욕장', '부산 수영구 광안해변로', 'tourism', 35.153200, 129.118600, 'busan'),
  ('gyeongju-hwangridan', '황리단길', '경북 경주시 포석로', 'restaurant_cafe', 35.838200, 129.209800, 'gyeongju'),
  ('ulsan-city-hall', '울산광역시청', '울산 남구 중앙로 201', 'public_office', 35.539600, 129.311500, 'ulsan')
on conflict (id) do update set
  name = excluded.name,
  address = excluded.address,
  category = excluded.category,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  region = excluded.region;

grant select, insert, update, delete on all tables in schema public to service_role;

comment on table public.silsigan_posts is 'Place-SNS posts. Exact user coordinates are never stored.';
comment on table public.silsigan_admin_audit is 'Admin moderation action audit trail. Access only through service_role server APIs.';
