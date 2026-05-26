"use client";

import {
  BadgeCheck,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Flag,
  LocateFixed,
  MapPin,
  MessageCircleQuestion,
  Navigation,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Ticket,
  Upload
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  crowdOptions,
  lineOptions,
  navItems,
  parkingOptions,
  places,
  questionTypes,
  weatherOptions
} from "./mock-data";
import type { Place, QuestionDraft, ReportDraft, TabId } from "./types";
import { ActionButton, SegmentedControl, StatusPill } from "./ui";

const initialReport: ReportDraft = {
  crowd: "normal",
  line: "short",
  parking: "limited",
  weather: "clear",
  comment: "",
  hasPhoto: false,
  locationVerified: true
};

const initialQuestion: QuestionDraft = {
  type: "crowd",
  content: "",
  isPhotoRequest: false
};

export default function SilsiganPrototype() {
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [selectedPlaceId, setSelectedPlaceId] = useState(places[0].id);
  const [reportDraft, setReportDraft] = useState<ReportDraft>(initialReport);
  const [questionDraft, setQuestionDraft] = useState<QuestionDraft>(initialQuestion);
  const [questionTickets, setQuestionTickets] = useState(3);
  const [trustScore, setTrustScore] = useState(86);
  const [reportsSubmitted, setReportsSubmitted] = useState(2);
  const [questionsSubmitted, setQuestionsSubmitted] = useState(1);
  const [flagged, setFlagged] = useState(false);
  const [toast, setToast] = useState("위치 인증 제보는 질문권을 빠르게 채워줍니다.");

  const selectedPlace = useMemo(
    () => places.find((place) => place.id === selectedPlaceId) ?? places[0],
    [selectedPlaceId]
  );

  const selectPlace = (place: Place, nextTab: TabId = "place") => {
    setSelectedPlaceId(place.id);
    setActiveTab(nextTab);
  };

  const submitReport = () => {
    const ticketBonus = Number(reportDraft.locationVerified) + Number(reportDraft.hasPhoto);
    setQuestionTickets((current) => current + ticketBonus);
    setTrustScore((current) => Math.min(current + 3, 99));
    setReportsSubmitted((current) => current + 1);
    setToast(`제보 완료: 질문권 +${ticketBonus}, 3시간 후 자동 만료됩니다.`);
    setReportDraft(initialReport);
    setActiveTab("place");
  };

  const submitQuestion = () => {
    const cost = questionDraft.type === "photo" || questionDraft.isPhotoRequest ? 2 : 1;
    if (questionTickets < cost) {
      setToast("질문권이 부족합니다. 위치 인증 제보로 질문권을 받을 수 있어요.");
      return;
    }
    setQuestionTickets((current) => current - cost);
    setQuestionsSubmitted((current) => current + 1);
    setToast(`질문 등록 완료: 질문권 ${cost}개가 차감되었습니다.`);
    setQuestionDraft(initialQuestion);
    setActiveTab("place");
  };

  const reportSensitiveContent = () => {
    setFlagged(true);
    setToast("신고가 접수되었습니다. 얼굴, 차량번호, 민감정보 노출 여부를 검토합니다.");
  };

  return (
    <main className="app-shell">
      <section className="phone-frame" aria-label="#실시간 모바일 프로토타입">
        <TopBar toast={toast} />
        <div className="screen-scroll">
          {activeTab === "home" && <HomeScreen onSelectPlace={selectPlace} />}
          {activeTab === "map" && <MapScreen onSelectPlace={selectPlace} />}
          {activeTab === "place" && (
            <PlaceScreen
              flagged={flagged}
              onFlag={reportSensitiveContent}
              onGoQuestion={() => setActiveTab("question")}
              onGoReport={() => setActiveTab("report")}
              place={selectedPlace}
            />
          )}
          {activeTab === "report" && (
            <ReportScreen
              draft={reportDraft}
              onChange={setReportDraft}
              onSubmit={submitReport}
              place={selectedPlace}
            />
          )}
          {activeTab === "question" && (
            <QuestionScreen
              draft={questionDraft}
              onChange={setQuestionDraft}
              onSubmit={submitQuestion}
              place={selectedPlace}
              questionTickets={questionTickets}
            />
          )}
          {activeTab === "my" && (
            <MyScreen
              questionTickets={questionTickets}
              questionsSubmitted={questionsSubmitted}
              reportsSubmitted={reportsSubmitted}
              trustScore={trustScore}
            />
          )}
        </div>
        <BottomNav activeTab={activeTab} onChange={setActiveTab} />
      </section>
    </main>
  );
}

