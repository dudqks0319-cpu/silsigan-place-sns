PRAGMA foreign_keys = ON;

INSERT INTO regions (id, name, level, parent_region_id, launch_stage, is_active)
VALUES
  ('seoul', '서울', 'city', NULL, 'beta', 1),
  ('busan', '부산', 'city', NULL, 'active', 1),
  ('daegu', '대구', 'city', NULL, 'seed', 0),
  ('incheon', '인천', 'city', NULL, 'seed', 0),
  ('gwangju', '광주', 'city', NULL, 'seed', 0),
  ('daejeon', '대전', 'city', NULL, 'seed', 0),
  ('ulsan', '울산', 'city', NULL, 'active', 1),
  ('sejong', '세종', 'city', NULL, 'seed', 0),
  ('gyeonggi', '경기', 'province', NULL, 'seed', 0),
  ('gangwon', '강원', 'province', NULL, 'seed', 0),
  ('chungbuk', '충북', 'province', NULL, 'seed', 0),
  ('chungnam', '충남', 'province', NULL, 'seed', 0),
  ('jeonbuk', '전북', 'province', NULL, 'seed', 0),
  ('jeonnam', '전남', 'province', NULL, 'seed', 0),
  ('gyeongbuk', '경북', 'province', NULL, 'seed', 0),
  ('gyeongnam', '경남', 'province', NULL, 'seed', 0),
  ('jeju', '제주', 'province', NULL, 'seed', 0)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  level = excluded.level,
  parent_region_id = excluded.parent_region_id,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

INSERT INTO regions (id, name, level, parent_region_id, launch_stage, is_active)
VALUES ('gyeongju', '경주', 'city', 'gyeongbuk', 'active', 1)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  level = excluded.level,
  parent_region_id = excluded.parent_region_id,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
