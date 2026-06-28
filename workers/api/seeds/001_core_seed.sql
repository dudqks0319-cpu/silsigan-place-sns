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
  ('busan-haeundae', 'busan', '해운대구'),
  ('busan-busanjin', 'busan', '부산진구'),
  ('busan-jung', 'busan', '중구'),
  ('ulsan-jung', 'ulsan', '중구'),
  ('ulsan-nam', 'ulsan', '남구'),
  ('ulsan-ulju', 'ulsan', '울주군'),
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
  ('busan-haeundae', 'busan-haeundae', 'busan', 'tourism', '해운대해수욕장', '부산 해운대구 우동', 35.1587, 129.1604, 'verified', 'active', 1),
  ('busan-jeonpo-cafe', 'busan-busanjin', 'busan', 'restaurant_cafe', '전포카페거리', '부산 부산진구 전포대로', 35.1577, 129.0640, 'verified', 'active', 1),
  ('busan-seomyeon', 'busan-busanjin', 'busan', 'restaurant_cafe', '서면', '부산 부산진구 중앙대로', 35.1579, 129.0592, 'verified', 'active', 1),
  ('busan-nampo-kkangtong', 'busan-jung', 'busan', 'restaurant_cafe', '남포동/깡통시장', '부산 중구 부평1길', 35.1028, 129.0287, 'verified', 'active', 1),
  ('busan-songjeong', 'busan-haeundae', 'busan', 'tourism', '송정', '부산 해운대구 송정동', 35.1786, 129.1997, 'verified', 'active', 1),
  ('ulsan-taehwagang', 'ulsan-jung', 'ulsan', 'tourism', '태화강 국가정원', '울산 중구 태화강국가정원길', 35.5486, 129.3005, 'verified', 'active', 1),
  ('ulsan-samsan', 'ulsan-nam', 'ulsan', 'restaurant_cafe', '울산 삼산동', '울산 남구 삼산동', 35.5396, 129.3387, 'verified', 'active', 1),
  ('ulsan-ganjeolgot', 'ulsan-ulju', 'ulsan', 'tourism', '간절곶', '울산 울주군 서생면 대송리', 35.3590, 129.3600, 'verified', 'active', 1),
  ('gyeongju-hwangridan', 'gyeongju-hwango', 'gyeongju', 'restaurant_cafe', '황리단길', '경북 경주시 포석로', 35.8382, 129.2098, 'verified', 'active', 1),
  ('gyeongju-cheomseongdae', 'gyeongju-hwango', 'gyeongju', 'tourism', '첨성대', '경북 경주시 인왕동', 35.8347, 129.2189, 'verified', 'active', 1),
  ('gyeongju-donggung-wolji', 'gyeongju-hwango', 'gyeongju', 'tourism', '동궁과 월지', '경북 경주시 원화로 102', 35.8346, 129.2265, 'verified', 'active', 1),
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
  ('rank_24_busan-haeundae', 'busan-haeundae', 'busan', 96, 2, 24),
  ('rank_24_busan-jeonpo-cafe', 'busan-jeonpo-cafe', 'busan', 89, 3, 24),
  ('rank_24_busan-seomyeon', 'busan-seomyeon', 'busan', 87, 4, 24),
  ('rank_24_busan-songjeong', 'busan-songjeong', 'busan', 83, 5, 24),
  ('rank_24_busan-nampo-kkangtong', 'busan-nampo-kkangtong', 'busan', 80, 6, 24),
  ('rank_24_gyeongju-hwangridan', 'gyeongju-hwangridan', 'gyeongju', 94, 1, 24),
  ('rank_24_gyeongju-donggung-wolji', 'gyeongju-donggung-wolji', 'gyeongju', 85, 2, 24),
  ('rank_24_gyeongju-cheomseongdae', 'gyeongju-cheomseongdae', 'gyeongju', 82, 3, 24),
  ('rank_24_seoul-yeouido', 'seoul-yeouido', 'seoul', 88, 1, 24),
  ('rank_24_ulsan-taehwagang', 'ulsan-taehwagang', 'ulsan', 92, 1, 24),
  ('rank_24_ulsan-samsan', 'ulsan-samsan', 'ulsan', 78, 2, 24),
  ('rank_24_ulsan-ganjeolgot', 'ulsan-ganjeolgot', 'ulsan', 76, 3, 24),
  ('rank_24_ulsan-city-hall', 'ulsan-city-hall', 'ulsan', 72, 4, 24),
  ('rank_24_jeju-coordinate-review', 'jeju-coordinate-review', 'jeju', 999, 1, 24)
ON CONFLICT(region_id, place_id, window_hours) DO UPDATE SET
  score = excluded.score,
  rank = excluded.rank,
  computed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

