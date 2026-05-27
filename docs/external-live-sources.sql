-- Draft only: external data sources for place live-status layers.
-- Provider terms, embed permissions, and analysis rights must be checked per source before production use.
create table external_live_sources (
  id uuid primary key default gen_random_uuid(),
  place_id text not null,
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

create index external_live_sources_place_idx on external_live_sources(place_id);
create index external_live_sources_provider_idx on external_live_sources(provider, source_type);
