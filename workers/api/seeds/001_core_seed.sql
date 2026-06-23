PRAGMA foreign_keys = ON;

INSERT INTO regions (id, name, level, parent_region_id, launch_stage, is_active)
VALUES
  ('seoul', '서울', 'city', NULL, 'beta', 1),
  ('busan', '부산', 'city', NULL, 'active', 1),
  ('ulsan', '울산', 'city', NULL, 'active', 1),
  ('gyeongju', '경주', 'city', NULL, 'active', 1),
  ('jeju', '제주', 'province', NULL, 'seed', 0)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  level = excluded.level,
  parent_region_id = excluded.parent_region_id,
  launch_stage = excluded.launch_stage,
  is_active = excluded.is_active,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

INSERT INTO areas (id, region_id, name)
VALUES
  ('seoul-yeongdeungpo', 'seoul', '영등포구'),
  ('busan-suyeong', 'busan', '수영구'),
  ('ulsan-jung', 'ulsan', '중구'),
  ('ulsan-nam', 'ulsan', '남구'),
  ('gyeongju-hwango', 'gyeongju', '황오동'),
  ('jeju-jeju', 'jeju', '제주시')
ON CONFLICT(id) DO UPDATE SET
  region_id = excluded.region_id,
  name = excluded.name;

INSERT INTO categories (id, name, is_sensitive)
VALUES
  ('tourism', '관광지', 0),
  ('restaurant_cafe', '맛집/카페', 0),
  ('public_office', '공공기관', 1)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  is_sensitive = excluded.is_sensitive;

INSERT INTO places (id, area_id, region_id, category_id, name, address, latitude, longitude, coordinate_status, launch_stage, is_active)
VALUES
  ('busan-gwangalli', 'busan-suyeong', 'busan', 'tourism', '광안리해수욕장', '부산 수영구 광안해변로', 35.1532, 129.1186, 'verified', 'active', 1),
  ('ulsan-taehwagang', 'ulsan-jung', 'ulsan', 'tourism', '태화강 국가정원', '울산 중구 태화강국가정원길', 35.5486, 129.3005, 'verified', 'active', 1),
  ('gyeongju-hwangridan', 'gyeongju-hwango', 'gyeongju', 'restaurant_cafe', '황리단길', '경북 경주시 포석로', 35.8382, 129.2098, 'verified', 'active', 1),
  ('ulsan-city-hall', 'ulsan-nam', 'ulsan', 'public_office', '울산광역시청', '울산 남구 중앙로 201', 35.5396, 129.3114, 'verified', 'beta', 1),
  ('seoul-yeouido', 'seoul-yeongdeungpo', 'seoul', 'tourism', '여의도 한강공원', '서울 영등포구 여의동로 330', 37.5265, 126.9349, 'verified', 'beta', 1),
  ('jeju-coordinate-review', 'jeju-jeju', 'jeju', 'tourism', '제주 좌표 검토 장소', '제주 좌표 검증 필요', NULL, NULL, 'TODO_COORDINATE_VERIFY', 'seed', 1)
ON CONFLICT(id) DO UPDATE SET
  area_id = excluded.area_id,
  region_id = excluded.region_id,
  category_id = excluded.category_id,
  name = excluded.name,
  address = excluded.address,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  coordinate_status = excluded.coordinate_status,
  launch_stage = excluded.launch_stage,
  is_active = excluded.is_active,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

INSERT INTO place_rankings (id, place_id, region_id, score, rank, window_hours)
VALUES
  ('rank_24_busan-gwangalli', 'busan-gwangalli', 'busan', 98, 1, 24),
  ('rank_24_gyeongju-hwangridan', 'gyeongju-hwangridan', 'gyeongju', 91, 1, 24),
  ('rank_24_seoul-yeouido', 'seoul-yeouido', 'seoul', 88, 1, 24),
  ('rank_24_ulsan-taehwagang', 'ulsan-taehwagang', 'ulsan', 84, 1, 24),
  ('rank_24_ulsan-city-hall', 'ulsan-city-hall', 'ulsan', 72, 2, 24),
  ('rank_24_jeju-coordinate-review', 'jeju-coordinate-review', 'jeju', 999, 1, 24)
ON CONFLICT(region_id, place_id, window_hours) DO UPDATE SET
  score = excluded.score,
  rank = excluded.rank,
  computed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