INSERT INTO anonymous_users (id, session_hash, trust_score)
VALUES ('anon_seed_public', 'seed_public_session', 72)
ON CONFLICT(id) DO UPDATE SET
  last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

INSERT INTO posts (
  id,
  place_id,
  anonymous_user_id,
  creator_name,
  creator_badge,
  caption,
  crowd_level,
  parking_status,
  line_status,
  weather_feel,
  location_verified,
  verified_radius_m,
  photo_count,
  photo_label,
  helpful_count,
  comment_count,
  hashtag_names,
  created_at,
  updated_at
)
VALUES
  (
    'post_seed_gwangalli_parking',
    'busan-gwangalli',
    'anon_seed_public',
    '부산 해변러',
    '광안리 현장 인증 10회',
    '해변 앞 공영주차장 거의 막혔고 민락 쪽으로 우회하는 게 나아요.',
    'packed',
    'full',
    'medium',
    'good',
    1,
    150,
    2,
    '광안리 주차장 입구',
    31,
    8,
    '["광안리주차살려줘","광안리주차","주차만차","부산","지금"]',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 minutes'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 minutes')
  ),
  (
    'post_seed_hwangridan_waiting',
    'gyeongju-hwangridan',
    'anon_seed_public',
    '경주 골목러',
    '웨이팅 답변왕',
    '메인 골목은 붐비지만 인기 카페 줄은 20분 안쪽입니다.',
    'busy',
    'limited',
    'medium',
    'good',
    1,
    150,
    1,
    '황리단길 카페 대기줄',
    18,
    5,
    '["황리단길웨이팅","경주","사람많음","사진스팟","지금"]',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 minutes'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 minutes')
  ),
  (
    'post_seed_taehwagang_walk',
    'ulsan-taehwagang',
    'anon_seed_public',
    '울산 현장러',
    '태화강 제보왕',
    '국가정원 산책로는 여유 있고 노을 쪽 사진 찍기 좋습니다.',
    'quiet',
    'available',
    'none',
    'good',
    1,
    150,
    3,
    '태화강 국가정원 산책로',
    27,
    4,
    '["태화강산책","울산","한산함","사진스팟","지금"]',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-37 minutes'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-37 minutes')
  ),
  (
    'post_seed_yeouido_picnic',
    'seoul-yeouido',
    'anon_seed_public',
    '서울 한강러',
    '전국 베타 현장 제보',
    '잔디 쪽은 여유 있지만 편의점 앞은 줄이 조금 생겼습니다.',
    'normal',
    'limited',
    'short',
    'good',
    1,
    150,
    1,
    '여의도 한강공원 피크닉 구역',
    16,
    3,
    '["여의도한강공원지금","서울","한강피크닉","줄짧음","지금"]',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-19 minutes'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-19 minutes')
  )
ON CONFLICT(id) DO UPDATE SET
  place_id = excluded.place_id,
  creator_name = excluded.creator_name,
  creator_badge = excluded.creator_badge,
  caption = excluded.caption,
  crowd_level = excluded.crowd_level,
  parking_status = excluded.parking_status,
  line_status = excluded.line_status,
  weather_feel = excluded.weather_feel,
  location_verified = excluded.location_verified,
  verified_radius_m = excluded.verified_radius_m,
  photo_count = excluded.photo_count,
  photo_label = excluded.photo_label,
  helpful_count = excluded.helpful_count,
  comment_count = excluded.comment_count,
  hashtag_names = excluded.hashtag_names,
  status = 'visible',
  hidden_at = NULL,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

INSERT INTO questions (
  id,
  place_id,
  anonymous_user_id,
  question_type,
  body,
  credit_cost,
  answered_report_id,
  status,
  created_at
)
VALUES
  (
    'question_seed_gwangalli',
    'busan-gwangalli',
    'anon_seed_public',
    'parking',
    '센텀 쪽으로 대면 걸어갈 만한가요?',
    1,
    NULL,
    'pending',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 minutes')
  ),
  (
    'question_seed_hwangridan',
    'gyeongju-hwangridan',
    'anon_seed_public',
    'line',
    '황리단길 카페 웨이팅 지금도 긴가요?',
    1,
    NULL,
    'pending',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-18 minutes')
  ),
  (
    'question_seed_yeouido',
    'seoul-yeouido',
    'anon_seed_public',
    'crowd',
    '여의도 잔디밭 지금 자리 잡을 수 있나요?',
    1,
    NULL,
    'pending',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-11 minutes')
  )
ON CONFLICT(id) DO UPDATE SET
  place_id = excluded.place_id,
  question_type = excluded.question_type,
  body = excluded.body,
  credit_cost = excluded.credit_cost,
  answered_report_id = excluded.answered_report_id,
  status = excluded.status;
