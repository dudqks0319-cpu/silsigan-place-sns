"use client";

import {
  AlertTriangle,
  BadgeCheck,
  Bell,
  Bookmark,
  Camera,
  Car,
  ChevronRight,
  Clock,
  Flag,
  Hash,
  Heart,
  Home,
  Image as ImageIcon,
  LocateFixed,
  Map,
  MapPin,
  MessageCircleQuestion,
  Plus,
  Search,
  Settings,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Ticket,
  User,
  UserX,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import styles from "./SilsiganKoreanUX.module.css";

type View = "home" | "map" | "report" | "questions" | "my" | "place";
type Tone = "good" | "caution" | "avoid" | "empty";
type ReportPreset = "주차 만차" | "줄 길어요" | "사람 많아요" | "한산해요" | "사진스팟 좋아요";
type RegionId =
  | "busan"
  | "ulsan"
  | "gyeongju"
  | "daegu"
  | "changwon"
  | "gimhae"
  | "yangsan"
  | "pohang"
  | "seoul"
  | "jeju"
  | "gangneung"
  | "jeonju"
  | "yeosu"
  | "sokcho";
type LaunchStage = "seed" | "beta" | "active" | "paused";
type RegionTabId = "nearby" | "southeast" | "busan" | "ulsan" | "gyeongju" | "nationwide";

type Region = {
  id: RegionId;
  name: string;
  level: "province" | "city" | "district";
  parentId?: RegionId;
  isActive: boolean;
  isFeatured: boolean;
  launchStage: LaunchStage;
};

type Place = {
  id: string;
  name: string;
  region: string;
  regionId: RegionId;
  launchStage: Exclude<LaunchStage, "paused">;
  category: string;
  address: string;
  distance: string;
  tone: Tone;
  judgement: "가도 좋아요" | "주의" | "지금은 비추" | "정보 없음";
  summary: string;
  reason: string;
  crowd: string;
  parking: string;
  line: string;
  weather: string;
  updated: string;
  verifiedCount: number;
  photoCount: number;
  reportCount: number;
  trustScore: number;
  followers: string;
  x: number;
  y: number;
};

type Post = {
  id: string;
  placeId: string;
  author: string;
  badge: string;
  caption: string;
  minutesAgo: number;
  verified: boolean;
  photo: boolean;
  helpful: number;
  tags: string[];
  tone: Tone;
};

type Question = {
  id: string;
  placeId: string;
  text: string;
  type: "주차" | "줄" | "사진" | "아이랑";
  minutesAgo: number;
  reward: string;
};

type Challenge = {
  id: string;
  regionId: RegionId;
  title: string;
  hashtagName: string;
  description: string;
  rewardBadge: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
};

const regions: Region[] = [
  { id: "busan", name: "부산", level: "city", isActive: true, isFeatured: true, launchStage: "active" },
  { id: "ulsan", name: "울산", level: "city", isActive: true, isFeatured: true, launchStage: "active" },
  { id: "gyeongju", name: "경주", level: "city", isActive: true, isFeatured: true, launchStage: "active" },
  { id: "daegu", name: "대구", level: "city", isActive: true, isFeatured: false, launchStage: "seed" },
  { id: "changwon", name: "창원", level: "city", isActive: true, isFeatured: false, launchStage: "seed" },
  { id: "gimhae", name: "김해", level: "city", isActive: true, isFeatured: false, launchStage: "seed" },
  { id: "yangsan", name: "양산", level: "city", isActive: true, isFeatured: false, launchStage: "seed" },
  { id: "pohang", name: "포항", level: "city", isActive: true, isFeatured: false, launchStage: "seed" },
  { id: "seoul", name: "서울", level: "city", isActive: true, isFeatured: false, launchStage: "seed" },
  { id: "jeju", name: "제주", level: "province", isActive: true, isFeatured: false, launchStage: "seed" },
  { id: "gangneung", name: "강릉", level: "city", isActive: true, isFeatured: false, launchStage: "seed" },
  { id: "jeonju", name: "전주", level: "city", isActive: true, isFeatured: false, launchStage: "seed" },
  { id: "yeosu", name: "여수", level: "city", isActive: true, isFeatured: false, launchStage: "seed" },
  { id: "sokcho", name: "속초", level: "city", isActive: true, isFeatured: false, launchStage: "seed" },
];

const regionTabs: Array<{ id: RegionTabId; label: string; helper: string }> = [
  { id: "nearby", label: "내 주변", helper: "가까운 active 지역 우선" },
  { id: "southeast", label: "동남권", helper: "부산·울산·경주 중심" },
  { id: "busan", label: "부산", helper: "active" },
  { id: "ulsan", label: "울산", helper: "active" },
  { id: "gyeongju", label: "경주", helper: "active" },
  { id: "nationwide", label: "전국", helper: "전국 주요 장소 베타" },
];

const places: Place[] = [
  {
    id: "busan-gwangalli",
    name: "광안리해수욕장",
    region: "부산",
    regionId: "busan",
    launchStage: "active",
    category: "관광지",
    address: "부산 수영구 광안해변로",
    distance: "38km",
    tone: "avoid",
    judgement: "지금은 비추",
    summary: "주차 만차, 사람 매우 많음",
    reason: "주차 만차 제보 3건, 사람 많음 제보 2건이 최근 30분 안에 올라왔어요.",
    crowd: "매우 많음",
    parking: "만차",
    line: "보통",
    weather: "맑음",
    updated: "12분 전",
    verifiedCount: 2,
    photoCount: 3,
    reportCount: 5,
    trustScore: 88,
    followers: "1,240",
    x: 68,
    y: 42,
  },
  {
    id: "ulsan-taehwagang",
    name: "태화강 국가정원",
    region: "울산",
    regionId: "ulsan",
    launchStage: "active",
    category: "관광지",
    address: "울산 중구 태화강국가정원길",
    distance: "1.2km",
    tone: "good",
    judgement: "가도 좋아요",
    summary: "산책로 한산, 주차 여유",
    reason: "현장 인증 2건이 모두 한산하다고 알려줬고, 사진 제보도 3장 있어요.",
    crowd: "한산",
    parking: "여유",
    line: "없음",
    weather: "맑음",
    updated: "18분 전",
    verifiedCount: 2,
    photoCount: 3,
    reportCount: 4,
    trustScore: 91,
    followers: "820",
    x: 28,
    y: 48,
  },
  {
    id: "gyeongju-hwangridan",
    name: "황리단길",
    region: "경주",
    regionId: "gyeongju",
    launchStage: "active",
    category: "맛집거리",
    address: "경북 경주시 포석로",
    distance: "29km",
    tone: "caution",
    judgement: "주의",
    summary: "사람 많음, 웨이팅 보통",
    reason: "카페 대기 제보가 늘고 있어요. 인기 매장은 20분 이상 기다릴 수 있어요.",
    crowd: "많음",
    parking: "거의 없음",
    line: "보통",
    weather: "맑음",
    updated: "24분 전",
    verifiedCount: 1,
    photoCount: 2,
    reportCount: 4,
    trustScore: 82,
    followers: "940",
    x: 51,
    y: 31,
  },
  {
    id: "busan-haeundae",
    name: "해운대해수욕장",
    region: "부산",
    regionId: "busan",
    launchStage: "active",
    category: "관광지",
    address: "부산 해운대구 우동",
    distance: "42km",
    tone: "caution",
    judgement: "주의",
    summary: "사람 많음, 주차 확인 필요",
    reason: "해변 중앙은 붐비지만 송정 방향은 비교적 여유가 있어요.",
    crowd: "많음",
    parking: "거의 없음",
    line: "짧음",
    weather: "맑음",
    updated: "21분 전",
    verifiedCount: 2,
    photoCount: 2,
    reportCount: 3,
    trustScore: 84,
    followers: "2,100",
    x: 75,
    y: 36,
  },
  {
    id: "ulsan-grand-park",
    name: "울산대공원",
    region: "울산",
    regionId: "ulsan",
    launchStage: "beta",
    category: "공원",
    address: "울산 남구 대공원로",
    distance: "2.8km",
    tone: "empty",
    judgement: "정보 없음",
    summary: "최근 제보가 부족해요",
    reason: "최근 3시간 안에 현장 인증 제보가 없어요. 근처 사용자에게 물어볼 수 있습니다.",
    crowd: "정보 없음",
    parking: "정보 없음",
    line: "정보 없음",
    weather: "맑음",
    updated: "제보 대기",
    verifiedCount: 0,
    photoCount: 0,
    reportCount: 0,
    trustScore: 42,
    followers: "330",
    x: 36,
    y: 58,
  },
  {
    id: "daegu-dongseongro",
    name: "대구 동성로",
    region: "대구",
    regionId: "daegu",
    launchStage: "seed",
    category: "맛집거리",
    address: "대구 중구 동성로",
    distance: "74km",
    tone: "empty",
    judgement: "정보 없음",
    summary: "최근 제보 부족",
    reason: "전국 주요 장소 베타에 포함됐지만 아직 최근 현장 인증이 부족해요.",
    crowd: "정보 없음",
    parking: "정보 없음",
    line: "정보 없음",
    weather: "정보 없음",
    updated: "제보 대기",
    verifiedCount: 0,
    photoCount: 0,
    reportCount: 0,
    trustScore: 35,
    followers: "120",
    x: 59,
    y: 64,
  },
  {
    id: "seoul-seongsu",
    name: "성수 카페거리",
    region: "서울",
    regionId: "seoul",
    launchStage: "seed",
    category: "카페거리",
    address: "서울 성동구 성수동",
    distance: "306km",
    tone: "empty",
    judgement: "정보 없음",
    summary: "최근 제보 부족",
    reason: "전국 베타 검색은 가능하지만, 아직 실시간 추천에 쓸 제보 밀도는 부족해요.",
    crowd: "정보 없음",
    parking: "정보 없음",
    line: "정보 없음",
    weather: "정보 없음",
    updated: "제보 대기",
    verifiedCount: 0,
    photoCount: 0,
    reportCount: 0,
    trustScore: 30,
    followers: "210",
    x: 45,
    y: 23,
  },
  {
    id: "jeju-seongsan",
    name: "성산일출봉",
    region: "제주",
    regionId: "jeju",
    launchStage: "seed",
    category: "관광지",
    address: "제주 서귀포시 성산읍",
    distance: "355km",
    tone: "empty",
    judgement: "정보 없음",
    summary: "최근 제보 부족",
    reason: "여행지 실시간 확장 후보입니다. 첫 제보가 쌓이면 추천에 반영돼요.",
    crowd: "정보 없음",
    parking: "정보 없음",
    line: "정보 없음",
    weather: "정보 없음",
    updated: "제보 대기",
    verifiedCount: 0,
    photoCount: 0,
    reportCount: 0,
    trustScore: 28,
    followers: "180",
    x: 30,
    y: 78,
  },
];

const posts: Post[] = [
  {
    id: "post-gwangalli-1",
    placeId: "busan-gwangalli",
    author: "부산 해변러",
    badge: "광안리 현장 인증 10회",
    caption: "주차 만차입니다. 근처 공영주차장도 거의 찼어요. 민락 쪽 우회 추천해요.",
    minutesAgo: 12,
    verified: true,
    photo: true,
    helpful: 32,
    tags: ["광안리주차", "주차만차", "부산", "지금"],
    tone: "avoid",
  },
  {
    id: "post-taehwa-1",
    placeId: "ulsan-taehwagang",
    author: "울산 산책러",
    badge: "태화강 제보왕",
    caption: "산책로는 여유 있고 노을 쪽 사진 찍기 좋아요. 주차도 아직 여유 있습니다.",
    minutesAgo: 18,
    verified: true,
    photo: true,
    helpful: 21,
    tags: ["태화강산책", "울산", "한산함", "사진스팟"],
    tone: "good",
  },
  {
    id: "post-hwang-1",
    placeId: "gyeongju-hwangridan",
    author: "경주 골목러",
    badge: "웨이팅 답변왕",
    caption: "메인 골목은 붐비지만 카페 대기는 20분 안쪽이에요. 주차는 어렵습니다.",
    minutesAgo: 24,
    verified: false,
    photo: true,
    helpful: 18,
    tags: ["황리단길웨이팅", "경주", "사람많음"],
    tone: "caution",
  },
];

const questions: Question[] = [
  { id: "q1", placeId: "busan-gwangalli", text: "지금 주차 자리 있나요?", type: "주차", minutesAgo: 10, reward: "+1" },
  { id: "q2", placeId: "gyeongju-hwangridan", text: "줄 많이 긴가요?", type: "줄", minutesAgo: 15, reward: "+1" },
  { id: "q3", placeId: "ulsan-taehwagang", text: "사진으로 볼 수 있나요?", type: "사진", minutesAgo: 20, reward: "+2" },
  { id: "q4", placeId: "busan-haeundae", text: "아이랑 가도 괜찮나요?", type: "아이랑", minutesAgo: 30, reward: "+1" },
];

const challenges: Challenge[] = [
  {
    id: "challenge-gwangalli-parking",
    regionId: "busan",
    title: "광안리 주차 살려줘",
    hashtagName: "광안리주차살려줘",
    description: "광안리 주변 주차 상황만 알려줘도 헛걸음을 줄일 수 있어요.",
    rewardBadge: "부산 주차 도우미",
    startsAt: "2026-05-25",
    endsAt: "2026-06-02",
    isActive: true,
  },
  {
    id: "challenge-hwangridan-waiting",
    regionId: "gyeongju",
    title: "황리단길 웨이팅 제보",
    hashtagName: "황리단길웨이팅",
    description: "카페와 맛집 줄 길이를 10초 제보로 모읍니다.",
    rewardBadge: "경주 웨이팅 답변왕",
    startsAt: "2026-05-25",
    endsAt: "2026-06-02",
    isActive: true,
  },
  {
    id: "challenge-taehwagang-walk",
    regionId: "ulsan",
    title: "태화강 산책 타이밍",
    hashtagName: "태화강산책",
    description: "산책로, 주차, 사진스팟 상태를 알려주세요.",
    rewardBadge: "태화강 제보왕",
    startsAt: "2026-05-25",
    endsAt: "2026-06-02",
    isActive: true,
  },
  {
    id: "challenge-seongsu-line",
    regionId: "seoul",
    title: "성수 카페 줄 확인",
    hashtagName: "성수카페줄",
    description: "전국 베타 seed 챌린지입니다. 제보가 쌓이면 추천 지역으로 승격됩니다.",
    rewardBadge: "서울 베타 제보자",
    startsAt: "2026-05-25",
    endsAt: "2026-06-02",
    isActive: false,
  },
];

const navItems: Array<{ id: View; label: string; icon: LucideIcon }> = [
  { id: "home", label: "홈", icon: Home },
  { id: "map", label: "지도", icon: Map },
  { id: "report", label: "제보하기", icon: Plus },
  { id: "questions", label: "질문", icon: MessageCircleQuestion },
  { id: "my", label: "마이", icon: User },
];

const quickPresets: ReportPreset[] = ["주차 만차", "줄 길어요", "사람 많아요", "한산해요", "사진스팟 좋아요"];
const mapFilters = ["주차 가능", "사람 적음", "줄 없음", "사진 있음", "30분 이내"];
const reportReasons = [
  { icon: UserX, title: "얼굴이 보여요", desc: "개인 식별이 가능한 얼굴이 노출되어 있어요." },
  { icon: Car, title: "차량번호가 보여요", desc: "차량번호가 식별 가능해요." },
  { icon: ShieldAlert, title: "민감정보가 있어요", desc: "위치, 연락처, 신분증 등 민감정보가 있어요." },
  { icon: X, title: "허위 정보예요", desc: "사실과 다른 정보로 보입니다." },
  { icon: AlertTriangle, title: "광고/스팸이에요", desc: "광고나 스팸성 게시물이에요." },
  { icon: Bookmark, title: "기타", desc: "기타 사유로 신고합니다." },
];

export default function SilsiganKoreanUX() {
  const [view, setView] = useState<View>("home");
  const [selectedPlaceId, setSelectedPlaceId] = useState("busan-gwangalli");
  const [region, setRegion] = useState<RegionTabId>("nearby");
  const [activeMapFilter, setActiveMapFilter] = useState(mapFilters[0]);
  const [activePlaceTab, setActivePlaceTab] = useState("실시간");
  const [reportPreset, setReportPreset] = useState<ReportPreset>("주차 만차");
  const [comment, setComment] = useState("");
  const [photoAttached, setPhotoAttached] = useState(true);
  const [fieldVerified, setFieldVerified] = useState(false);
  const [flagOpen, setFlagOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [followed, setFollowed] = useState<Set<string>>(new Set(["busan-gwangalli"]));
  const [saved, setSaved] = useState<Set<string>>(new Set(["post-gwangalli-1"]));
  const [helpful, setHelpful] = useState<Set<string>>(new Set());

  const selectedPlace = useMemo(
    () => places.find((place) => place.id === selectedPlaceId) ?? places[0],
    [selectedPlaceId],
  );

  const visiblePlaces = useMemo(() => {
    const regionIds = regionIdsForTab(region);
    return places.filter((place) => regionIds === "all" || regionIds.includes(place.regionId));
  }, [region]);

  const visiblePosts = useMemo(() => {
    const visiblePlaceIds = new Set(visiblePlaces.map((place) => place.id));
    return posts.filter((post) => visiblePlaceIds.has(post.placeId));
  }, [visiblePlaces]);

  const visibleChallenges = useMemo(() => {
    const regionIds = regionIdsForTab(region);
    return challenges.filter((challenge) => {
      if (region !== "nationwide" && !challenge.isActive) return false;
      return regionIds === "all" || regionIds.includes(challenge.regionId);
    });
  }, [region]);

  const selectedPosts = posts.filter((post) => post.placeId === selectedPlace.id);
  const selectedQuestions = questions.filter((question) => question.placeId === selectedPlace.id);

  const openPlace = (placeId: string) => {
    setSelectedPlaceId(placeId);
    setActivePlaceTab("실시간");
    setView("place");
  };

  const toggleFollow = (placeId: string) => {
    setFollowed((current) => {
      const next = new Set(current);
      if (next.has(placeId)) {
        next.delete(placeId);
      } else {
        next.add(placeId);
      }
      return next;
    });
  };

  const toggleSave = (postId: string) => {
    setSaved((current) => {
      const next = new Set(current);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });
  };

  const toggleHelpful = (postId: string) => {
    setHelpful((current) => {
      if (current.has(postId)) return current;
      const next = new Set(current);
      next.add(postId);
      return next;
    });
  };

  return (
    <main className={styles.stage}>
      <section className={styles.appShell} aria-label="#실시간 한국형 모바일 UI">
        <div className={styles.phone}>
          <StatusBar />
          <TopBar
            view={view}
            place={selectedPlace}
            onBack={() => setView("home")}
            onShare={() => setShareOpen(true)}
          />
          <section className={styles.body}>
            {view === "home" && (
              <HomeScreen
                region={region}
                places={visiblePlaces}
                allPlaces={places}
                posts={visiblePosts}
                challenges={visibleChallenges}
                onRegionChange={setRegion}
                onOpenPlace={openPlace}
                onGoMap={() => setView("map")}
                onGoReport={() => setView("report")}
                onFlag={() => setFlagOpen(true)}
                onHelpful={toggleHelpful}
                onSave={toggleSave}
                onShare={() => setShareOpen(true)}
                helpful={helpful}
                saved={saved}
              />
            )}

            {view === "map" && (
              <MapScreen
                places={visiblePlaces}
                selectedPlace={selectedPlace}
                activeFilter={activeMapFilter}
                onFilterChange={setActiveMapFilter}
                onOpenPlace={openPlace}
                onReport={() => setView("report")}
              />
            )}

            {view === "place" && (
              <PlaceScreen
                place={selectedPlace}
                posts={selectedPosts}
                questions={selectedQuestions}
                activeTab={activePlaceTab}
                followed={followed.has(selectedPlace.id)}
                saved={saved}
                helpful={helpful}
                onChangeTab={setActivePlaceTab}
                onFollow={() => toggleFollow(selectedPlace.id)}
                onGoReport={() => setView("report")}
                onGoQuestion={() => setView("questions")}
                onFlag={() => setFlagOpen(true)}
                onHelpful={toggleHelpful}
                onSave={toggleSave}
                onShare={() => setShareOpen(true)}
                onOpenPlace={openPlace}
              />
            )}

            {view === "report" && (
              <ReportScreen
                place={selectedPlace}
                reportPreset={reportPreset}
                comment={comment}
                photoAttached={photoAttached}
                fieldVerified={fieldVerified}
                onPreset={(preset) => {
                  setReportPreset(preset);
                  setComment(presetComment(preset));
                }}
                onComment={setComment}
                onPhotoToggle={() => setPhotoAttached((value) => !value)}
                onVerify={() => setFieldVerified(true)}
                onSubmit={() => setView("place")}
              />
            )}

            {view === "questions" && (
              <QuestionScreen
                place={selectedPlace}
                questions={questions}
                onGoReport={() => setView("report")}
              />
            )}

            {view === "my" && (
              <MyScreen
                followedPlaces={places.filter((place) => followed.has(place.id))}
                savedPosts={posts.filter((post) => saved.has(post.id))}
              />
            )}
          </section>
          <BottomNav active={view} onChange={setView} />
          {flagOpen && <FlagModal onClose={() => setFlagOpen(false)} />}
          {shareOpen && <ShareSheet place={selectedPlace} onClose={() => setShareOpen(false)} />}
        </div>

        <aside className={styles.desktopPanel}>
          <p className={styles.eyebrow}>Desktop Preview</p>
          <h2>한국형 장소 실시간 판단 앱</h2>
          <p>네이버지도처럼 익숙하게, 당근처럼 믿을 수 있게, Waze처럼 빠르게 제보하는 UX입니다.</p>
          <div className={styles.desktopStats}>
            <Stat label="장소" value={String(places.length)} />
            <Stat label="현장 제보" value={String(posts.length)} />
            <Stat label="질문" value={String(questions.length)} />
          </div>
          <div className={styles.desktopCard}>
            <strong>핵심 차별점</strong>
            <span>“어디 있는지”가 아니라 “지금 가도 되는지”를 알려줍니다.</span>
          </div>
        </aside>
      </section>
    </main>
  );
}

function StatusBar() {
  return (
    <div className={styles.statusBar}>
      <span>9:41</span>
      <span>● ● ▰</span>
    </div>
  );
}

function TopBar({
  view,
  place,
  onBack,
  onShare,
}: {
  view: View;
  place: Place;
  onBack: () => void;
  onShare: () => void;
}) {
  const isDetail = view === "place" || view === "report" || view === "questions";
  const title =
    view === "place"
      ? place.name
      : view === "map"
        ? "지도"
        : view === "report"
          ? `${place.name} 현장 제보`
          : view === "questions"
            ? "질문 / 퀘스트"
            : view === "my"
              ? "마이"
              : "실시간";

  return (
    <header className={styles.topBar}>
      <button type="button" onClick={isDetail ? onBack : undefined} aria-label={isDetail ? "뒤로가기" : "안전정책"}>
        {isDetail ? <X size={18} /> : <ShieldCheck size={18} />}
      </button>
      <div>
        <p>전국 주요 장소 베타 · 부산/울산/경주 active</p>
        <h1>{title}</h1>
      </div>
      <button type="button" onClick={view === "place" ? onShare : undefined} aria-label={view === "place" ? "공유" : "알림"}>
        {view === "place" ? <Share2 size={18} /> : <Bell size={18} />}
      </button>
    </header>
  );
}

function HomeScreen({
  region,
  places,
  allPlaces,
  posts,
  challenges,
  onRegionChange,
  onOpenPlace,
  onGoMap,
  onGoReport,
  onFlag,
  onHelpful,
  onSave,
  onShare,
  helpful,
  saved,
}: {
  region: RegionTabId;
  places: Place[];
  allPlaces: Place[];
  posts: Post[];
  challenges: Challenge[];
  onRegionChange: (region: RegionTabId) => void;
  onOpenPlace: (placeId: string) => void;
  onGoMap: () => void;
  onGoReport: () => void;
  onFlag: () => void;
  onHelpful: (postId: string) => void;
  onSave: (postId: string) => void;
  onShare: () => void;
  helpful: Set<string>;
  saved: Set<string>;
}) {
  const good = places.filter((place) => place.tone === "good");
  const caution = places.filter((place) => place.tone === "caution");
  const avoid = places.filter((place) => place.tone === "avoid");
  const infoGaps = places.filter((place) => place.tone === "empty" || place.launchStage === "seed");
  const activeRegions = regions.filter((item) => item.launchStage === "active").map((item) => item.name).join(" · ");
  const currentTab = regionTabs.find((item) => item.id === region) ?? regionTabs[0];

  return (
    <div className={styles.stack}>
      <section className={styles.regionTabs}>
        {regionTabs.map((item) => (
          <button key={item.id} className={region === item.id ? styles.selected : ""} type="button" onClick={() => onRegionChange(item.id)}>
            {item.label}
          </button>
        ))}
      </section>

      <section className={region === "nationwide" ? styles.nationwideBanner : styles.regionGuide}>
        <div>
          <span>{region === "nationwide" ? "전국 베타" : currentTab.label}</span>
          <strong>{region === "nationwide" ? "전국 주요 장소 베타 오픈" : `${activeRegions} 실시간 운영 중`}</strong>
          <p>{region === "nationwide" ? "아직 일부 지역은 최근 제보가 부족해요. 정보 없음은 한산함으로 판단하지 않습니다." : currentTab.helper}</p>
        </div>
      </section>

      <section className={styles.searchCard}>
        <div className={styles.searchBox}>
          <Search size={18} />
          <span>장소명, 주차, 줄, 사람으로 검색</span>
        </div>
        <div className={styles.keywordRow}>
          {["광안리 주차", "황리단길 웨이팅", "태화강 산책"].map((keyword) => (
            <button key={keyword} type="button">{keyword}</button>
          ))}
        </div>
      </section>

      <section className={styles.judgementGrid}>
        <JudgementCard title="가도 좋아요" count={good.length} tone="good" places={good} onOpenPlace={onOpenPlace} />
        <JudgementCard title="주의" count={caution.length} tone="caution" places={caution} onOpenPlace={onOpenPlace} />
        <JudgementCard title="지금은 비추" count={avoid.length} tone="avoid" places={avoid} onOpenPlace={onOpenPlace} />
      </section>

      <section className={styles.challengeStack}>
        <SectionTitle title={region === "nationwide" ? "지역별 챌린지" : "이번 주 실시간 챌린지"} caption="active 지역 우선" />
        {challenges.slice(0, region === "nationwide" ? 3 : 1).map((challenge) => (
          <ChallengeCard key={challenge.id} challenge={challenge} onJoin={onGoReport} />
        ))}
      </section>

      {infoGaps.length > 0 && <InfoGapCard places={infoGaps.slice(0, 3)} onOpenPlace={onOpenPlace} onGoReport={onGoReport} />}

      <SectionTitle title="실시간 피드" caption="최근 현장 인증 우선" />
      <div className={styles.feedList}>
        {posts.map((post) => {
          const place = allPlaces.find((item) => item.id === post.placeId) ?? allPlaces[0];
          return (
            <FeedCard
              key={post.id}
              post={post}
              place={place}
              helpful={helpful.has(post.id)}
              saved={saved.has(post.id)}
              onOpen={() => onOpenPlace(place.id)}
              onHelpful={() => onHelpful(post.id)}
              onSave={() => onSave(post.id)}
              onShare={onShare}
              onFlag={onFlag}
            />
          );
        })}
        {posts.length === 0 && <p className={styles.emptyText}>이 지역은 아직 최근 제보가 부족해요. 첫 제보나 질문으로 피드를 시작할 수 있습니다.</p>}
      </div>

      <section className={styles.ctaGrid}>
        <button type="button" onClick={onGoMap}>
          <MapPin size={19} />
          <strong>내 주변 지도</strong>
          <span>상태 핀으로 보기</span>
        </button>
        <button type="button" onClick={onGoReport}>
          <Camera size={19} />
          <strong>10초 제보</strong>
          <span>사진 없이도 가능</span>
        </button>
      </section>
    </div>
  );
}

function JudgementCard({
  title,
  count,
  tone,
  places,
  onOpenPlace,
}: {
  title: string;
  count: number;
  tone: Tone;
  places: Place[];
  onOpenPlace: (placeId: string) => void;
}) {
  return (
    <article className={`${styles.judgementCard} ${toneClass(tone)}`}>
      <span>{title}</span>
      <strong>{count}곳</strong>
      {places.slice(0, 2).map((place) => (
        <button key={place.id} type="button" onClick={() => onOpenPlace(place.id)}>
          {place.name}
          <small>{place.updated} · {place.summary}</small>
        </button>
      ))}
      {places.length === 0 && <p>최근 제보가 부족해요.</p>}
    </article>
  );
}

function ChallengeCard({ challenge, onJoin }: { challenge: Challenge; onJoin: () => void }) {
  const region = regions.find((item) => item.id === challenge.regionId);

  return (
    <article className={styles.challengeCard}>
      <div>
        <span>{region?.name ?? "전국"} · {challenge.rewardBadge}</span>
        <h2>#{challenge.hashtagName}</h2>
        <p>{challenge.description}</p>
      </div>
      <button type="button" onClick={onJoin}>{challenge.isActive ? "참여하기" : "알림 받기"}</button>
    </article>
  );
}

function InfoGapCard({
  places,
  onOpenPlace,
  onGoReport,
}: {
  places: Place[];
  onOpenPlace: (placeId: string) => void;
  onGoReport: () => void;
}) {
  return (
    <section className={styles.infoGapCard}>
      <div className={styles.infoGapHeader}>
        <span>정보 없음 ≠ 한산함</span>
        <h2>아직 최근 제보가 없어요</h2>
        <p>근처 사용자에게 물어보거나 첫 제보를 남기면 이 장소의 판단이 살아납니다.</p>
      </div>
      <div className={styles.infoGapList}>
        {places.map((place) => (
          <article key={place.id}>
            <div>
              <strong>{place.name}</strong>
              <span>{place.region} · {place.launchStage === "seed" ? "전국 베타 seed" : "최근 제보 부족"}</span>
            </div>
            <div>
              <button type="button" onClick={() => onOpenPlace(place.id)}>물어보기</button>
              <button type="button" onClick={onGoReport}>첫 제보하기</button>
              <button type="button" onClick={() => onOpenPlace(place.id)}>이 장소 팔로우</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MapScreen({
  places,
  selectedPlace,
  activeFilter,
  onFilterChange,
  onOpenPlace,
  onReport,
}: {
  places: Place[];
  selectedPlace: Place;
  activeFilter: string;
  onFilterChange: (filter: string) => void;
  onOpenPlace: (placeId: string) => void;
  onReport: () => void;
}) {
  return (
    <div className={styles.mapScreen}>
      <div className={styles.mapSearch}>
        <div className={styles.searchBox}>
          <Search size={17} />
          <span>장소명 검색</span>
        </div>
      </div>
      <div className={styles.filterRow}>
        {mapFilters.map((filter) => (
          <button key={filter} className={activeFilter === filter ? styles.selected : ""} type="button" onClick={() => onFilterChange(filter)}>
            {filter}
          </button>
        ))}
      </div>

      <section className={styles.mapCanvas}>
        <div className={styles.fakeMapLines} />
        <button className={styles.researchButton} type="button">이 지역 다시 검색</button>
        <button className={styles.trafficButton} type="button">교통정보</button>
        {places.map((place) => (
          <button
            key={place.id}
            className={`${styles.mapPin} ${toneClass(place.tone)} ${place.launchStage === "seed" ? styles.seedPin : ""}`}
            style={{ left: `${place.x}%`, top: `${place.y}%` }}
            type="button"
            onClick={() => onOpenPlace(place.id)}
          >
            {pinLabel(place)}
          </button>
        ))}
      </section>

      <section className={styles.bottomSheet}>
        <div className={styles.sheetHandle} />
        <div className={styles.sheetHeader}>
          <div>
            <p>선택된 장소</p>
            <h2>{selectedPlace.name}</h2>
          </div>
          <span className={`${styles.statusChip} ${toneClass(selectedPlace.tone)}`}>{selectedPlace.judgement}</span>
        </div>
        <p>{selectedPlace.reason}</p>
        {selectedPlace.launchStage === "seed" && (
          <p className={styles.seedNotice}>전국 베타 seed 장소입니다. 실시간 추천에는 충분한 제보가 쌓인 뒤 반영돼요.</p>
        )}
        <div className={styles.evidenceRow}>
          <Stat label="현장 인증" value={`${selectedPlace.verifiedCount}건`} />
          <Stat label="사진" value={`${selectedPlace.photoCount}장`} />
          <Stat label="제보" value={`${selectedPlace.reportCount}건`} />
        </div>
        <div className={styles.buttonPair}>
          <button type="button" onClick={() => onOpenPlace(selectedPlace.id)}>물어보기</button>
          <button type="button" onClick={onReport}>제보하기</button>
        </div>
      </section>
    </div>
  );
}

function PlaceScreen({
  place,
  posts,
  questions,
  activeTab,
  followed,
  saved,
  helpful,
  onChangeTab,
  onFollow,
  onGoReport,
  onGoQuestion,
  onFlag,
  onHelpful,
  onSave,
  onShare,
  onOpenPlace,
}: {
  place: Place;
  posts: Post[];
  questions: Question[];
  activeTab: string;
  followed: boolean;
  saved: Set<string>;
  helpful: Set<string>;
  onChangeTab: (tab: string) => void;
  onFollow: () => void;
  onGoReport: () => void;
  onGoQuestion: () => void;
  onFlag: () => void;
  onHelpful: (postId: string) => void;
  onSave: (postId: string) => void;
  onShare: () => void;
  onOpenPlace: (placeId: string) => void;
}) {
  const tabs = ["실시간", "사진", "질문", "해시태그", "근처"];
  const nearby = places.filter((item) => item.regionId === place.regionId && item.id !== place.id);
  const hasInfoGap = place.tone === "empty" || place.launchStage === "seed";

  return (
    <div className={styles.stack}>
      <section className={`${styles.placeHero} ${toneClass(place.tone)}`}>
        <span>{place.region} · {place.category}</span>
        <h2>{place.name}</h2>
        <p>{place.address}</p>
      </section>

      <section className={styles.finalCard}>
        <div>
          <span className={`${styles.statusChip} ${toneClass(place.tone)}`}>{place.judgement}</span>
          <h2>{place.reason}</h2>
        </div>
        <button className={followed ? styles.followed : ""} type="button" onClick={onFollow}>
          {followed ? "팔로잉" : "팔로우"}
        </button>
      </section>

      {hasInfoGap && (
        <section className={styles.infoGapDetail}>
          <strong>최근 제보 부족</strong>
          <p>정보 없음은 한산함이 아닙니다. 지금 상황이 궁금하면 질문하거나 첫 제보를 남겨주세요.</p>
          <div>
            <button type="button" onClick={onGoQuestion}>물어보기</button>
            <button type="button" onClick={onGoReport}>첫 제보하기</button>
            <button type="button" onClick={onFollow}>{followed ? "팔로잉" : "이 장소 팔로우"}</button>
          </div>
        </section>
      )}

      <section className={styles.evidenceGrid}>
        <Stat label="마지막 업데이트" value={place.updated} />
        <Stat label="현장 인증" value={`${place.verifiedCount}건`} />
        <Stat label="사진" value={`${place.photoCount}장`} />
        <Stat label="상태 제보" value={`${place.reportCount}건`} />
      </section>

      <section className={styles.trustCard}>
        <div>
          <p>현장 신뢰도</p>
          <strong>{place.trustScore}점</strong>
          <span>현장 인증, 도움돼요, 신고 처리 결과 기준</span>
        </div>
        <BadgeCheck size={28} />
      </section>

      <section className={styles.tabRow}>
        {tabs.map((tab) => (
          <button key={tab} className={activeTab === tab ? styles.selected : ""} type="button" onClick={() => onChangeTab(tab)}>
            {tab}
          </button>
        ))}
      </section>

      {activeTab === "실시간" && (
        <div className={styles.feedList}>
          {posts.map((post) => (
            <FeedCard
              key={post.id}
              post={post}
              place={place}
              helpful={helpful.has(post.id)}
              saved={saved.has(post.id)}
              onOpen={() => undefined}
              onHelpful={() => onHelpful(post.id)}
              onSave={() => onSave(post.id)}
              onShare={onShare}
              onFlag={onFlag}
            />
          ))}
        </div>
      )}

      {activeTab === "사진" && (
        <section className={styles.photoGrid}>
          {posts.filter((post) => post.photo).map((post) => (
            <article key={post.id} className={`${styles.photoCard} ${toneClass(post.tone)}`}>
              <Camera size={18} />
              <strong>{post.caption}</strong>
            </article>
          ))}
        </section>
      )}

      {activeTab === "질문" && (
        <section className={styles.questionList}>
          {questions.map((question) => <QuestionItem key={question.id} question={question} />)}
          {questions.length === 0 && <p className={styles.emptyText}>아직 질문이 없어요. 지금 궁금한 걸 물어보세요.</p>}
        </section>
      )}

      {activeTab === "해시태그" && (
        <section className={styles.hashtagCloud}>
          {[...new Set(posts.flatMap((post) => post.tags))].map((tag) => (
            <button key={tag} type="button"><Hash size={13} />{tag}</button>
          ))}
        </section>
      )}

      {activeTab === "근처" && (
        <section className={styles.nearbyList}>
          {nearby.map((item) => (
            <button key={item.id} type="button" onClick={() => onOpenPlace(item.id)}>
              <MapPin size={17} />
              <div>
                <strong>{item.name}</strong>
                <span>{item.summary}</span>
              </div>
              <small>{item.judgement}</small>
            </button>
          ))}
        </section>
      )}

      <section className={styles.fieldQuest}>
        <div>
          <p>근처 사람이 궁금해해요</p>
          <h3>지금 주차 자리 있나요?</h3>
          <span>답변하면 +1 · 사진 답변 +2</span>
        </div>
        <button type="button" onClick={onGoQuestion}>답변하기</button>
      </section>

      <div className={styles.stickyActions}>
        <button type="button" onClick={onGoQuestion}>물어보기</button>
        <button type="button" onClick={onGoReport}>제보하기</button>
      </div>
    </div>
  );
}

function ReportScreen({
  place,
  reportPreset,
  comment,
  photoAttached,
  fieldVerified,
  onPreset,
  onComment,
  onPhotoToggle,
  onVerify,
  onSubmit,
}: {
  place: Place;
  reportPreset: ReportPreset;
  comment: string;
  photoAttached: boolean;
  fieldVerified: boolean;
  onPreset: (preset: ReportPreset) => void;
  onComment: (value: string) => void;
  onPhotoToggle: () => void;
  onVerify: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className={styles.stack}>
      <section className={styles.introCard}>
        <BadgeCheck size={22} />
        <div>
          <h2>{place.name} 현장 제보</h2>
          <p>사진 없어도 괜찮아요. 사람, 주차, 줄만 알려줘도 도움이 됩니다.</p>
        </div>
      </section>

      <section className={styles.quickReport}>
        <SectionTitle title="빠른 제보" caption="10초 제보" />
        <div>
          {quickPresets.map((preset) => (
            <button key={preset} className={reportPreset === preset ? styles.selected : ""} type="button" onClick={() => onPreset(preset)}>
              {presetIcon(preset)}
              {preset}
            </button>
          ))}
        </div>
      </section>

      <ChoiceGroup title="상태 선택" options={["주차", "줄", "사람", "날씨", "기타"]} />
      <section className={styles.textAreaCard}>
        <label htmlFor="report-comment">한 줄 코멘트</label>
        <textarea
          id="report-comment"
          value={comment}
          onChange={(event) => onComment(event.target.value)}
          maxLength={100}
          placeholder="예: 주차 만차예요. 근처 공영주차장 추천해요."
        />
        <span>{comment.length}/100</span>
      </section>

      <section className={styles.photoUpload}>
        <button className={photoAttached ? styles.selected : ""} type="button" onClick={onPhotoToggle}>
          {photoAttached ? <ImageIcon size={18} /> : <Camera size={18} />}
          {photoAttached ? "사진 1장 추가됨" : "사진 없이 상태만 제보"}
        </button>
        <p>EXIF 제거 · 얼굴/차량번호 신고 시 숨김</p>
      </section>

      <section className={`${styles.verifyCard} ${fieldVerified ? styles.selected : ""}`}>
        <LocateFixed size={18} />
        <div>
          <strong>{fieldVerified ? "현장 인증 준비됨" : "현장 인증 선택"}</strong>
          <p>{fieldVerified ? "등록 시 서버가 장소 반경만 확인합니다." : "정확한 좌표는 저장하지 않습니다."}</p>
        </div>
        <button type="button" onClick={onVerify}>{fieldVerified ? "완료" : "현장 인증하기"}</button>
      </section>

      <button className={styles.submitButton} type="button" onClick={onSubmit}>제보 등록하기</button>
    </div>
  );
}

function QuestionScreen({
  place,
  questions,
  onGoReport,
}: {
  place: Place;
  questions: Question[];
  onGoReport: () => void;
}) {
  return (
    <div className={styles.stack}>
      <section className={styles.questionHero}>
        <Ticket size={24} />
        <div>
          <p>근처 사람이 궁금해해요</p>
          <h2>{place.name} 현장 상황을 알려주세요.</h2>
          <span>답변하면 물어보기권을 받을 수 있어요.</span>
        </div>
      </section>
      <section className={styles.questionList}>
        {questions.map((question) => <QuestionItem key={question.id} question={question} />)}
      </section>
      <section className={styles.answerCta}>
        <h3>질문하고 답변 받기</h3>
        <p>주차, 줄, 사진 요청처럼 지금 필요한 정보만 빠르게 물어보세요.</p>
        <button type="button" onClick={onGoReport}>답변/제보하기</button>
      </section>
      <div className={styles.buttonPair}>
        <button type="button">둘러보기</button>
        <button type="button" onClick={onGoReport}>제보하기</button>
      </div>
    </div>
  );
}

function MyScreen({ followedPlaces, savedPosts }: { followedPlaces: Place[]; savedPosts: Post[] }) {
  return (
    <div className={styles.stack}>
      <section className={styles.profileCard}>
        <div className={styles.avatar}>실</div>
        <div>
          <h2>실시간러버</h2>
          <p>신뢰점수 <strong>82점</strong></p>
        </div>
        <Settings size={19} />
      </section>

      <section className={styles.trustStats}>
        <Stat label="현장 인증" value="12회" />
        <Stat label="도움돼요" value="34개" />
        <Stat label="허위 제보" value="0건" />
        <Stat label="위반" value="0건" />
      </section>

      <section className={styles.actionGrid}>
        {[
          ["내 제보", Camera],
          ["내 질문", MessageCircleQuestion],
          ["저장한 게시물", Bookmark],
          ["팔로우한 장소", MapPin],
          ["팔로우한 해시태그", Hash],
          ["최근 본 장소", Clock],
        ].map(([label, Icon]) => {
          const IconComp = Icon as LucideIcon;
          return (
            <button key={label as string} type="button">
              <IconComp size={18} />
              <span>{label as string}</span>
            </button>
          );
        })}
      </section>

      <SectionTitle title="팔로우한 장소" caption={`${followedPlaces.length}곳`} />
      <div className={styles.followList}>
        {followedPlaces.map((place) => (
          <article key={place.id}>
            <MapPin size={15} />
            <div>
              <strong>{place.name}</strong>
              <span>{place.judgement} · {place.updated}</span>
            </div>
          </article>
        ))}
      </div>

      <SectionTitle title="저장한 게시물" caption={`${savedPosts.length}개`} />
      <div className={styles.followList}>
        {savedPosts.map((post) => (
          <article key={post.id}>
            <Bookmark size={15} />
            <div>
              <strong>{post.caption}</strong>
              <span>{post.verified ? "현장 인증" : "상태 제보"} · 도움돼요 {post.helpful}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function FeedCard({
  post,
  place,
  helpful,
  saved,
  onOpen,
  onHelpful,
  onSave,
  onShare,
  onFlag,
}: {
  post: Post;
  place: Place;
  helpful: boolean;
  saved: boolean;
  onOpen: () => void;
  onHelpful: () => void;
  onSave: () => void;
  onShare: () => void;
  onFlag: () => void;
}) {
  return (
    <article className={styles.feedCard}>
      <button className={`${styles.feedPhoto} ${toneClass(post.tone)}`} type="button" onClick={onOpen}>
        <span>{post.photo ? "현장 사진" : "상태 제보"}</span>
        <strong>{place.judgement}</strong>
      </button>
      <div className={styles.feedBody}>
        <header>
          <button type="button" onClick={onOpen}>
            <strong>{place.name}</strong>
            <span>{post.minutesAgo}분 전</span>
          </button>
          <div>
            <span className={`${styles.statusChip} ${toneClass(place.tone)}`}>{pinLabel(place)}</span>
            <span className={`${styles.verifyBadge} ${post.verified ? styles.verified : ""}`} title={post.verified ? "실제 GPS와 장소 반경만 확인했어요." : "위치 인증 없이 작성된 상태 제보예요."}>
              {post.verified ? <BadgeCheck size={12} /> : <MapPin size={12} />}
              {post.verified ? "현장 인증" : "상태 제보"}
            </span>
          </div>
        </header>
        <p>{post.caption}</p>
        <div className={styles.hashtags}>
          {post.tags.map((tag) => <button key={tag} type="button">#{tag}</button>)}
        </div>
        <div className={styles.feedActions}>
          <button className={helpful ? styles.selected : ""} type="button" onClick={onHelpful}><Heart size={15} />도움돼요 {post.helpful + (helpful ? 1 : 0)}</button>
          <button className={saved ? styles.selected : ""} type="button" onClick={onSave}><Bookmark size={15} />{saved ? "저장됨" : "저장"}</button>
          <button type="button" onClick={onShare}><Share2 size={15} />공유</button>
          <button type="button" onClick={onFlag}><Flag size={15} />신고</button>
        </div>
      </div>
    </article>
  );
}

function QuestionItem({ question }: { question: Question }) {
  return (
    <article className={styles.questionItem}>
      <Search size={16} />
      <div>
        <strong>{question.text}</strong>
        <span>{question.minutesAgo}분 전 · 답변 대기</span>
      </div>
      <small>{question.type}</small>
    </article>
  );
}

function FlagModal({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-label="신고 이유 선택">
      <section className={styles.flagModal}>
        <header>
          <h2>신고 이유를 선택해 주세요</h2>
          <p>신고 내용은 운영자가 확인 후 필요한 조치를 취합니다.</p>
        </header>
        <div>
          {reportReasons.map(({ icon: Icon, title, desc }) => (
            <button key={title} type="button" onClick={onClose}>
              <Icon size={18} />
              <span>
                <strong>{title}</strong>
                <small>{desc}</small>
              </span>
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
        <button className={styles.cancelButton} type="button" onClick={onClose}>취소</button>
      </section>
    </div>
  );
}

function ShareSheet({ place, onClose }: { place: Place; onClose: () => void }) {
  return (
    <div className={styles.shareOverlay}>
      <section className={styles.shareCard}>
        <button className={styles.closeButton} type="button" onClick={onClose}><X size={17} /></button>
        <div className={`${styles.sharePreview} ${toneClass(place.tone)}`}>
          <span>{place.judgement}</span>
          <h2>{place.name}</h2>
          <p>{place.summary}</p>
          <small>최근 업데이트 {place.updated}</small>
        </div>
        <div className={styles.qrBox}>
          <strong>#실시간에서 확인하세요!</strong>
          <span>실시간 정보로 더 스마트한 이동</span>
          <div aria-hidden="true" />
        </div>
        <div className={styles.shareButtons}>
          <button type="button">카카오톡</button>
          <button type="button">문자</button>
          <button type="button">링크 복사</button>
          <button type="button">더보기</button>
        </div>
      </section>
    </div>
  );
}

function BottomNav({ active, onChange }: { active: View; onChange: (view: View) => void }) {
  return (
    <nav className={styles.bottomNav}>
      {navItems.map(({ id, label, icon: Icon }) => (
        <button key={id} className={`${active === id ? styles.active : ""} ${id === "report" ? styles.reportNav : ""}`} type="button" onClick={() => onChange(id)}>
          <Icon size={id === "report" ? 22 : 19} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function SectionTitle({ title, caption }: { title: string; caption: string }) {
  return (
    <div className={styles.sectionTitle}>
      <h2>{title}</h2>
      <span>{caption}</span>
    </div>
  );
}

function ChoiceGroup({ title, options }: { title: string; options: string[] }) {
  return (
    <section className={styles.choiceGroup}>
      <h3>{title}</h3>
      <div>
        {options.map((option, index) => (
          <button key={option} className={index === 0 ? styles.selected : ""} type="button">{option}</button>
        ))}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function regionIdsForTab(tab: RegionTabId): RegionId[] | "all" {
  if (tab === "nearby") return ["ulsan", "busan", "gyeongju"];
  if (tab === "southeast") return ["busan", "ulsan", "gyeongju", "daegu", "changwon", "gimhae", "yangsan", "pohang"];
  if (tab === "nationwide") return "all";
  return [tab];
}

function toneClass(tone: Tone) {
  if (tone === "good") return styles.toneGood;
  if (tone === "caution") return styles.toneCaution;
  if (tone === "avoid") return styles.toneAvoid;
  return styles.toneEmpty;
}

function pinLabel(place: Place) {
  if (place.parking === "만차") return "주차 만차";
  if (place.line === "김" || place.line === "보통") return "줄 있음";
  if (place.crowd === "한산") return "한산";
  if (place.crowd === "많음" || place.crowd === "매우 많음") return "혼잡";
  return place.judgement;
}

function presetIcon(preset: ReportPreset) {
  if (preset.includes("주차")) return "🅿️";
  if (preset.includes("줄")) return "🚶";
  if (preset.includes("사람")) return "👥";
  if (preset.includes("한산")) return "🌿";
  return "📸";
}

function presetComment(preset: ReportPreset) {
  if (preset === "주차 만차") return "주차장이 거의 만차예요. 근처 우회 추천해요.";
  if (preset === "줄 길어요") return "대기줄이 꽤 길어요. 여유 있게 오세요.";
  if (preset === "사람 많아요") return "사람이 많아서 이동이 조금 불편해요.";
  if (preset === "한산해요") return "지금은 한산해서 가기 좋아요.";
  return "사진 찍기 좋은 상태예요.";
}
