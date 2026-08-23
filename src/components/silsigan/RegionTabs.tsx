"use client";

import styles from "./SilsiganRedesign.module.css";
import { KOREA_SIDO_REGIONS, type KoreaRegionScopeId } from "../../../packages/contracts/src/index.ts";

export type RegionTabId = KoreaRegionScopeId;

const regionTabs: Array<{ id: RegionTabId; label: string; caption: string }> = [
  { id: "nationwide", label: "전국", caption: "전국 기본" },
  ...KOREA_SIDO_REGIONS.map((region) => ({ id: region.id, label: region.name, caption: "지역 보기" })),
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
