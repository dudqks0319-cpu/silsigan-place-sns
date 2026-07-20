"use client";

import { type KeyboardEvent, useRef } from "react";
import styles from "./SilsiganRedesign.module.css";

export type RegionTabId = "nationwide" | "seoul" | "busan" | "jeju";

const regionTabs: Array<{ id: RegionTabId; label: string; caption: string }> = [
  { id: "nationwide", label: "전국", caption: "전국 검색" },
  { id: "seoul", label: "서울", caption: "도심/한강" },
  { id: "busan", label: "부산", caption: "해안/축제" },
  { id: "jeju", label: "제주", caption: "여행지" },
];

export function RegionTabs({ activeRegion, onChange }: { activeRegion: RegionTabId; onChange: (region: RegionTabId) => void }) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % regionTabs.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + regionTabs.length) % regionTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = regionTabs.length - 1;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    const nextTab = regionTabs[nextIndex];
    onChange(nextTab.id);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <div className={styles.regionTabs} role="tablist" aria-label="지역 랭킹 선택" aria-orientation="horizontal">
      {regionTabs.map((tab, index) => (
        <button
          key={tab.id}
          id={`map-region-tab-${tab.id}`}
          ref={(element) => { tabRefs.current[index] = element; }}
          aria-controls="map-region-results"
          aria-selected={activeRegion === tab.id}
          className={activeRegion === tab.id ? styles.regionTabActive : ""}
          role="tab"
          tabIndex={activeRegion === tab.id ? 0 : -1}
          type="button"
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          <strong>{tab.label}</strong>
          <span>{tab.caption}</span>
        </button>
      ))}
    </div>
  );
}
