"use client";

import { MapPin, Trophy } from "lucide-react";
import styles from "./SilsiganRedesign.module.css";
import { EmptyState } from "./EmptyState";

export type RankingPlace = {
  id: string;
  name: string;
  address: string;
  signal: string;
  summary: string;
  score: number;
  tone: "calm" | "normal" | "busy" | "danger" | "unknown";
  visitors: string;
};

export function RankingPanel({
  emptyBody,
  onOpenPlace,
  places,
  title,
}: {
  emptyBody: string;
  onOpenPlace: (place: RankingPlace) => void;
  places: RankingPlace[];
  title: string;
}) {
  return (
    <section className={styles.rankingPanel} aria-label={title}>
      <div className={styles.panelTitleRow}>
        <div>
          <p className={styles.eyebrow}>TOP 10</p>
          <h2>{title}</h2>
        </div>
        <Trophy size={19} aria-hidden />
      </div>
      {places.length === 0 ? (
        <EmptyState title="아직 순위를 만들 현장 정보가 없어요" body={emptyBody} />
      ) : (
        <div className={styles.rankingList}>
          {places.slice(0, 10).map((place, index) => (
            <button key={place.id} className={styles.rankingButton} type="button" onClick={() => onOpenPlace(place)}>
              <span className={styles.rank}>{index + 1}</span>
              <div>
                <strong>{place.name}</strong>
                <p>
                  <MapPin size={13} aria-hidden /> {place.address}
                </p>
                <small>{place.summary}</small>
              </div>
              <span className={`${styles.statusChip} ${styles[place.tone]}`}>{place.signal}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