function TopBar({ toast }: { toast: string }) {
  return (
    <header className="top-bar">
      <div>
        <p className="eyebrow">울산, 부산, 경주 베타</p>
        <h1>#실시간</h1>
      </div>
      <div className="trust-chip" aria-label="실시간 인증 정책">
        <ShieldCheck size={18} />
        <span>RLS + 위치구간</span>
      </div>
      <p className="toast" role="status">
        {toast}
      </p>
    </header>
  );
}

function HomeScreen({ onSelectPlace }: { onSelectPlace: (place: Place) => void }) {
  const calmPlaces = places.filter((place) => place.crowd === "safe" || place.crowd === "normal");
  const busyPlaces = places.filter((place) => place.crowd === "busy" || place.crowd === "crowded");

  return (
    <div className="screen-stack">
      <label className="search-box">
        <Search size={20} />
        <input placeholder="장소, 축제, 병원, 주차장 검색" type="search" />
      </label>

      <section className="hero-map">
        <div>
          <p className="eyebrow">내 주변 실시간 제보</p>
          <h2>출발 전 10초, 지금 상태 확인</h2>
          <p>사진, 거리구간, 만료 시간을 함께 보여줍니다.</p>
        </div>
        <button className="map-locate" type="button">
          <LocateFixed size={18} />
          내 위치
        </button>
        {places.map((place) => (
          <button
            aria-label={`${place.name} 상세 보기`}
            className={`map-pin map-pin--${place.crowd}`}
            key={place.id}
            onClick={() => onSelectPlace(place)}
            style={{ left: `${place.coordinates.x}%`, top: `${place.coordinates.y}%` }}
            type="button"
          >
            <MapPin size={16} />
          </button>
        ))}
      </section>

      <QuickStats />

      <PlaceCarousel title="지금 질문 올라온 곳" places={places} onSelectPlace={onSelectPlace} />
      <PlaceCarousel title="지금 혼잡한 곳" places={busyPlaces} onSelectPlace={onSelectPlace} />
      <PlaceCarousel title="지금 한산한 곳" places={calmPlaces} onSelectPlace={onSelectPlace} />
    </div>
  );
}

function QuickStats() {
  return (
    <section className="quick-grid" aria-label="서비스 핵심 상태">
      <div>
        <Clock3 size={18} />
        <strong>3시간</strong>
        <span>제보 자동 만료</span>
      </div>
      <div>
        <Ticket size={18} />
        <strong>3개</strong>
        <span>가입 질문권</span>
      </div>
      <div>
        <BadgeCheck size={18} />
        <strong>86점</strong>
        <span>신뢰 배지 기준</span>
      </div>
    </section>
  );
}

