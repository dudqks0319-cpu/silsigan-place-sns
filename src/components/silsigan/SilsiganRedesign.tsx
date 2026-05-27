"use client";

import {
  AlertTriangle,
  BadgeCheck,
  Bell,
  Bookmark,
  Camera,
  Car,
  CheckCircle2,
  ChevronRight,
  CircleParking,
  Clock,
  CloudSun,
  Filter,
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
  Sparkles,
  Star,
  Ticket,
  User,
  UserX,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { rankPostsForFeed, recommendHashtags } from "@/lib/domain";
import type {
  CrowdLevel,
  LineStatus,
  ParkingStatus,
  Place as ApiPlace,
  QuestionType,
  ReportCategory,
  ShareCard,
  WeatherFeel,
} from "@/lib/domain";
import { getSupabaseAccessToken } from "@/lib/supabase-browser";
import { crowdLabels, lineLabels, parkingLabels, weatherLabels } from "./labels";
import { NaverMap } from "./NaverMap";
import styles from "./SilsiganRedesign.module.css";

type View = "home" | "map" | "place" | "report" | "ask" | "my";
type StatusTone = "calm" | "normal" | "busy" | "danger";
type Category = ReportCategory;

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
};

type Place = {
  id: string;
  name: string;
  category: Category;
  address: string;
  latitude: number;
  longitude: number;
  region: ApiPlace["region"];
  distance: string;
  status: string;
  signal: string;
  summary: string;
  crowd: string;
  parking: string;
  line: string;
  weather: string;
  crowdLevel: CrowdLevel;
  parkingStatus: ParkingStatus;
  lineStatus: LineStatus;
  weatherFeel: WeatherFeel;
  updated: string;
  score: number;
  x: number;
  y: number;
  tone: StatusTone;
  visitors: string;
};

type Report = {
  id: string;
  placeId: string;
  title: string;
  body: string;
  meta: string;
  tone: StatusTone;
  verified: boolean;
  hasPhoto: boolean;
  createdAt: string;
  hiddenAt: string | null;
  crowdLevel: CrowdLevel;
  lineStatus: LineStatus;
  parkingStatus: ParkingStatus;
  weatherFeel: WeatherFeel;
};

type Question = {
  id: string;
  placeId: string;
  body: string;
  reward: string;
  time: string;
  questionType: QuestionType;
  answeredReportId: string | null;
};

type PublicReport = {
  id: string;
  placeId: string;
  category: ReportCategory;
  crowdLevel: CrowdLevel;
  lineStatus: LineStatus;
  parkingStatus: ParkingStatus;
  weatherFeel: WeatherFeel;
  comment: string | null;
  photoUrl: string | null;
  verifiedRadiusM: 50 | 150 | 300 | null;
  locationVerified: boolean;
  createdAt: string;
  expiresAt: string;
  flagCount: number;
  hiddenAt: string | null;
};

type PublicQuestion = {
  id: string;
  placeId: string;
  questionType: QuestionType;
  body: string;
  creditCost: 1 | 2;
  answeredReportId: string | null;
  createdAt: string;
};

type MyQuestion = PublicQuestion & {
  status: "pending" | "answered" | "expired";
};

type PublicHashtag = {
  id: string;
  name: string;
  tagType: "place" | "status" | "purpose" | "time" | "region";
  postCount: number;
  createdAt: string;
};

type PublicPost = {
  id: string;
  userId: string;
  creatorName: string;
  creatorBadge: string;
  placeId: string;
  caption: string | null;
  crowdLevel: CrowdLevel;
  parkingStatus: ParkingStatus;
  lineStatus: LineStatus;
  weatherFeel: WeatherFeel;
  locationVerified: boolean;
  verifiedRadiusM: 50 | 150 | 300 | null;
  photoCount: number;
  photoLabel: string;
  helpfulCount: number;
  commentCount: number;
  hashtagNames: string[];
  hashtags: PublicHashtag[];
  shareCard: ShareCard;
  judgement: "가도 좋음" | "주의" | "지금은 비추";
  safetyWarning: string | null;
  hiddenAt: string | null;
  createdAt: string;
};

type LocationVerificationStatus = "idle" | "requesting" | "verified" | "denied" | "unsupported";

type ClientLocation = {
  latitude: number;
  longitude: number;
};

const presentationByPlaceId: Record<string, Pick<Place, "distance" | "x" | "y">> = {
  "ulsan-taehwagang": { distance: "1.2km", x: 31, y: 47 },
  "busan-gwangalli": { distance: "38km", x: 65, y: 39 },
  "gyeongju-hwangridan": { distance: "29km", x: 52, y: 62 },
  "ulsan-city-hall": { distance: "2.1km", x: 37, y: 74 },
};

const navItems: Array<{ id: View; label: string; icon: LucideIcon }> = [
  { id: "home", label: "홈", icon: Home },
  { id: "map", label: "지도", icon: Map },
  { id: "report", label: "제보", icon: Plus },
  { id: "ask", label: "질문", icon: MessageCircleQuestion },
  { id: "my", label: "마이", icon: User },
];

const filterLabels = ["전체", "사람 많음", "주차 만차", "줄 있음", "사진 있음"];
const reportChips = ["사람 없음", "보통", "많음", "매우 많음"];
const parkingChips = ["널널", "여유 있음", "거의 없음", "만차"];
const lineChips = ["없음", "보통", "있음", "매우 김"];
const weatherChips = ["맑음", "흐림", "비", "실내"];
const questionExamples = ["주차 자리 있나요?", "줄 많이 긴가요?", "사진으로 볼 수 있나요?", "아이랑 가도 괜찮나요?"];

