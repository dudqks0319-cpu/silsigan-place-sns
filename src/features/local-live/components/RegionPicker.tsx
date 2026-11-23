"use client";

import { Check, LoaderCircle, LocateFixed, MapPin, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { findNearestRegion, REGIONS } from "../regions";
import type { Region } from "../types";
import { Dialog } from "./primitives";
import styles from "./LocalLive.module.css";

export function RegionPicker({ selected, onSelect, onClose }: { selected: Region; onSelect: (region: Region, viaLocation?: boolean) => void; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const regions = REGIONS.filter((region) => `${region.name} ${region.province}`.includes(search.trim()));

  function locate() {
    if (!navigator.geolocation) { setError("이 브라우저에서는 위치를 확인할 수 없어요. 아래에서 지역을 선택해 주세요."); return; }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition((position) => {
      if (!active.current) return;
      const nearest = findNearestRegion(position.coords.latitude, position.coords.longitude);
      setLocating(false);
      if (!nearest) { setError("가까운 지원 지역을 찾지 못했어요. 아래 목록에서 선택해 주세요."); return; }
      onSelect(nearest, true);
    }, (reason) => {
      if (!active.current) return;
      setLocating(false);
      setError(reason.code === 1 ? "위치 권한을 허용하지 않아도 이용할 수 있어요. 지역을 직접 선택해 주세요." : "위치를 확인하지 못했어요. 다시 시도하거나 지역을 선택해 주세요.");
    }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 });
  }

  return <Dialog title="어느 지역이 궁금하세요?" description="사는 동네도, 다음에 갈 여행지도 선택해 보세요." onClose={onClose} wide>
    <label className={styles.regionSearch}><Search size={20} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="지역 이름 검색" aria-label="지역 이름 검색" /></label>
    <button type="button" className={styles.locateButton} onClick={locate} disabled={locating}>{locating ? <LoaderCircle size={18} className={styles.spinning} /> : <LocateFixed size={18} />}{locating ? "현재 위치 확인 중…" : "현재 위치로 지역 찾기"}</button>
    <p className={styles.locationPrivacy}>위치는 기기에서 가까운 지원 지역을 찾는 데만 사용해요.</p>
    {error && <p role="alert" className={styles.inlineError}>{error}</p>}
    <div className={styles.regionList}>{regions.map((region) => <button key={region.id} type="button" className={selected.id === region.id ? styles.regionSelected : ""} onClick={() => onSelect(region)} aria-pressed={selected.id === region.id}><MapPin size={17} /><span>{region.name}<small>{region.province}</small></span>{selected.id === region.id && <Check size={17} />}</button>)}</div>
    {regions.length === 0 && <p className={styles.noRegions}>검색한 지역이 없어요. 다른 도시 이름으로 찾아보세요.</p>}
    <p className={styles.dialogNote}>날씨는 선택한 도시의 대표 지점 기준입니다. 주변 장소와 현장 정보의 제공 범위는 지역에 따라 달라요.</p>
  </Dialog>;
}