function PlaceCarousel({
  title,
  places: list,
  onSelectPlace
}: {
  title: string;
  places: Place[];
  onSelectPlace: (place: Place) => void;
}) {
  return (
    <section className="section-block">
      <div className="section-title">
        <h2>{title}</h2>
        <span>{list.length}곳</span>
      </div>
      <div className="place-list">
        {list.map((place) => (
          <button className="place-card" key={place.id} onClick={() => onSelectPlace(place)} type="button">
            <div>
              <StatusPill level={place.crowd} />
              <h3>{place.name}</h3>
              <p>{place.summary}</p>
            </div>
            <div className="card-meta">
              <span>{place.distance}</span>
              <span>{place.updatedAt}</span>
              <ChevronRight size={18} />
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function MapScreen({ onSelectPlace }: { onSelectPlace: (place: Place) => void }) {
  return (
    <div className="screen-stack">
      <section className="full-map" aria-label="주변 제보 지도">
        <div className="map-grid-lines" />
        <div className="map-center">
          <Navigation size={20} />
        </div>
        {places.map((place) => (
          <button
            className={`map-bubble map-bubble--${place.crowd}`}
            key={place.id}
            onClick={() => onSelectPlace(place)}
            style={{ left: `${place.coordinates.x}%`, top: `${place.coordinates.y}%` }}
            type="button"
          >
            <span>{place.status}</span>
            <small>{place.name}</small>
          </button>
        ))}
      </section>
      <section className="legend-row" aria-label="혼잡도 범례">
        <StatusPill level="safe" />
        <StatusPill level="normal" />
        <StatusPill level="busy" />
        <StatusPill level="crowded" />
      </section>
      <PlaceCarousel title="지도 주변 장소" places={places} onSelectPlace={onSelectPlace} />
    </div>
  );
}

function PlaceScreen({
  flagged,
  onFlag,
  onGoQuestion,
  onGoReport,
  place
}: {
  flagged: boolean;
  onFlag: () => void;
  onGoQuestion: () => void;
  onGoReport: () => void;
  place: Place;
}) {
  const isSensitive = place.category === "hospital" || place.category === "office";

  return (
    <div className="screen-stack">
      <section className="detail-hero">
        <StatusPill level={place.crowd} label={place.status} />
        <h2>{place.name}</h2>
        <p>{place.address}</p>
        <div className="detail-summary">{place.summary}</div>
        <div className="metric-row">
          <span>줄 {place.line}</span>
          <span>주차 {place.parking}</span>
          <span>날씨 {place.weather}</span>
          <span>{place.updatedAt}</span>
        </div>
      </section>

      {isSensitive && <SensitiveWarning />}

      <section className="photo-strip" aria-label="최근 사진 제보">
        <div className="section-title">
          <h2>최근 사진 제보</h2>
          <span>{place.reports}건</span>
        </div>
        <div className="photo-grid">
          {place.photos.map((photo, index) => (
            <div className="photo-tile" key={photo}>
              <Camera size={22} />
              <span>{photo}</span>
              <small>{index + 2}분 전</small>
            </div>
          ))}
        </div>
      </section>

      <section className="question-preview">
        <div className="section-title">
          <h2>질문 목록</h2>
          <span>{place.questions}개</span>
        </div>
        <article>
          <MessageCircleQuestion size={20} />
          <div>
            <strong>지금 주차장 들어갈 수 있나요?</strong>
            <p>답변 2개, 평균 6분 내 응답</p>
          </div>
        </article>
      </section>

      <div className="sticky-actions">
        <ActionButton onClick={onGoReport}>10초 제보하기</ActionButton>
        <ActionButton onClick={onGoQuestion} variant="secondary">
          질문하기
        </ActionButton>
      </div>
      <ActionButton onClick={onFlag} variant="danger" disabled={flagged}>
        <Flag size={18} />
        {flagged ? "신고 접수됨" : "민감정보/허위 제보 신고"}
      </ActionButton>
    </div>
  );
}

function SensitiveWarning() {
  return (
    <section className="sensitive-warning" role="alert">
      <ShieldAlert size={22} />
      <div>
        <strong>병원/관공서 민감정보 경고</strong>
        <p>얼굴, 차량번호, 진료 내용, 민원인 정보가 보이는 사진은 올리지 마세요.</p>
      </div>
    </section>
  );
}

function ReportScreen({
  draft,
  onChange,
  onSubmit,
  place
}: {
  draft: ReportDraft;
  onChange: (draft: ReportDraft) => void;
  onSubmit: () => void;
  place: Place;
}) {
  return (
    <form className="screen-stack" onSubmit={(event) => event.preventDefault()}>
      <section className="form-hero">
        <p className="eyebrow">10초 제보 플로우</p>
        <h2>{place.name}</h2>
        <p>탭 몇 번으로 현재 현장 상태를 남깁니다.</p>
      </section>
      {(place.category === "hospital" || place.category === "office") && <SensitiveWarning />}
      <button
        aria-pressed={draft.hasPhoto}
        className="upload-box"
        onClick={() => onChange({ ...draft, hasPhoto: !draft.hasPhoto })}
        type="button"
      >
        <Upload size={24} />
        <strong>{draft.hasPhoto ? "사진 첨부됨" : "사진 추가"}</strong>
        <span>서버 저장 전 EXIF 제거와 재인코딩을 전제로 합니다.</span>
      </button>
      <SegmentedControl
        label="혼잡도"
        onChange={(crowd) => onChange({ ...draft, crowd })}
        options={crowdOptions}
        value={draft.crowd}
      />
      <SegmentedControl
        label="줄 상태"
        onChange={(line) => onChange({ ...draft, line })}
        options={lineOptions}
        value={draft.line}
      />
      <SegmentedControl
        label="주차 상태"
        onChange={(parking) => onChange({ ...draft, parking })}
        options={parkingOptions}
        value={draft.parking}
      />
      <SegmentedControl
        label="체감 날씨"
        onChange={(weather) => onChange({ ...draft, weather })}
        options={weatherOptions}
        value={draft.weather}
      />
      <label className="text-field">
        한 줄 코멘트
        <textarea
          maxLength={80}
          onChange={(event) => onChange({ ...draft, comment: event.target.value })}
          placeholder="예: 입구 줄 짧고 주차장은 거의 찼어요."
          value={draft.comment}
        />
      </label>
      <div className="verify-card">
        <CheckCircle2 size={22} />
        <div>
          <strong>위치 인증 완료</strong>
          <p>정확한 좌표 대신 장소와의 거리 구간만 저장합니다.</p>
        </div>
      </div>
      <ActionButton onClick={onSubmit} type="button">
        제보 제출하고 질문권 받기
      </ActionButton>
    </form>
  );
}

function QuestionScreen({
  draft,
  onChange,
  onSubmit,
  place,
  questionTickets
}: {
  draft: QuestionDraft;
  onChange: (draft: QuestionDraft) => void;
  onSubmit: () => void;
  place: Place;
  questionTickets: number;
}) {
  const cost = draft.type === "photo" || draft.isPhotoRequest ? 2 : 1;

  return (
    <form className="screen-stack" onSubmit={(event) => event.preventDefault()}>
      <section className="form-hero">
        <p className="eyebrow">질문 작성</p>
        <h2>{place.name}</h2>
        <p>답변 가능성이 높은 질문 유형을 고르세요.</p>
      </section>
      <div className="ticket-card">
        <Ticket size={24} />
        <div>
          <strong>내 질문권 {questionTickets}개</strong>
          <p>이번 질문은 {cost}개 차감됩니다.</p>
        </div>
      </div>
      <SegmentedControl
        label="질문 유형"
        onChange={(type) => onChange({ ...draft, type, isPhotoRequest: type === "photo" })}
        options={questionTypes}
        value={draft.type}
      />
      <label className="toggle-line">
        <input
          checked={draft.isPhotoRequest}
          onChange={(event) => onChange({ ...draft, isPhotoRequest: event.target.checked })}
          type="checkbox"
        />
        사진 요청 포함
      </label>
      <label className="text-field">
        질문 내용
        <textarea
          maxLength={120}
          onChange={(event) => onChange({ ...draft, content: event.target.value })}
          placeholder="예: 지금 공영주차장에 빈 자리 있나요?"
          value={draft.content}
        />
      </label>
      <ActionButton disabled={questionTickets < cost} onClick={onSubmit} type="button">
        질문 등록하기
      </ActionButton>
    </form>
  );
}

function MyScreen({
  questionTickets,
  questionsSubmitted,
  reportsSubmitted,
  trustScore
}: {
  questionTickets: number;
  questionsSubmitted: number;
  reportsSubmitted: number;
  trustScore: number;
}) {
  return (
    <div className="screen-stack">
      <section className="profile-card">
        <div className="avatar">
          <Sparkles size={28} />
        </div>
        <div>
          <p className="eyebrow">신뢰 제보자</p>
          <h2>{trustScore}점</h2>
          <p>위치 인증과 신고 이력이 신뢰 배지에 반영됩니다.</p>
        </div>
      </section>
      <section className="my-grid">
        <div>
          <Ticket size={22} />
          <strong>{questionTickets}</strong>
          <span>질문권</span>
        </div>
        <div>
          <Camera size={22} />
          <strong>{reportsSubmitted}</strong>
          <span>내 제보</span>
        </div>
        <div>
          <MessageCircleQuestion size={22} />
          <strong>{questionsSubmitted}</strong>
          <span>내 질문</span>
        </div>
      </section>
      <section className="policy-list">
        <h2>안전 정책</h2>
        <p>원본 좌표는 공개하지 않고 거리 구간으로만 표시합니다.</p>
        <p>사진 제보는 개인정보 신고와 3시간 만료 정책을 적용합니다.</p>
        <p>허위 확정 신고는 신뢰 점수와 질문권 차감에 반영됩니다.</p>
      </section>
    </div>
  );
}

function BottomNav({ activeTab, onChange }: { activeTab: TabId; onChange: (tab: TabId) => void }) {
  return (
    <nav className="bottom-nav" aria-label="주요 화면">
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <button
            aria-current={activeTab === item.id ? "page" : undefined}
            className="nav-button"
            key={item.id}
            onClick={() => onChange(item.id)}
            type="button"
          >
            <Icon size={20} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
