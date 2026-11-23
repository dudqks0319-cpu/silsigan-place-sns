"use client";

import { ArrowUpRight, Baby, Bookmark, Check, Coffee, Compass, MapPin, ParkingCircle, Phone, Utensils } from "lucide-react";
import type { LocalPlace, PlaceCategory } from "../types";
import { Dialog, safeUrl } from "./primitives";
import styles from "./LocalLive.module.css";

export function CategoryIcon({ category, size = 22 }: { category: PlaceCategory; size?: number }) {
  const Icon = category === "restaurant" ? Utensils : category === "cafe" ? Coffee : category === "parking" ? ParkingCircle : category === "family" ? Baby : Compass;
  return <Icon size={size} strokeWidth={1.6} aria-hidden="true" />;
}

export function PlaceCard({ place, saved, onSave, onSelect, guide = false }: { place: LocalPlace; saved: boolean; onSave: () => void; onSelect: () => void; guide?: boolean }) {
  return <article className={styles.placeCard}>
    <div className={styles.placeCardTop}><span className={`${styles.placeCategoryIcon} ${styles[`category_${place.category}`]}`}><CategoryIcon category={place.category} size={25} /></span><button type="button" className={`${styles.saveButton} ${saved ? styles.saved : ""}`} aria-label={`${place.name} ${saved ? "저장 취소" : "저장"}`} aria-pressed={saved} onClick={onSave}><Bookmark size={19} fill={saved ? "currentColor" : "none"} /></button></div>
    <button type="button" className={styles.placeSelect} onClick={onSelect}><span className={styles.placeCategory}>{place.categoryLabel}</span><h3>{place.name}<ArrowUpRight size={19} /></h3><p><MapPin size={14} />{place.address}</p></button>
    <div className={styles.placeCardBottom}><span>{guide ? "기본 장소 안내" : place.sourceName}</span><span>현장 상황 미확인</span></div>
  </article>;
}

export function PlaceDetail({ place, saved, onSave, onClose }: { place: LocalPlace; saved: boolean; onSave: () => void; onClose: () => void }) {
  const telephone = place.phone?.replace(/[^+\d]/g, "");
  return <Dialog title={place.name} description={place.categoryLabel} onClose={onClose}>
    <div className={styles.placeDetailIcon}><CategoryIcon category={place.category} size={37} /></div>
    <p className={styles.detailAddress}><MapPin size={18} />{place.address}</p>
    {telephone && <a className={styles.detailPhone} href={`tel:${telephone}`}><Phone size={17} />{place.phone}</a>}
    <div className={styles.placeFacts}><h3>방문 전에 확인해 주세요</h3><p>영업시간, 대기 줄, 주차 여유와 유아 편의시설은 아직 확인되지 않았어요. 원본 장소 정보에서 확인해 주세요.</p></div>
    <div className={styles.detailActions}><a className={styles.primaryButton} href={safeUrl(place.mapUrl)} target="_blank" rel="noreferrer">지도에서 보기<ArrowUpRight size={17} /></a><button type="button" className={styles.secondaryButton} onClick={onSave} aria-pressed={saved}>{saved ? <Check size={17} /> : <Bookmark size={17} />}{saved ? "저장됨" : "장소 저장"}</button></div>
    <a className={styles.detailSource} href={safeUrl(place.sourceUrl)} target="_blank" rel="noreferrer">{place.sourceName}에서 원본 정보 보기<ArrowUpRight size={14} /></a>
    <p className={styles.dialogNote}>장소 저장은 현재 브라우저에 보관돼요. 기기를 바꾸면 목록이 달라질 수 있어요.</p>
  </Dialog>;
}
