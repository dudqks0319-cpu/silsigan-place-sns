"use client";

import styles from "./SilsiganRedesign.module.css";

export type RegionTabId = "nationwide" | "seoul" | "busan" | "jeju";

const regionTabs: Array<{ id: RegionTabId; label: string; caption: string }> = [
  { id: "nationwide", label: "전국", caption: "전체 랭킹" },
  { id: "seoul", label: "서울", caption: "수도권 준비" },
  { id: "busan", label: "부산", caption: "해안/축제" },
  { id: "jeju", label: "제주", caption: "여행지" },
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