export default function SilsiganRedesign() {
  const [activeView, setActiveView] = useState<View>("home");
  const phoneBodyRef = useRef<HTMLDivElement>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [posts, setPosts] = useState<PublicPost[]>([]);
  const [allPosts, setAllPosts] = useState<PublicPost[]>([]);
  const [hashtags, setHashtags] = useState<PublicHashtag[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [myQuestions, setMyQuestions] = useState<MyQuestion[]>([]);
  const [selectedPlaceId, setSelectedPlaceId] = useState("");
  const [activeFilter, setActiveFilter] = useState(filterLabels[0]);
  const [reportText, setReportText] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [toast, setToast] = useState("현장 인증 제보를 올리면 물어보기권을 받을 수 있어요.");
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pickedCrowd, setPickedCrowd] = useState("많음");
  const [pickedParking, setPickedParking] = useState("거의 없음");
  const [pickedLine, setPickedLine] = useState("있음");
  const [pickedWeather, setPickedWeather] = useState("맑음");
  const [photoAttached, setPhotoAttached] = useState(true);
  const [locationVerificationStatus, setLocationVerificationStatus] = useState<LocationVerificationStatus>("idle");
  const [verifiedLocation, setVerifiedLocation] = useState<ClientLocation | null>(null);
  const [selectedHashtagName, setSelectedHashtagName] = useState<string | null>(null);
  const [followedPlaceIds, setFollowedPlaceIds] = useState<Set<string>>(() => new Set());
  const [followedHashtagNames, setFollowedHashtagNames] = useState<Set<string>>(() => new Set());
  const [helpfulPostIds, setHelpfulPostIds] = useState<Set<string>>(() => new Set());
  const [savedPostIds, setSavedPostIds] = useState<Set<string>>(() => new Set());

  const rankedPosts = useMemo(
    () =>
      rankPostsForFeed(
        posts.map((post) => ({
          ...post,
          helpfulCount: post.helpfulCount + (helpfulPostIds.has(post.id) ? 1 : 0),
        })),
      ),
    [helpfulPostIds, posts],
  );

  const allRankedPosts = useMemo(
    () =>
      rankPostsForFeed(
        allPosts.map((post) => ({
          ...post,
          helpfulCount: post.helpfulCount + (helpfulPostIds.has(post.id) ? 1 : 0),
        })),
      ),
    [allPosts, helpfulPostIds],
  );

  const selectedPlace = useMemo(
    () => places.find((place) => place.id === selectedPlaceId) ?? places[0] ?? null,
    [places, selectedPlaceId],
  );

  const selectedReports = useMemo(
    () => reports.filter((report) => report.placeId === selectedPlace?.id),
    [reports, selectedPlace?.id],
  );

  const selectedPosts = useMemo(
    () => rankedPosts.filter((post) => post.placeId === selectedPlace?.id),
    [rankedPosts, selectedPlace?.id],
  );

  const recommendedTags = useMemo(() => {
    if (!selectedPlace) {
      return [];
    }

    return recommendHashtags({
      place: selectedPlace,
      crowdLevel: crowdValueFromLabel(pickedCrowd),
      parkingStatus: parkingValueFromLabel(pickedParking),
      lineStatus: lineValueFromLabel(pickedLine),
      weatherFeel: weatherValueFromLabel(pickedWeather),
    });
  }, [pickedCrowd, pickedLine, pickedParking, pickedWeather, selectedPlace]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [apiPlaces, apiReports, apiPosts, apiHashtags, apiQuestions, apiMyQuestions] = await Promise.all([
        fetchJson<ApiPlace[]>("/api/places"),
        fetchJson<PublicReport[]>("/api/reports"),
        fetchJson<PublicPost[]>("/api/posts"),
        fetchJson<PublicHashtag[]>("/api/hashtags"),
        fetchJson<PublicQuestion[]>("/api/questions"),
        fetchJson<MyQuestion[]>("/api/my-questions").catch(() => []),
      ]);
      const mappedReports = mapReports(apiReports, apiPlaces);
      const mappedQuestions = mapQuestions(apiQuestions);
      const mappedPlaces = mapPlaces(apiPlaces, mappedReports, mappedQuestions);

      setPlaces(mappedPlaces);
      setReports(mappedReports);
      setPosts(apiPosts);
      setAllPosts(apiPosts);
      setHashtags(apiHashtags);
      setQuestions(mappedQuestions);
      setMyQuestions(apiMyQuestions);
      setSelectedPlaceId((current) => mappedPlaces.find((place) => place.id === current)?.id ?? mappedPlaces[0]?.id ?? "");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "실시간 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (phoneBodyRef.current) {
      phoneBodyRef.current.scrollTop = 0;
    }
  }, [activeView]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const openPlace = (place: Place) => {
    setLocationVerificationStatus("idle");
    setVerifiedLocation(null);
    setToast(`${place.name} 현장 정보를 확인합니다. 현장 인증은 작성 화면에서 다시 선택해 주세요.`);
    setSelectedPlaceId(place.id);
    setActiveView("place");
  };

  const requestFieldVerification = () => {
    if (!navigator.geolocation) {
      setVerifiedLocation(null);
      setLocationVerificationStatus("unsupported");
      setToast("이 브라우저에서는 위치 인증을 사용할 수 없어 상태 제보로 등록됩니다.");
      return;
    }

    setLocationVerificationStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setVerifiedLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setLocationVerificationStatus("verified");
        setToast("실제 GPS 좌표를 확인했습니다. 등록 시 서버에서 장소 반경만 검증합니다.");
      },
      () => {
        setVerifiedLocation(null);
        setLocationVerificationStatus("denied");
        setToast("위치 권한 없이 상태 제보로 등록됩니다. 현장 인증 배지는 붙지 않습니다.");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 8_000,
      },
    );
  };

  const submitReport = async () => {
    if (!selectedPlace || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        placeId: selectedPlace.id,
        crowdLevel: crowdValueFromLabel(pickedCrowd),
        lineStatus: lineValueFromLabel(pickedLine),
        parkingStatus: parkingValueFromLabel(pickedParking),
        weatherFeel: weatherValueFromLabel(pickedWeather),
        caption: reportText.trim() || undefined,
        photoCount: photoAttached ? 1 : 0,
        hashtagNames: recommendedTags,
        ...(verifiedLocation ? { clientLocation: verifiedLocation } : {}),
      };
      const result = await fetchJson<{ post: PublicPost; credits: { amount: number }[] }>("/api/posts", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const earned = result.credits.reduce((sum, event) => sum + Math.max(event.amount, 0), 0);
      const badge = result.post.locationVerified ? "현장 인증" : "상태 제보";
      setToast(`${badge} 완료! 이 제보가 ${selectedPlace.name} 방문자에게 도움이 됩니다. 물어보기권 +${earned}`);
      setReportText("");
      setLocationVerificationStatus("idle");
      setVerifiedLocation(null);
      setActiveView("place");
      await loadData();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "제보 등록에 실패했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitQuestion = async () => {
    if (!selectedPlace || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      const questionType = questionTypeFromText(questionText);
      const result = await fetchJson<{ balance: number }>("/api/questions", {
        method: "POST",
        body: JSON.stringify({
          placeId: selectedPlace.id,
          questionType,
          body: questionText.trim(),
        }),
      });
      setToast(`질문이 등록됐습니다. 물어보기권 잔액 ${result.balance}개입니다.`);
      setQuestionText("");
      setActiveView("place");
      await loadData();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "질문 등록에 실패했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const flagPost = async (post: PublicPost) => {
    try {
      const result = await fetchJson<{ hidden: boolean; flagCount: number }>("/api/post-flags", {
        method: "POST",
        body: JSON.stringify({
          postId: post.id,
          reason: post.safetyWarning ? "sensitive_info" : "privacy_face",
        }),
      });
      setToast(result.hidden ? "신고가 접수되어 게시물을 임시 숨김 처리했습니다." : `신고가 접수됐습니다. 누적 ${result.flagCount}건`);
      await loadData();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "신고 처리에 실패했습니다.");
    }
  };

  const selectHashtag = async (hashtagName: string) => {
    try {
      const filteredPosts = await fetchJson<PublicPost[]>(`/api/posts?hashtagName=${encodeURIComponent(hashtagName)}`);
      setPosts(filteredPosts);
      setSelectedHashtagName(hashtagName);
      setActiveView("home");
      setToast(`#${hashtagName} 피드 ${filteredPosts.length}건을 불러왔습니다.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "해시태그 피드를 불러오지 못했습니다.");
    }
  };

  const clearHashtagFilter = async () => {
    setSelectedHashtagName(null);
    await loadData();
  };

  const togglePlaceFollow = (place: Place) => {
    setFollowedPlaceIds((current) => toggleSetValue(current, place.id));
    const isFollowing = followedPlaceIds.has(place.id);
    setToast(isFollowing ? `${place.name} 팔로우를 해제했습니다.` : `${place.name} 새 현장 제보를 팔로우합니다.`);
  };

  const toggleHashtagFollow = (hashtagName: string) => {
    setFollowedHashtagNames((current) => toggleSetValue(current, hashtagName));
    const isFollowing = followedHashtagNames.has(hashtagName);
    setToast(isFollowing ? `#${hashtagName} 팔로우를 해제했습니다.` : `#${hashtagName} 관심 피드를 팔로우합니다.`);
  };

  const markHelpful = (post: PublicPost) => {
    if (helpfulPostIds.has(post.id)) {
      setToast("이미 도움돼요를 누른 제보입니다.");
      return;
    }

    setHelpfulPostIds((current) => toggleSetValue(current, post.id));
    setToast("도움돼요가 반영됐습니다. 피드 랭킹에 즉시 반영됩니다.");
  };

  const toggleSavePost = (post: PublicPost) => {
    setSavedPostIds((current) => toggleSetValue(current, post.id));
    const isSaved = savedPostIds.has(post.id);
    setToast(isSaved ? "저장을 해제했습니다." : "마이에 저장했습니다.");
  };

  const sharePost = async (post: PublicPost) => {
    const shareUrl = `${window.location.origin}/share/post/${post.id}`;
    const shareText = `${post.shareCard.headline}\n${post.shareCard.body}\n${post.shareCard.hashtags.map((tag) => `#${tag}`).join(" ")}\n${shareUrl}`;

    try {
      await navigator.clipboard.writeText(shareText);
      setToast("공유 카드 페이지 링크를 복사했습니다.");
    } catch {
      setToast(shareText);
    }
  };

  return (
    <main className={styles.redesign}>
      <section className={styles.appCanvas} aria-label="#실시간 앱 프론트엔드 디자인">
        <div className={styles.phoneFrame}>
          <StatusBar />
          <TopHeader
            activeView={activeView}
            selectedPlace={selectedPlace}
            toast={toast}
            onBack={() => setActiveView("home")}
          />

          <div className={styles.phoneBody} ref={phoneBodyRef}>
            {loading && <EmptyState title="실시간 데이터를 불러오는 중입니다" body="최근 제보와 질문을 확인하고 있어요." />}
            {!loading && places.length === 0 && <EmptyState title="보여줄 장소가 없습니다" body="초기 장소 데이터를 확인해 주세요." />}
            {!loading && selectedPlace && (
              <>
                {activeView === "home" && (
                  <HomeScreen
                    places={places}
                    questions={questions}
                    posts={rankedPosts}
                    hashtags={hashtags}
                    selectedHashtagName={selectedHashtagName}
                    followedHashtagNames={followedHashtagNames}
                    helpfulPostIds={helpfulPostIds}
                    savedPostIds={savedPostIds}
                    reports={reports}
                    onFlagPost={flagPost}
                    onClearHashtagFilter={clearHashtagFilter}
                    onFollowHashtag={toggleHashtagFollow}
                    onHelpfulPost={markHelpful}
                    onOpenPlace={openPlace}
                    onSavePost={toggleSavePost}
                    onSharePost={sharePost}
                    onSelectHashtag={selectHashtag}
                    onGoMap={() => setActiveView("map")}
                    onGoReport={() => setActiveView("report")}
                  />
                )}
                {activeView === "map" && (
                  <MapScreen
                    activeFilter={activeFilter}
                    onFilterChange={setActiveFilter}
                    onOpenPlace={openPlace}
                    places={places}
                    selectedPlace={selectedPlace}
                  />
                )}
                {activeView === "place" && (
                  <PlaceScreen
                    place={selectedPlace}
                    posts={selectedPosts}
                    questions={questions}
                    reports={selectedReports}
                    onAsk={() => setActiveView("ask")}
                    onFlagPost={flagPost}
                    onFollowPlace={() => togglePlaceFollow(selectedPlace)}
                    followedPlace={followedPlaceIds.has(selectedPlace.id)}
                    helpfulPostIds={helpfulPostIds}
                    savedPostIds={savedPostIds}
                    onHelpfulPost={markHelpful}
                    onReport={() => setActiveView("report")}
                    onSavePost={toggleSavePost}
                    onSharePost={sharePost}
                    onSelectHashtag={selectHashtag}
                  />
                )}
                {activeView === "report" && (
                  <ReportScreen
                    isSubmitting={isSubmitting}
                    place={selectedPlace}
                    pickedCrowd={pickedCrowd}
                    pickedParking={pickedParking}
                    pickedLine={pickedLine}
                    pickedWeather={pickedWeather}
                    photoAttached={photoAttached}
                    locationVerificationStatus={locationVerificationStatus}
                    reportText={reportText}
                    recommendedTags={recommendedTags}
                    setPickedCrowd={setPickedCrowd}
                    setPickedParking={setPickedParking}
                    setPickedLine={setPickedLine}
                    setPickedWeather={setPickedWeather}
                    setPhotoAttached={setPhotoAttached}
                    setReportText={setReportText}
                    onRequestLocation={requestFieldVerification}
                    onSubmit={submitReport}
                  />
                )}
                {activeView === "ask" && (
                  <AskScreen
                    isSubmitting={isSubmitting}
                    place={selectedPlace}
                    questionText={questionText}
                    setQuestionText={setQuestionText}
                    onSubmit={submitQuestion}
                  />
                )}
                {activeView === "my" && (
                  <MyScreen
                    followedHashtagNames={followedHashtagNames}
                    followedPlaces={places.filter((place) => followedPlaceIds.has(place.id))}
                    myQuestions={myQuestions}
                    questions={questions}
                    reports={reports}
                    savedPosts={allRankedPosts.filter((post) => savedPostIds.has(post.id))}
                  />
                )}
              </>
            )}
          </div>

          <BottomNav activeView={activeView} onChange={setActiveView} />
        </div>

        <OperatorPanel hashtags={hashtags} places={places} posts={rankedPosts} questions={questions} />
      </section>
    </main>
  );
}

function StatusBar() {
  return (
    <div className={styles.statusBar}>
      <span>9:41</span>
      <span className={styles.statusDots}>● ● ▰</span>
    </div>
  );
}

function TopHeader({
  activeView,
  selectedPlace,
  toast,
  onBack,
}: {
  activeView: View;
  selectedPlace: Place | null;
  toast: string;
  onBack: () => void;
}) {
  const isDetail = ["place", "report", "ask"].includes(activeView);
  const titleMap: Record<View, string> = {
    home: "실시간",
    map: "지도",
    place: selectedPlace?.name ?? "장소 상세",
    report: "현장 제보하기",
    ask: "물어보기",
    my: "마이",
  };

  return (
    <header className={styles.topHeader}>
      <div className={styles.headerRow}>
        <button className={styles.iconButton} type="button" onClick={isDetail ? onBack : undefined} aria-label={isDetail ? "뒤로" : "안전 정책"}>
          {isDetail ? <X size={18} /> : <ShieldCheck size={18} />}
        </button>
        <div>
          <p className={styles.eyebrow}>울산 · 부산 · 경주 베타</p>
          <h1>{titleMap[activeView]}</h1>
        </div>
        <button className={styles.iconButton} type="button" aria-label="알림">
          <Bell size={18} />
        </button>
      </div>
      <div className={styles.toast}>{toast}</div>
    </header>
  );
}

function HomeScreen({
  places,
  questions,
  posts,
  hashtags,
  selectedHashtagName,
  followedHashtagNames,
  helpfulPostIds,
  savedPostIds,
  reports,
  onFlagPost,
  onClearHashtagFilter,
  onFollowHashtag,
  onHelpfulPost,
  onOpenPlace,
  onSavePost,
  onSharePost,
  onSelectHashtag,
  onGoMap,
  onGoReport,
}: {
  places: Place[];
  questions: Question[];
  posts: PublicPost[];
  hashtags: PublicHashtag[];
  selectedHashtagName: string | null;
  followedHashtagNames: Set<string>;
  helpfulPostIds: Set<string>;
  savedPostIds: Set<string>;
  reports: Report[];
  onFlagPost: (post: PublicPost) => void;
  onClearHashtagFilter: () => void;
  onFollowHashtag: (hashtagName: string) => void;
  onHelpfulPost: (post: PublicPost) => void;
  onOpenPlace: (place: Place) => void;
  onSavePost: (post: PublicPost) => void;
  onSharePost: (post: PublicPost) => void;
  onSelectHashtag: (hashtagName: string) => void;
  onGoMap: () => void;
  onGoReport: () => void;
}) {
  const featured = places[0];
  const recentPosts = posts.filter((post) => !post.hiddenAt).slice(0, 4);
  const goodCount = places.filter((place) => place.signal === "가도 좋음").length;
  const cautionCount = places.filter((place) => place.signal === "혼잡 주의" || place.signal === "대기 보통").length;
  const avoidCount = places.filter((place) => place.signal === "출발 전 확인").length;

  return (
    <div className={styles.screenStack}>
      <section className={styles.searchCard}>
        <div className={styles.searchBox}>
          <Search size={18} />
          <span>오늘 어디 가세요?</span>
        </div>
        <div className={styles.keywordRow}>
          {["광안리 주차", "황리단길 웨이팅", "태화강 산책"].map((keyword) => (
            <button key={keyword} type="button">{keyword}</button>
          ))}
        </div>
      </section>

      <section className={`${styles.heroCard} ${styles.busyHero}`}>
        <div>
          <span className={styles.badge}>장소 기반 실시간 SNS</span>
          <h2>예쁜 사진보다, 지금 가도 되는지 먼저.</h2>
          <p>사진, 현장 인증, 주차, 줄, 질문을 장소별 피드로 모읍니다.</p>
        </div>
        <button type="button" onClick={() => featured && onOpenPlace(featured)} disabled={!featured}>
          대표 현장 보기 <ChevronRight size={16} />
        </button>
      </section>

      <section className={styles.decisionRail} aria-label="현재 판단 요약">
        <button type="button">
          <CheckCircle2 size={17} />
          <span>가도 좋음</span>
          <strong>{goodCount}</strong>
        </button>
        <button type="button">
          <AlertTriangle size={17} />
          <span>주의</span>
          <strong>{cautionCount}</strong>
        </button>
        <button type="button">
          <ShieldAlert size={17} />
          <span>지금은 비추</span>
          <strong>{avoidCount}</strong>
        </button>
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title={selectedHashtagName ? `#${selectedHashtagName} 피드` : "실시간 사진 피드"} caption={selectedHashtagName ? `${recentPosts.length}개 현장 게시물` : "최근 현장 인증 우선"} />
        {selectedHashtagName && (
          <div className={styles.feedFilterBanner}>
            <span>해시태그 필터 적용 중</span>
            <button type="button" onClick={onClearHashtagFilter}>전체 피드 보기</button>
          </div>
        )}
        <div className={styles.feedTabs}>
          {["전체", "내 주변", "팔로우", "관광지", "맛집", "주차", "야경"].map((tab, index) => (
            <button key={tab} className={index === 0 ? styles.activeFeedTab : ""} type="button">{tab}</button>
          ))}
        </div>
        <div className={styles.feedList}>
          {recentPosts.map((post) => {
            const place = places.find((item) => item.id === post.placeId) ?? places[0];
            return (
              <FeedPostCard
                key={post.id}
                post={post}
                place={place}
                onFlag={() => onFlagPost(post)}
                onHelpful={() => onHelpfulPost(post)}
                onOpenPlace={() => onOpenPlace(place)}
                onSave={() => onSavePost(post)}
                onShare={() => onSharePost(post)}
                onSelectHashtag={onSelectHashtag}
                helpfulActive={helpfulPostIds.has(post.id)}
                saved={savedPostIds.has(post.id)}
              />
            );
          })}
          {recentPosts.length === 0 && <p className={styles.emptyText}>아직 올라온 현장 게시물이 없습니다.</p>}
        </div>
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title="인기 해시태그" caption="최대 5개 추천 구조" />
        <div className={styles.hashtagCloud}>
          {hashtags.slice(0, 10).map((tag) => (
            <button key={tag.id} type="button" onClick={() => onSelectHashtag(tag.name)}>
              <Hash size={13} />
              {tag.name}
              <span>{tag.postCount}</span>
            </button>
          ))}
        </div>
        {selectedHashtagName && (
          <button className={styles.followTagButton} type="button" onClick={() => onFollowHashtag(selectedHashtagName)}>
            <Bell size={14} />
            {followedHashtagNames.has(selectedHashtagName) ? "팔로잉 해제" : `#${selectedHashtagName} 팔로우`}
          </button>
        )}
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title="지금 많이 확인하는 곳" caption="제보 · 질문 · 길찾기 기준" />
        <div className={styles.rankingList}>
          {places.map((place, index) => (
            <button key={place.id} className={styles.rankingItem} type="button" onClick={() => onOpenPlace(place)}>
              <span className={styles.rank}>{index + 1}</span>
              <div>
                <strong>{place.name}</strong>
                <p>{place.summary}</p>
              </div>
              <span className={styles.visitors}>{place.visitors}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.ctaGrid}>
        <button className={styles.ctaCard} type="button" onClick={onGoMap}>
          <MapPin size={20} />
          <strong>내 주변 지도</strong>
          <span>상태 핀으로 보기</span>
        </button>
        <button className={styles.ctaCard} type="button" onClick={onGoReport}>
          <Camera size={20} />
          <strong>현장 제보</strong>
          <span>물어보기권 받기</span>
        </button>
      </section>

      {reports.length > 0 && (
        <section className={styles.sectionBlock}>
          <SectionTitle title="상태 제보 큐" caption="신고/숨김 대상 포함" />
          <div className={styles.reportGrid}>
            {reports.slice(0, 2).map((report) => {
              const place = places.find((item) => item.id === report.placeId) ?? places[0];
              return <LiveReportCard key={report.id} report={report} place={place} onOpen={() => onOpenPlace(place)} />;
            })}
          </div>
        </section>
      )}

      <AnswerableQuestions questions={questions} places={places} />
    </div>
  );
}

function MapScreen({
  activeFilter,
  onFilterChange,
  onOpenPlace,
  places,
  selectedPlace,
}: {
  activeFilter: string;
  onFilterChange: (filter: string) => void;
  onOpenPlace: (place: Place) => void;
  places: Place[];
  selectedPlace: Place;
}) {
  const filteredPlaces = filterPlaces(places, activeFilter);

  return (
    <div className={styles.mapScreen}>
      <div className={styles.mapSearchRow}>
        <div className={styles.searchBox}>
          <Search size={17} />
          <span>장소 검색</span>
        </div>
        <button className={styles.filterButton} type="button">
          <Filter size={16} /> 필터
        </button>
      </div>

      <div className={styles.filterChips}>
        {filterLabels.map((filter) => (
          <button key={filter} className={filter === activeFilter ? styles.activeFilter : ""} type="button" onClick={() => onFilterChange(filter)}>
            {filter}
          </button>
        ))}
      </div>

      <section className={styles.realMapFrame} aria-label="네이버 지도 기반 현장 지도">
        <NaverMap places={filteredPlaces} compact onSelectPlace={onOpenPlace} />
      </section>

      <section className={styles.mapBottomSheet}>
        <div className={styles.sheetHandle} />
        <div className={styles.placeSheetHeader}>
          <div>
            <p className={styles.eyebrow}>선택된 장소</p>
            <h2>{selectedPlace.name}</h2>
          </div>
          <span className={`${styles.statusChip} ${styles[selectedPlace.tone]}`}>{selectedPlace.signal}</span>
        </div>
        <p>{selectedPlace.summary}</p>
        <div className={styles.photoStrip}>
          {[0, 1, 2].map((item) => (
            <div key={item} className={`${styles.photoThumb} ${styles[`photo${item + 1}` as keyof typeof styles]}`} />
          ))}
        </div>
        <button className={styles.primaryButton} type="button" onClick={() => onOpenPlace(selectedPlace)}>
          상세 보기
        </button>
      </section>
    </div>
  );
}

function PlaceScreen({
  place,
  posts,
  questions,
  reports,
  onAsk,
  onFlagPost,
  onFollowPlace,
  followedPlace,
  helpfulPostIds,
  savedPostIds,
  onHelpfulPost,
  onReport,
  onSavePost,
  onSharePost,
  onSelectHashtag,
}: {
  place: Place;
  posts: PublicPost[];
  questions: Question[];
  reports: Report[];
  onAsk: () => void;
  onFlagPost: (post: PublicPost) => void;
  onFollowPlace: () => void;
  followedPlace: boolean;
  helpfulPostIds: Set<string>;
  savedPostIds: Set<string>;
  onHelpfulPost: (post: PublicPost) => void;
  onReport: () => void;
  onSavePost: (post: PublicPost) => void;
  onSharePost: (post: PublicPost) => void;
  onSelectHashtag: (hashtagName: string) => void;
}) {
  const hasSensitivePolicy = place.category === "hospital" || place.category === "public_office";
  const latestQuestion = questions.find((question) => question.placeId === place.id && !question.answeredReportId);
  const placeHashtags = [...new Set(posts.flatMap((post) => post.hashtagNames))].slice(0, 8);
  const photoCount = posts.reduce((sum, post) => sum + post.photoCount, 0);
  const todayReports = posts.length || reports.length;

  return (
    <div className={styles.screenStack}>
      <section className={`${styles.placeHero} ${styles[place.tone]}`}>
        <div className={styles.placePhotoOverlay}>
          <span>{place.signal}</span>
        </div>
      </section>

      <section className={styles.placeSummaryCard}>
        <div className={styles.placeTitleRow}>
          <div>
            <p className={styles.eyebrow}>{place.address}</p>
            <h2>{place.name}</h2>
          </div>
          <button className={`${styles.followButton} ${followedPlace ? styles.followButtonActive : ""}`} type="button" onClick={onFollowPlace}>
            {followedPlace ? "팔로잉" : "팔로우"}
          </button>
        </div>
        <p>{place.summary}</p>
        <div className={styles.placeStatsRow}>
          <StatBox label="오늘 제보" value={String(todayReports)} />
          <StatBox label="사진" value={String(photoCount)} />
          <StatBox label="질문" value={String(questions.filter((question) => question.placeId === place.id).length)} />
          <StatBox label="팔로워" value={place.id === "busan-gwangalli" ? "1,240" : "320"} />
        </div>
        <div className={styles.statusGrid}>
          <StatusMetric icon={Users} label="사람" value={place.crowd} />
          <StatusMetric icon={CircleParking} label="주차" value={place.parking} />
          <StatusMetric icon={Clock} label="줄" value={place.line} />
          <StatusMetric icon={CloudSun} label="날씨" value={place.weather} />
        </div>
      </section>

      <section className={styles.trustCard}>
        <div>
          <p className={styles.eyebrow}>현장 신뢰도</p>
          <strong>{place.score}%</strong>
          <span>현장 인증과 최근성 기준</span>
        </div>
        <div className={styles.trustRing} style={{ ['--score' as string]: `${place.score}%` }}>
          <ShieldCheck size={24} />
        </div>
      </section>

      {hasSensitivePolicy && (
        <section className={styles.warningCard}>
          <ShieldAlert size={18} />
          <p>병원/관공서 사진은 얼굴, 차량번호, 서류, 민원 내용이 보이면 숨김 처리됩니다.</p>
        </section>
      )}

      <section className={styles.placeTabs} aria-label="장소 프로필 탭">
        {["실시간", "사진", "질문", "해시태그", "근처"].map((tab, index) => (
          <button key={tab} className={index === 0 ? styles.placeTabActive : ""} type="button">{tab}</button>
        ))}
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title="장소별 타임라인" caption={`${posts.length}건`} />
        <div className={styles.feedList}>
          {posts.map((post) => (
            <FeedPostCard
              key={post.id}
	              post={post}
	              place={place}
	              onFlag={() => onFlagPost(post)}
	              onHelpful={() => onHelpfulPost(post)}
	              onOpenPlace={() => undefined}
	              onSave={() => onSavePost(post)}
	              onShare={() => onSharePost(post)}
	              onSelectHashtag={onSelectHashtag}
	              helpfulActive={helpfulPostIds.has(post.id)}
	              saved={savedPostIds.has(post.id)}
	            />
          ))}
          {posts.length === 0 && <p className={styles.emptyText}>아직 장소별 피드가 없습니다. 첫 제보를 남겨주세요.</p>}
        </div>
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title="최근 현장 사진" caption={`${reports.length || 1}건`} />
        <div className={styles.photoStripLarge}>
          {[0, 1, 2].map((item) => (
            <div key={item} className={`${styles.photoLarge} ${styles[`photo${item + 1}` as keyof typeof styles]}`}>
              <span>{item === 0 ? place.updated : item === 1 ? "10분 전" : "20분 전"}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title="현장 인증 제보" caption="최근 3시간" />
        {(reports.length ? reports : [reportsFallback(place)]).map((report) => (
          <LiveReportCard key={report.id} report={report} place={place} />
        ))}
      </section>

      {placeHashtags.length > 0 && (
        <section className={styles.sectionBlock}>
          <SectionTitle title="장소 해시태그" caption="검색과 공유용" />
          <div className={styles.hashtagCloud}>
	            {placeHashtags.map((tag) => (
	              <button key={tag} type="button" onClick={() => onSelectHashtag(tag)}><Hash size={13} />{tag}</button>
	            ))}
          </div>
        </section>
      )}

      <section className={styles.questionCard}>
        <div>
          <p className={styles.eyebrow}>최근 질문</p>
          <h3>{latestQuestion?.body ?? "지금 현장 상황이 궁금한가요?"}</h3>
        </div>
        <button type="button" onClick={onAsk}>물어보기</button>
      </section>

      <div className={styles.stickyActions}>
        <button className={styles.secondaryButton} type="button" onClick={onAsk}>물어보기</button>
        <button className={styles.primaryButton} type="button" onClick={onReport}>사진/상태 제보</button>
      </div>
    </div>
  );
}

function ReportScreen({
  isSubmitting,
  place,
  pickedCrowd,
  pickedParking,
  pickedLine,
  pickedWeather,
  photoAttached,
  locationVerificationStatus,
  reportText,
  recommendedTags,
  setPickedCrowd,
  setPickedParking,
  setPickedLine,
  setPickedWeather,
  setPhotoAttached,
  setReportText,
  onRequestLocation,
  onSubmit,
}: {
  isSubmitting: boolean;
  place: Place;
  pickedCrowd: string;
  pickedParking: string;
  pickedLine: string;
  pickedWeather: string;
  photoAttached: boolean;
  locationVerificationStatus: LocationVerificationStatus;
  reportText: string;
  recommendedTags: string[];
  setPickedCrowd: (value: string) => void;
  setPickedParking: (value: string) => void;
  setPickedLine: (value: string) => void;
  setPickedWeather: (value: string) => void;
  setPhotoAttached: (value: boolean) => void;
  setReportText: (value: string) => void;
  onRequestLocation: () => void;
  onSubmit: () => void;
}) {
  const verificationCopy = verificationStatusCopy(locationVerificationStatus);

  return (
    <div className={styles.screenStack}>
      <section className={styles.formIntroCard}>
        <BadgeCheck size={22} />
        <div>
          <h2>{place.name} 현장 제보</h2>
          <p>사진이 없어도 등록 가능하고, 현장 인증 때만 반경을 확인합니다.</p>
        </div>
      </section>

      <section className={styles.photoUploadCard}>
        <div className={`${styles.uploadBox} ${photoAttached ? styles.uploadAttached : ""}`}>
          <Camera size={26} />
          <strong>{photoAttached ? "현장 사진 1장 추가됨" : "사진 없이 상태만 제보"}</strong>
          <span>EXIF 제거 · 얼굴/차량번호 신고 시 숨김</span>
        </div>
        <button type="button" onClick={() => setPhotoAttached(!photoAttached)}>
          <ImageIcon size={16} /> {photoAttached ? "사진 빼기" : "사진 추가"}
        </button>
      </section>

      <ChoiceGroup title="사람 상태" options={reportChips} value={pickedCrowd} onChange={setPickedCrowd} />
      <ChoiceGroup title="주차 상태" options={parkingChips} value={pickedParking} onChange={setPickedParking} />
      <ChoiceGroup title="줄/대기 상태" options={lineChips} value={pickedLine} onChange={setPickedLine} />
      <ChoiceGroup title="날씨/환경" options={weatherChips} value={pickedWeather} onChange={setPickedWeather} />

      <section className={styles.textAreaCard}>
        <label htmlFor="reportText">한 줄 코멘트</label>
        <textarea
          id="reportText"
          value={reportText}
          onChange={(event) => setReportText(event.target.value)}
          placeholder="예: 주차장은 만차고, 해변 중앙은 사람이 많아요."
          maxLength={120}
        />
        <span>{reportText.length}/120</span>
      </section>

      <section className={styles.hashtagSuggestCard}>
        <div className={styles.sectionTitle}>
          <h2>추천 해시태그</h2>
          <span>{recommendedTags.length}/5</span>
        </div>
        <div className={styles.hashtagCloud}>
          {recommendedTags.map((tag) => (
            <button key={tag} type="button"><Hash size={13} />{tag}</button>
          ))}
        </div>
      </section>

      <section className={`${styles.verifyCard} ${locationVerificationStatus === "verified" ? styles.verifyCardActive : ""}`}>
        <LocateFixed size={18} />
        <div>
          <strong>{verificationCopy.title}</strong>
          <p>{verificationCopy.body}</p>
        </div>
        <button type="button" onClick={onRequestLocation} disabled={locationVerificationStatus === "requesting"}>
          {locationVerificationStatus === "requesting" ? "확인 중" : "현장 인증하기"}
        </button>
      </section>

      <button className={styles.submitButton} type="button" onClick={onSubmit} disabled={isSubmitting}>
        {isSubmitting ? "등록 중..." : "제보 등록하기"}
      </button>
    </div>
  );
}

function AskScreen({
  isSubmitting,
  place,
  questionText,
  setQuestionText,
  onSubmit,
}: {
  isSubmitting: boolean;
  place: Place;
  questionText: string;
  setQuestionText: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className={styles.screenStack}>
      <section className={styles.askHeroCard}>
        <Ticket size={24} />
        <div>
          <p className={styles.eyebrow}>내 물어보기권 3개</p>
          <h2>{place.name} 근처 사용자에게 물어보세요.</h2>
          <span>사진 요청은 2개, 일반 질문은 1개가 차감됩니다.</span>
        </div>
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title="자주 묻는 예시" caption="바로 선택" />
        <div className={styles.exampleGrid}>
          {questionExamples.map((example) => (
            <button key={example} type="button" onClick={() => setQuestionText(example)}>{example}</button>
          ))}
        </div>
      </section>

      <section className={styles.questionTypeGrid}>
        <QuestionType icon={Users} label="사람/혼잡" active />
        <QuestionType icon={Car} label="주차" />
        <QuestionType icon={Clock} label="줄/대기" />
        <QuestionType icon={Camera} label="사진 요청" />
      </section>

      <section className={styles.textAreaCard}>
        <label htmlFor="questionText">질문 내용</label>
        <textarea
          id="questionText"
          value={questionText}
          onChange={(event) => setQuestionText(event.target.value)}
          placeholder="궁금한 내용을 구체적으로 작성해 주세요."
          maxLength={120}
        />
        <span>{questionText.length}/120</span>
      </section>

      <section className={styles.warningCard}>
        <AlertTriangle size={18} />
        <p>개인정보, 민원 내용, 환자 정보, 특정인을 알아볼 수 있는 질문은 제한됩니다.</p>
      </section>

      <button className={styles.submitButton} type="button" onClick={onSubmit} disabled={isSubmitting}>
        {isSubmitting ? "등록 중..." : "질문 등록"}
      </button>
    </div>
  );
}

function MyScreen({
  followedHashtagNames,
  followedPlaces,
  myQuestions,
  questions,
  reports,
  savedPosts,
}: {
  followedHashtagNames: Set<string>;
  followedPlaces: Place[];
  myQuestions: MyQuestion[];
  questions: Question[];
  reports: Report[];
  savedPosts: PublicPost[];
}) {
  const answeredCount = myQuestions.filter((question) => question.status === "answered").length;

  return (
    <div className={styles.screenStack}>
      <section className={styles.profileCard}>
        <div className={styles.avatar}>실</div>
        <div>
          <h2>실시간러버</h2>
          <p>지역 제보자 · 신뢰 점수 82</p>
        </div>
        <Settings size={19} />
      </section>

      <section className={styles.myStatsGrid}>
        <StatBox label="공개 제보" value={String(reports.length)} />
        <StatBox label="내 질문" value={String(myQuestions.length || questions.length)} />
        <StatBox label="답변 완료" value={String(answeredCount)} />
        <StatBox label="저장" value={String(savedPosts.length)} />
      </section>

      <section className={styles.badgeShelf}>
        {["태화강 제보왕", "부산 주차 도우미", "사진 스팟 헌터"].map((badge) => (
          <span key={badge}><BadgeCheck size={14} />{badge}</span>
        ))}
      </section>

      <section className={styles.walletCard}>
        <div>
          <p className={styles.eyebrow}>보유 현황</p>
          <h3>물어보기권은 서버 잔액 기준</h3>
        </div>
        <strong>{questions.length}Q</strong>
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title="팔로우한 장소" caption={`${followedPlaces.length}곳`} />
        <div className={styles.followList}>
          {followedPlaces.map((place) => (
            <article key={place.id} className={styles.followListItem}>
              <MapPin size={15} />
              <div>
                <strong>{place.name}</strong>
                <span>{place.signal} · {place.updated}</span>
              </div>
            </article>
          ))}
          {followedPlaces.length === 0 && <p className={styles.emptyText}>장소 상세에서 팔로우하면 여기에 모입니다.</p>}
        </div>
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title="팔로우한 해시태그" caption={`${followedHashtagNames.size}개`} />
        <div className={styles.savedTagRow}>
          {[...followedHashtagNames].map((tag) => (
            <span key={tag}><Hash size={13} />#{tag}</span>
          ))}
          {followedHashtagNames.size === 0 && <p className={styles.emptyText}>관심 해시태그를 팔로우하면 재방문 피드가 생깁니다.</p>}
        </div>
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title="저장한 게시물" caption={`${savedPosts.length}개`} />
        <div className={styles.savedPostList}>
          {savedPosts.map((post) => (
            <article key={post.id} className={styles.savedPostItem}>
              <Bookmark size={15} />
              <div>
                <strong>{post.shareCard.headline}</strong>
                <span>{post.locationVerified ? "현장 인증" : "상태 제보"} · 도움돼요 {post.helpfulCount}</span>
              </div>
            </article>
          ))}
          {savedPosts.length === 0 && <p className={styles.emptyText}>피드에서 저장한 현장 게시물이 표시됩니다.</p>}
        </div>
      </section>

      <section className={styles.menuList}>
        <MenuRow icon={Camera} label="내 제보" />
        <MenuRow icon={MessageCircleQuestion} label="내 질문" />
        <MenuRow icon={Bookmark} label="저장한 게시물" />
        <MenuRow icon={Hash} label="팔로우한 해시태그" />
        <MenuRow icon={Star} label="지역 뱃지" />
        <MenuRow icon={UserX} label="차단한 사용자" />
        <MenuRow icon={ShieldCheck} label="안전 정책 및 이용 안내" />
      </section>
    </div>
  );
}

function OperatorPanel({
  hashtags,
  places,
  posts,
  questions,
}: {
  hashtags: PublicHashtag[];
  places: Place[];
  posts: PublicPost[];
  questions: Question[];
}) {
  return (
    <aside className={styles.operatorPanel}>
      <div className={styles.operatorHeader}>
        <div>
          <p className={styles.eyebrow}>Desktop Preview</p>
          <h2>전국 현장 요약</h2>
        </div>
      </div>

      <div className={styles.operatorMetrics}>
        <StatBox label="장소" value={String(places.length)} />
        <StatBox label="게시물" value={String(posts.length)} />
        <StatBox label="질문" value={String(questions.length)} />
      </div>

      <section className={styles.desktopMapCard}>
        <h3>실시간 지역 상태</h3>
        <div className={styles.miniMap}>
          {places.map((place) => (
            <span key={place.id} className={`${styles.desktopPin} ${styles[place.tone]}`} style={{ left: `${place.x}%`, top: `${place.y}%` }} />
          ))}
        </div>
      </section>

      <section className={styles.desktopQueue}>
        <h3>확산 중인 현장 피드</h3>
        {posts.slice(0, 3).map((post) => {
          const place = places.find((candidate) => candidate.id === post.placeId);

          return (
            <div key={post.id} className={styles.queueRow}>
              <span>{place?.name ?? "현장"}</span>
              <strong>{post.locationVerified ? "인증" : "미인증"}</strong>
            </div>
          );
        })}
        {posts.length === 0 && (
          <div className={styles.queueRow}>
            <span>아직 최근 제보가 없습니다</span>
            <strong>대기</strong>
          </div>
        )}
      </section>

      <section className={styles.desktopQueue}>
        <h3>해시태그 품질</h3>
        {hashtags.slice(0, 4).map((tag) => (
          <div key={tag.id} className={styles.queueRow}>
            <span>#{tag.name}</span>
            <strong>{tag.postCount}</strong>
          </div>
        ))}
      </section>
    </aside>
  );
}

function BottomNav({ activeView, onChange }: { activeView: View; onChange: (view: View) => void }) {
  return (
    <nav className={styles.bottomNav}>
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = item.id === activeView;
        return (
          <button key={item.id} className={`${styles.navButton} ${isActive ? styles.navActive : ""} ${item.id === "report" ? styles.reportNav : ""}`} type="button" onClick={() => onChange(item.id)}>
            <Icon size={item.id === "report" ? 22 : 19} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function LiveReportCard({ report, place, onOpen }: { report: Report; place: Place; onOpen?: () => void }) {
  return (
    <button className={styles.liveReportCard} type="button" onClick={onOpen}>
      <div className={`${styles.reportPhoto} ${styles[report.tone]}`}>
        {report.hasPhoto ? <Camera size={18} /> : <Sparkles size={18} />}
      </div>
      <div>
        <span className={`${styles.statusChip} ${styles[report.tone]}`}>{report.verified ? "현장 인증" : "상태 제보"}</span>
        <strong>{place.name}</strong>
        <p>{report.body}</p>
        <small>{report.meta}</small>
      </div>
    </button>
  );
}

function FeedPostCard({
  post,
  place,
  onFlag,
  onHelpful,
  onOpenPlace,
  onSave,
  onShare,
  onSelectHashtag,
  helpfulActive,
  saved,
}: {
  post: PublicPost;
  place: Place;
  onFlag: () => void;
  onHelpful: () => void;
  onOpenPlace: () => void;
  onSave: () => void;
  onShare: () => void;
  onSelectHashtag: (hashtagName: string) => void;
  helpfulActive: boolean;
  saved: boolean;
}) {
  const verificationTooltip = post.locationVerified
    ? "현장 인증: 실제 GPS와 장소 반경만 검증하고 정확한 좌표는 저장하지 않습니다."
    : "상태 제보: 위치 인증 없이 작성되어 판단에는 낮은 가중치로 반영됩니다.";

  return (
    <article className={styles.feedPostCard}>
      <button className={`${styles.feedPhoto} ${styles[place.tone]}`} type="button" onClick={onOpenPlace}>
        <span>{post.photoLabel}</span>
        <strong>{post.judgement}</strong>
      </button>
      <div className={styles.feedPostBody}>
        <div className={styles.feedPostHeader}>
          <button type="button" onClick={onOpenPlace}>
            <strong>{place.name}</strong>
            <span>{minutesAgo(post.createdAt)}</span>
          </button>
          <div className={styles.feedPostChips}>
            <span className={`${styles.statusChip} ${styles[place.tone]}`}>{postStatusText(post)}</span>
            <span className={`${styles.verificationChip} ${post.locationVerified ? styles.verificationVerified : styles.verificationReport}`} title={verificationTooltip}>
              {post.locationVerified ? <BadgeCheck size={12} /> : <MapPin size={12} />}
              {post.locationVerified ? "현장 인증" : "상태 제보"}
            </span>
          </div>
        </div>
        <p>{post.caption ?? `${place.name}의 현재 상태가 업데이트됐습니다.`}</p>
        <div className={styles.statusInline}>
          <span>사람 {crowdLabels[post.crowdLevel]}</span>
          <span>주차 {parkingLabels[post.parkingStatus]}</span>
          <span>줄 {lineLabels[post.lineStatus]}</span>
        </div>
        <div className={styles.feedHashtags}>
          {post.hashtagNames.slice(0, 5).map((tag) => (
            <button key={tag} type="button" onClick={() => onSelectHashtag(tag)}>#{tag}</button>
          ))}
        </div>
        <div className={styles.feedActions}>
          <button className={helpfulActive ? styles.feedActionActive : ""} type="button" onClick={onHelpful}>
            <Heart size={15} />도움돼요 {post.helpfulCount}
          </button>
          <button className={saved ? styles.feedActionActive : ""} type="button" onClick={onSave}>
            <Bookmark size={15} />{saved ? "저장됨" : "저장"}
          </button>
          <button type="button" onClick={onShare}><Share2 size={15} />공유</button>
          <button type="button" onClick={onFlag}><Flag size={15} />신고</button>
        </div>
        {post.safetyWarning && (
          <div className={styles.safetyInline}>
            <ShieldAlert size={14} />
            <span>{post.safetyWarning}</span>
          </div>
        )}
      </div>
    </article>
  );
}

function AnswerableQuestions({ places, questions }: { places: Place[]; questions: Question[] }) {
  const pendingQuestions = questions.filter((question) => !question.answeredReportId).slice(0, 3);

  return (
    <section className={styles.sectionBlock}>
      <SectionTitle title="답변 가능한 질문" caption="답하면 +2" />
      <div className={styles.answerList}>
        {pendingQuestions.map((question) => {
          const place = places.find((item) => item.id === question.placeId) ?? places[0];
          return (
            <article key={question.id} className={styles.answerItem}>
              <MessageCircleQuestion size={18} />
              <div>
                <strong>{question.body}</strong>
                <p>{place.name} · {question.time}</p>
              </div>
              <span>{question.reward}</span>
            </article>
          );
        })}
        {pendingQuestions.length === 0 && <p className={styles.emptyText}>아직 답변 가능한 질문이 없습니다.</p>}
      </div>
    </section>
  );
}

function ChoiceGroup({ title, options, value, onChange }: { title: string; options: string[]; value: string; onChange: (value: string) => void }) {
  return (
    <section className={styles.choiceGroup}>
      <h3>{title}</h3>
      <div>
        {options.map((option) => (
          <button key={option} className={value === option ? styles.choiceActive : ""} type="button" onClick={() => onChange(option)}>{option}</button>
        ))}
      </div>
    </section>
  );
}

function QuestionType({ icon: Icon, label, active = false }: { icon: LucideIcon; label: string; active?: boolean }) {
  return (
    <button className={`${styles.questionType} ${active ? styles.questionTypeActive : ""}`} type="button">
      <Icon size={18} />
      <span>{label}</span>
    </button>
  );
}

function StatusMetric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className={styles.statusMetric}>
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function verificationStatusCopy(status: LocationVerificationStatus) {
  if (status === "requesting") {
    return {
      title: "실제 위치 확인 중",
      body: "브라우저 위치 권한을 확인하고 있습니다.",
    };
  }

  if (status === "verified") {
    return {
      title: "GPS 좌표 준비됨",
      body: "등록 시 서버가 실제 사용자 좌표와 장소 거리를 계산합니다.",
    };
  }

  if (status === "denied") {
    return {
      title: "상태 제보로 등록",
      body: "위치 권한이 없어 현장 인증 배지는 붙지 않습니다.",
    };
  }

  if (status === "unsupported") {
    return {
      title: "위치 인증 미지원",
      body: "이 브라우저에서는 위치 없이 상태 제보만 등록합니다.",
    };
  }

  return {
    title: "현장 인증 선택",
    body: "누르면 실제 GPS를 요청합니다. 선택 장소 좌표는 쓰지 않습니다.",
  };
}

function SectionTitle({ title, caption }: { title: string; caption: string }) {
  return (
    <div className={styles.sectionTitle}>
      <h2>{title}</h2>
      <span>{caption}</span>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.statBox}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function MenuRow({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <button className={styles.menuRow} type="button">
      <Icon size={18} />
      <span>{label}</span>
      <ChevronRight size={16} />
    </button>
  );
}

function reportsFallback(place: Place): Report {
  return {
    id: `${place.id}-fallback`,
    placeId: place.id,
    title: place.name,
    body: "아직 최근 제보가 부족합니다. 현장에 있다면 첫 제보를 남겨주세요.",
    meta: "대기 중 · 사진 없음",
    tone: place.tone,
    verified: false,
    hasPhoto: false,
    createdAt: new Date().toISOString(),
    hiddenAt: null,
    crowdLevel: place.crowdLevel,
    lineStatus: place.lineStatus,
    parkingStatus: place.parkingStatus,
    weatherFeel: place.weatherFeel,
  };
}

function EmptyState({ body, title }: { body: string; title: string }) {
  return (
    <section className={styles.emptyState}>
      <Sparkles size={22} />
      <h2>{title}</h2>
      <p>{body}</p>
    </section>
  );
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const accessToken = await getSupabaseAccessToken();

  if (!(init?.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  if (accessToken && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(input, {
    ...init,
    headers,
  });
  const payload = (await response.json()) as ApiResponse<T>;

  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "요청 처리 중 오류가 발생했습니다.");
  }

  return payload.data as T;
}

function mapPlaces(apiPlaces: ApiPlace[], reports: Report[], questions: Question[]): Place[] {
  return apiPlaces.map((place, index) => {
    const latestReports = reports.filter((report) => report.placeId === place.id && !report.hiddenAt);
    const latest = latestReports[0];
    const presentation = presentationByPlaceId[place.id] ?? {
      distance: `${index + 1}.0km`,
      x: 30 + index * 12,
      y: 40 + index * 8,
    };
    const crowdLevel = latest?.crowdLevel ?? "normal";
    const lineStatus = latest?.lineStatus ?? "none";
    const parkingStatus = latest?.parkingStatus ?? "unknown";
    const weatherFeel = latest?.weatherFeel ?? "good";
    const reportCount = latestReports.length;
    const questionCount = questions.filter((question) => question.placeId === place.id && !question.answeredReportId).length;
    const tone = toneFromStatus(crowdLevel, parkingStatus);

    return {
      id: place.id,
      name: place.name,
      category: place.category,
      address: place.address,
      latitude: place.latitude,
      longitude: place.longitude,
      region: place.region,
      distance: presentation.distance,
      status: crowdLabels[crowdLevel],
      signal: signalFromTone(tone),
      summary: latest?.body ?? `${crowdLabels[crowdLevel]} · 주차 ${parkingLabels[parkingStatus]} · 질문 ${questionCount}건`,
      crowd: crowdLabels[crowdLevel],
      parking: parkingLabels[parkingStatus],
      line: lineLabels[lineStatus],
      weather: weatherLabels[weatherFeel],
      crowdLevel,
      parkingStatus,
      lineStatus,
      weatherFeel,
      updated: latest?.meta.split(" · ")[0] ?? "정보 대기",
      score: trustScoreForPlace(latestReports, questionCount),
      x: presentation.x,
      y: presentation.y,
      tone,
      visitors: `${reportCount + questionCount}건`,
    };
  });
}

function mapReports(reports: PublicReport[], apiPlaces: ApiPlace[]): Report[] {
  return [...reports]
    .filter((report) => !report.hiddenAt)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .map((report) => {
      const place = apiPlaces.find((candidate) => candidate.id === report.placeId);
      const tone = toneFromStatus(report.crowdLevel, report.parkingStatus);

      return {
        id: report.id,
        placeId: report.placeId,
        title: place?.name ?? "현장 제보",
        body: report.comment ?? `${crowdLabels[report.crowdLevel]} · 주차 ${parkingLabels[report.parkingStatus]}`,
        meta: `${minutesAgo(report.createdAt)} · ${report.verifiedRadiusM ? "현장 인증" : "미인증"} · ${report.photoUrl ? "사진 있음" : "사진 없음"}`,
        tone,
        verified: Boolean(report.verifiedRadiusM),
        hasPhoto: Boolean(report.photoUrl),
        createdAt: report.createdAt,
        hiddenAt: report.hiddenAt,
        crowdLevel: report.crowdLevel,
        lineStatus: report.lineStatus,
        parkingStatus: report.parkingStatus,
        weatherFeel: report.weatherFeel,
      } satisfies Report & Pick<PublicReport, "crowdLevel" | "lineStatus" | "parkingStatus" | "weatherFeel">;
    });
}

function mapQuestions(questions: PublicQuestion[]): Question[] {
  return [...questions]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .map((question) => ({
      id: question.id,
      placeId: question.placeId,
      body: question.body,
      reward: question.questionType === "photo_request" ? "+2" : "+1",
      time: minutesAgo(question.createdAt),
      questionType: question.questionType,
      answeredReportId: question.answeredReportId,
    }));
}

function filterPlaces(places: Place[], filter: string) {
  if (filter === "사람 많음") {
    return places.filter((place) => place.crowdLevel === "busy" || place.crowdLevel === "packed");
  }

  if (filter === "주차 만차") {
    return places.filter((place) => place.parkingStatus === "full");
  }

  if (filter === "줄 있음") {
    return places.filter((place) => place.lineStatus === "medium" || place.lineStatus === "long");
  }

  if (filter === "사진 있음") {
    return places;
  }

  return places;
}

function postStatusText(post: Pick<PublicPost, "crowdLevel" | "parkingStatus">) {
  if (post.crowdLevel === "packed" || post.parkingStatus === "full") {
    return "지금은 비추";
  }

  if (post.crowdLevel === "busy" || post.parkingStatus === "limited") {
    return "주의";
  }

  return "가도 좋음";
}

function minutesAgo(createdAt: string) {
  const diffMinutes = Math.max(1, Math.round((Date.now() - new Date(createdAt).getTime()) / 60_000));

  if (diffMinutes >= 60) {
    return `${Math.round(diffMinutes / 60)}시간 전`;
  }

  return `${diffMinutes}분 전`;
}

function toneFromStatus(crowdLevel: CrowdLevel, parkingStatus: ParkingStatus): StatusTone {
  if (crowdLevel === "packed" || parkingStatus === "full") {
    return "danger";
  }

  if (crowdLevel === "busy" || parkingStatus === "limited") {
    return "busy";
  }

  if (crowdLevel === "quiet") {
    return "calm";
  }

  return "normal";
}

function signalFromTone(tone: StatusTone) {
  if (tone === "calm") return "가도 좋음";
  if (tone === "normal") return "대기 보통";
  if (tone === "busy") return "혼잡 주의";
  return "출발 전 확인";
}

function trustScoreForPlace(reports: Report[], questionCount: number) {
  const verified = reports.filter((report) => report.verified).length;
  const photos = reports.filter((report) => report.hasPhoto).length;

  return Math.min(60 + verified * 8 + photos * 5 + questionCount * 2, 98);
}

function toggleSetValue<TValue>(set: Set<TValue>, value: TValue) {
  const next = new Set(set);

  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }

  return next;
}

function crowdValueFromLabel(label: string): CrowdLevel {
  if (label === "사람 없음") return "quiet";
  if (label === "매우 많음") return "packed";
  if (label === "많음") return "busy";
  return "normal";
}

function parkingValueFromLabel(label: string): ParkingStatus {
  if (label === "만차") return "full";
  if (label === "거의 없음") return "limited";
  if (label === "널널" || label === "여유 있음") return "available";
  return "unknown";
}

function lineValueFromLabel(label: string): LineStatus {
  if (label === "매우 김") return "long";
  if (label === "있음" || label === "보통") return "medium";
  return "none";
}

function weatherValueFromLabel(label: string): WeatherFeel {
  if (label === "비") return "rainy";
  return "good";
}

function questionTypeFromText(text: string): QuestionType {
  if (text.includes("사진")) return "photo_request";
  if (text.includes("주차")) return "parking";
  if (text.includes("줄") || text.includes("대기") || text.includes("웨이팅")) return "line";
  if (text.includes("날씨") || text.includes("비")) return "weather";
  if (text.includes("사람") || text.includes("혼잡")) return "crowd";
  return "other";
}
