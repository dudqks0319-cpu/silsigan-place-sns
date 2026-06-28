"use client";

import styles from "./SilsiganRedesign.module.css";

export type RegionTabId = "nationwide" | "busan" | "gyeongju" | "ulsan";

const regionTabs: Array<{ id: RegionTabId; label: string; caption: string }> = [
  { id: "nationwide", label: "첫 지역", caption: "부산·경주·울산" },
  { id: "busan", label: "부산", caption: "주차/해변" },
  { id: "gyeongju", label: "경주", caption: "웨이팅/관광" },
  { id: "ulsan", label: "울산", caption: "산책/도심" },
];

export function RegionTabs({ activeRegion, onChange }: { activeRegion: RegionTabId; onChange: (region: RegionTabId) => void }) {
  return (
    <div className={styles.regionTabs} role="tablist" aria-label="지역 랭킹 선택">
      {regionTabs.map((tab) => (
        <button
          key={tab.id}
          aria-selected={activeRegion === tab.id}
          className={activeRegion === tab.id ? styles.regionTabActive : ""}
          role="tab"
          type="button"
          onClick={() => onChange(tab.id)}
        >
          <strong>{tab.label}</strong>
          <span>{tab.caption}</span>
        </button>
      ))}
    </div>
  );
}
