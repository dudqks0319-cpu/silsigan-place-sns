"use client";

import { ArrowRight, ArrowUpRight, Bookmark, ChevronDown, Compass, Hash, Info, MapPin, Radio, RefreshCw, Search, WifiOff, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { DEFAULT_REGION_ID, getRegion } from "../regions";
import type { LocalPlace, PlaceCategory, Region } from "../types";
import { useRegionSnapshot } from "../hooks/useRegionSnapshot";
import { useSavedPlaces } from "../hooks/useSavedPlaces";
import { CategoryIcon, PlaceCard, PlaceDetail } from "./PlaceCard";
import { RegionPicker } from "./RegionPicker";
import { ReportsPanel } from "./ReportsPanel";
import { DisplayTimeContext, effectiveStatus, EmptyState, formatTime, LoadingCards, SourceDetails, SourceLine } from "./primitives";
import { WeatherPanels } from "./WeatherPanels";
import styles from "./LocalLive.module.css";

type View = "now" | "explore" | "saved";
const navItems = [{ id: "now" as const, label: "지역의 지금", mobileLabel: "지금", icon: Radio }, { id: "explore" as const, label: "주변 장소", mobileLabel: "주변 장소", icon: Compass }, { id: "saved" as const, label: "저장한 곳", mobileLabel: "저장한 곳", icon: Bookmark }];
const categories: { id: PlaceCategory; label: string }[] = [{ id: "all", label: "전체" }, { id: "attraction", label: "볼거리" }, { id: "restaurant", label: "맛집" }, { id: "cafe", label: "카페" }, { id: "parking", label: "주차" }, { id: "family", label: "아이랑" }];

export default function LocalLiveApp() {
  const [regionId, setRegionId] = useState(DEFAULT_REGION_ID);
  const [view, setView] = useState<View>("now");
  const [category, setCategory] = useState<PlaceCategory>("all");
  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState("");
  const [regionOpen, setRegionOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<LocalPlace | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const region = getRegion(regionId);
  const { data, loading, error, online, refresh } = useRegionSnapshot(regionId, category, query);
  const favorites = useSavedPlaces();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setClock(Date.now());
      const requested = new URLSearchParams(window.location.search).get("region");
      try { setRegionId(getRegion(requested ?? localStorage.getItem("silsigan:region:v1") ?? DEFAULT_REGION_ID).id); }
      catch { if (requested) setRegionId(getRegion(requested).id); }
    }, 0);
    const ticker = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => { window.clearTimeout(timer); window.clearInterval(ticker); };
  }, []);

  function changeRegion(next: Region, viaLocation = false) {
    setRegionId(next.id);
    setCategory("all");
    setSearchText("");
    setQuery("");
    setRegionOpen(false);
    setNotice(viaLocation ? `현재 위치에서 가까운 지원 지역인 ${next.name}을 선택했어요. 날씨는 도시의 대표 지점 기준입니다.` : null);
    try { localStorage.setItem("silsigan:region:v1", next.id); } catch { /* Region selection works without persistence. */ }
    const url = new URL(window.location.href);
    url.searchParams.set("region", next.id);
    window.history.replaceState(null, "", url);
  }

  function search(event: FormEvent) { event.preventDefault(); setQuery(searchText.trim()); setView("explore"); }
  function clearSearch() { setSearchText(""); setQuery(""); setCategory("all"); }
  const livePlaces = data?.places.data ?? [];
  const guidePlaces = data?.guidePlaces ?? [];
  const showingGuide = data?.places.data === null && guidePlaces.length > 0;
  const places = showingGuide ? guidePlaces : livePlaces;
  const shownPlaces = view === "now" ? places.slice(0, 4) : places;
  const allUnconfigured = data && [data.weather, data.forecast, data.airQuality, data.places, data.reports].every((item) => item.status === "not_configured" || item.status === "unsupported");
  const hasStaleData = data && [data.weather, data.forecast, data.airQuality, data.places, data.reports].some((item) => effectiveStatus(item, clock) === "stale");
  const sectionTitle = view === "saved" ? "다음에 가고 싶은 곳" : view === "explore" ? `${region.name}의 장소 찾기` : "어디가 궁금하세요?";

  return <DisplayTimeContext.Provider value={clock}><div className={styles.app}>
    <a className={styles.skipLink} href="#local-main">본문으로 바로가기</a>
    <div className={styles.shell}>
      <aside className={styles.rail}>
        <Link href="/" className={styles.brand} aria-label="실시간 홈"><span className={styles.brandMark}><Hash size={26} strokeWidth={2.4} /></span><span>실시간<small>THE LOCAL, NOW.</small></span></Link>
        <div className={styles.railDivider} />
        <nav aria-label="주 메뉴" className={styles.desktopNav}>{navItems.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={view === id ? styles.navActive : ""} onClick={() => setView(id)} aria-current={view === id ? "page" : undefined}><Icon size={20} /><span>{label}</span>{id === "saved" && favorites.saved.length > 0 && <small>{favorites.saved.length}</small>}</button>)}</nav>
        <div className={styles.railBottom}><span className={styles.railEyebrow}>가까운 일상의 발견</span><p>지금, 우리 동네는<br />어떤 모습일까요?</p><span className={styles.railDot} /><small>날씨부터 주변 장소까지</small></div>
      </aside>
      <div className={styles.content}>
        <header className={styles.topbar}><Link href="/" className={styles.mobileBrand}><Hash size={23} />실시간</Link><span className={styles.topbarIntro}>가까운 곳부터, 새로운 발견</span><div className={styles.topbarActions}><button type="button" className={styles.regionButton} onClick={() => setRegionOpen(true)}><MapPin size={17} /><span>{region.name}</span><ChevronDown size={16} /></button><button type="button" className={styles.iconButton} disabled={loading} onClick={refresh} aria-label="지역 정보 새로고침"><RefreshCw size={18} className={loading ? styles.spinning : ""} /></button><button type="button" className={styles.iconButton} disabled={!data} onClick={() => setSourcesOpen(true)} aria-label="정보 출처와 갱신 시각 보기"><Info size={19} /></button></div></header>
        <main id="local-main" className={styles.main}>
          <section className={styles.intro}><div><span className={styles.eyebrow}>{view === "saved" ? "YOUR LITTLE COLLECTION" : "HERE & NOW"}</span><h1>{view === "saved" ? <>마음에 든 곳,<br className={styles.mobileBreak} /> 모아 두세요.</> : <>{region.name}의 지금<span className={styles.headingDot}>.</span></>}</h1><p>{view === "saved" ? "저장한 장소를 다시 찾아, 다음 나들이를 준비해요." : region.tagline}</p></div><div className={styles.updateStatus}>{online ? <span className={styles.connectionDot} /> : <WifiOff size={14} />}<span>{!online ? "오프라인 · 마지막 조회 정보" : loading ? "지역 정보를 확인하고 있어요" : data ? `${formatTime(data.generatedAt)} 앱 조회 · 3분마다 확인` : "지역 정보 연결 대기"}</span></div></section>
          {hasStaleData && <div className={styles.notice} role="status"><Info size={17} /><p>일부 정보의 갱신 시간이 지났어요. 각 카드의 기준 시각을 확인해 주세요.</p></div>}
          {notice && <div className={styles.notice} role="status"><MapPin size={18} /><p>{notice}</p><button type="button" className={styles.iconButton} onClick={() => setNotice(null)} aria-label="안내 닫기"><X size={17} /></button></div>}
          {error && <div className={styles.errorBanner} role="alert"><Info size={19} /><p>{error}{data ? " 마지막으로 받은 정보를 표시하고 있어요." : ""}</p><button type="button" onClick={refresh} disabled={loading}>다시 시도<RefreshCw size={14} /></button></div>}
          {favorites.warning && <p className={styles.storageWarning} role="status">{favorites.warning}</p>}

          {view === "now" && <><WeatherPanels data={data} loading={loading} />{allUnconfigured && <div className={styles.connectionNotice}><Info size={17} /><p>이 지역의 최신 정보를 연결하고 있어요.{showingGuide ? " 아래의 기본 장소 안내부터 둘러보세요." : " 확인되지 않은 수치는 표시하지 않아요."}</p><button type="button" onClick={() => setSourcesOpen(true)}>연결 상태<ArrowUpRight size={14} /></button></div>}</>}

          <div className={view === "now" ? styles.mainColumns : styles.singleColumn}>
            <section className={styles.placesSection} aria-labelledby="places-heading">
              <div className={styles.sectionHead}><div><span className={styles.eyebrow}>{view === "saved" ? "SAVED FOR LATER" : "PLACES TO DISCOVER"}</span><h2 id="places-heading">{sectionTitle}</h2></div>{view === "now" && <button type="button" className={styles.textButton} onClick={() => setView("explore")}>전체 보기<ArrowRight size={16} /></button>}{view === "saved" && <span className={styles.countBadge}>{favorites.saved.length}곳</span>}</div>
              {view === "saved" ? <><p className={styles.sectionDescription}>현재 기기의 이 브라우저에 저장한 목록이에요.</p>{favorites.saved.length ? <div className={styles.placeGrid}>{favorites.saved.map((place) => <PlaceCard key={place.id} place={place} saved onSave={() => favorites.toggle(place)} onSelect={() => setSelectedPlace(place)} />)}</div> : <EmptyState icon={<Bookmark size={30} />} title="아직 저장한 장소가 없어요">장소 카드의 북마크를 눌러 보세요.<br />마음에 든 곳을 여기에 모아둘게요.<button type="button" className={styles.primaryButton} onClick={() => setView("explore")}>주변 장소 둘러보기<ArrowRight size={16} /></button></EmptyState>}</> : <>
                <form className={styles.searchForm} onSubmit={search} role="search"><Search size={19} /><input type="search" aria-label={`${region.name} 장소 검색`} maxLength={80} value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder={`${region.name}의 장소, 카페를 찾아보세요`} /><button type="submit" aria-label="장소 검색">검색</button></form>
                <div className={styles.categories} role="group" aria-label="장소 카테고리">{categories.map((item) => <button type="button" key={item.id} className={category === item.id ? styles.categoryActive : ""} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}><CategoryIcon category={item.id} size={16} />{item.label}</button>)}</div>
                {query && <div className={styles.searchSummary}><span>“{query}” 검색 결과</span><button type="button" onClick={clearSearch}>검색 초기화<X size={13} /></button></div>}
                {showingGuide && <div className={styles.guideLabel}><Info size={14} /><span>기본 장소 안내 · 실시간 현장 정보가 아니에요</span></div>}
                {loading && !data ? <LoadingCards /> : shownPlaces.length ? <div className={styles.placeGrid}>{shownPlaces.map((place) => <PlaceCard key={place.id} place={place} saved={favorites.isSaved(place.id)} guide={showingGuide} onSave={() => favorites.toggle(place)} onSelect={() => setSelectedPlace(place)} />)}</div> : <EmptyState icon={<Compass size={31} />} title={query ? "검색한 장소를 찾지 못했어요" : "아직 표시할 장소가 없어요"}>{data?.places.status === "not_configured" ? "이 지역의 장소 검색을 연결하고 있어요. 지도에서 먼저 둘러볼 수 있어요." : "다른 검색어 또는 지역을 선택해 보세요. 확인 가능한 장소만 보여드려요."}<div className={styles.emptyActions}><a className={styles.secondaryButton} href={`https://map.naver.com/p/search/${encodeURIComponent(`${region.name} ${query}`.trim())}`} target="_blank" rel="noreferrer">지도에서 찾기<ArrowUpRight size={16} /></a>{(query || category !== "all") && <button type="button" className={styles.textButton} onClick={clearSearch}>필터 초기화</button>}</div></EmptyState>}
                {data && !showingGuide && <SourceLine result={data.places} />}
                {category === "family" && <p className={styles.familyNote}><Info size={14} /> 어린이 관련 검색 결과예요. 수유실·기저귀 교환대·유모차 접근성은 방문 전 장소에 확인해 주세요.</p>}
              </>}
            </section>
            {view === "now" && <ReportsPanel reports={data?.reports} region={region} />}
          </div>
          <footer className={styles.footer}><span><Hash size={15} />실시간</span><p>우리 동네의 지금을, 출처와 함께.</p><button type="button" disabled={!data} onClick={() => setSourcesOpen(true)}>정보 제공 기준<ArrowUpRight size={13} /></button></footer>
        </main>
      </div>
    </div>
    <nav className={styles.mobileNav} aria-label="모바일 주 메뉴">{navItems.map(({ id, mobileLabel, icon: Icon }) => <button type="button" key={id} className={view === id ? styles.mobileNavActive : ""} onClick={() => setView(id)} aria-current={view === id ? "page" : undefined}><Icon size={21} fill={id === "saved" && view === id ? "currentColor" : "none"} /><span>{mobileLabel}</span></button>)}</nav>
    {regionOpen && <RegionPicker selected={region} onSelect={changeRegion} onClose={() => setRegionOpen(false)} />}
    {selectedPlace && <PlaceDetail place={selectedPlace} saved={favorites.isSaved(selectedPlace.id)} onSave={() => favorites.toggle(selectedPlace)} onClose={() => setSelectedPlace(null)} />}
    {sourcesOpen && data && <SourceDetails onClose={() => setSourcesOpen(false)} data={[{ label: "현재 날씨", result: data.weather }, { label: "시간별 예보", result: data.forecast }, { label: "대기질", result: data.airQuality }, { label: "주변 장소", result: data.places }, { label: "현장 제보", result: data.reports }]} />}
    <span className={styles.screenReader} role="status">{loading ? "지역 정보를 불러오는 중입니다." : data ? `${region.name} 지역 정보 조회가 완료되었습니다.` : ""}</span>
  </div></DisplayTimeContext.Provider>;
}
