import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const redesignSource = readFileSync(resolve(testDir, "../src/components/silsigan/SilsiganRedesign.tsx"), "utf8");
const redesignCss = readFileSync(resolve(testDir, "../src/components/silsigan/SilsiganRedesign.module.css"), "utf8");

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker, startIndex);

  assert.notEqual(startIndex, -1, `${startMarker} must exist`);
  assert.notEqual(endIndex, -1, `${endMarker} must exist after ${startMarker}`);
  return source.slice(startIndex, endIndex);
}

test("home leads with a photo decision card and both primary actions", () => {
  const homeScreen = sourceBetween(redesignSource, "function HomeScreen({", "function SearchScreen");
  const photoIndex = homeScreen.indexOf('className={styles.photoLeadCard}');
  const decisionHeroIndex = homeScreen.indexOf('className={styles.homeDecisionHero}');
  const weatherIndex = homeScreen.indexOf('className={styles.homeWeather}');

  assert.notEqual(photoIndex, -1);
  assert.ok(photoIndex < decisionHeroIndex, "recent photo must precede the explanatory hero");
  assert.ok(photoIndex < weatherIndex, "recent photo must precede weather details");
  assert.match(homeScreen, /photoLeadDecision/);
  assert.match(homeScreen, /최근 \$\{leadPost \? minutesAgo\(leadPost\.createdAt\) : "방금 전"\}/);
  assert.match(homeScreen, /실시간 사진 보기/);
  assert.match(homeScreen, /지금컷 올리기/);
});

test("navigation and overlays expose keyboard and motion accessibility contracts", () => {
  assert.match(redesignSource, /function useModalFocus/);
  assert.match(redesignSource, /event\.key === "Escape"/);
  assert.match(redesignSource, /aria-current=\{isActive \? "page" : undefined\}/);
  assert.match(redesignSource, /role="dialog" aria-modal="true" aria-labelledby="onboarding-title"/);
  assert.match(redesignSource, /id="onboarding-title"/);
  assert.match(redesignCss, /@media \(prefers-reduced-motion: reduce\)/);
});
