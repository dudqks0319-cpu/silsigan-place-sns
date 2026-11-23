"use client";

import { Cloud, CloudDrizzle, CloudSun, Droplets, Leaf, Snowflake, Wind } from "lucide-react";
import { useContext } from "react";
import type { DataResult, RegionSnapshot } from "../types";
import { DisplayTimeContext, effectiveStatus, formatTime, SourceLine } from "./primitives";
import styles from "./LocalLive.module.css";

function ConditionIcon({ condition, size = 26 }: { condition: string; size?: number }) {
  if (/눈/.test(condition)) return <Snowflake size={size} aria-hidden="true" />;
  if (/비|소나기|강수/.test(condition) && !/없음/.test(condition)) return <CloudDrizzle size={size} aria-hidden="true" />;
  if (/맑/.test(condition)) return <CloudSun size={size} aria-hidden="true" />;
  return <Cloud size={size} aria-hidden="true" />;
}

function unknownMessage(result: DataResult<unknown> | undefined, subject: string) {
  if (result?.status === "not_configured") return `${subject} 연결을 준비하고 있어요`;
  if (result?.status === "unsupported") return `이 지역의 ${subject}를 확인하고 있어요`;
  return `${subject}를 아직 받지 못했어요`;
}

export function WeatherPanels({ data, loading }: { data: RegionSnapshot | null; loading: boolean }) {
  const now = useContext(DisplayTimeContext);
  const weather = data?.weather;
  const current = weather?.data;
  const forecast = data?.forecast;
  const air = data?.airQuality;
  const readings = air?.data;
  const upcoming = forecast?.data?.filter((hour) => Date.parse(hour.at) > now).slice(0, 6) ?? [];
  return <div className={styles.weatherGrid}>
    <section className={styles.weatherCard} aria-labelledby="current-weather-title" aria-busy={loading && !data}>
      <div className={styles.cardEyebrow}><span id="current-weather-title">지금 날씨</span><span className={styles.subtleTag}>{weather && effectiveStatus(weather, now) === "stale" ? "이전 관측" : "기상 관측"}</span></div>
      <div className={styles.weatherMain}>
        <div><div className={styles.temperature}>{current?.temperatureC !== null && current?.temperatureC !== undefined ? Math.round(current.temperatureC) : "—"}<span>°</span></div><h2>{current ? current.condition : loading ? "날씨를 확인하고 있어요" : "아직 관측 정보가 없어요"}</h2><p>{current ? "선택한 지역의 대표 격자 기준" : "실제 관측값이 도착하면 표시할게요."}</p></div>
        <div className={`${styles.weatherArt} ${!current ? styles.weatherArtEmpty : ""}`}><ConditionIcon condition={current?.condition ?? ""} size={90} /></div>
      </div>
      <div className={styles.weatherMetrics}>
        <div><Droplets size={16} /><span>습도</span><strong>{current?.humidityPercent !== null && current?.humidityPercent !== undefined ? `${current.humidityPercent}%` : "—"}</strong></div>
        <div><Wind size={16} /><span>바람</span><strong>{current?.windSpeedMs !== null && current?.windSpeedMs !== undefined ? `${current.windSpeedMs} m/s` : "—"}</strong></div>
        <div><CloudDrizzle size={16} /><span>강수량</span><strong>{current?.precipitationMm !== null && current?.precipitationMm !== undefined ? `${current.precipitationMm} mm` : "—"}</strong></div>
      </div>
      {weather && <SourceLine result={weather} inverse />}
      {forecast && upcoming.length > 0 ? <div className={styles.forecast}>
        <div className={styles.forecastHeading}><span>앞으로의 날씨</span><span>{effectiveStatus(forecast, now) === "stale" ? "이전 예보" : "예보"}</span></div>
        <div className={styles.forecastHours}>{upcoming.map((hour) => <div key={hour.at}><time dateTime={hour.at}>{formatTime(hour.at)}</time><ConditionIcon condition={hour.condition} size={21} /><strong>{hour.temperatureC === null ? "—" : `${Math.round(hour.temperatureC)}°`}</strong><span>{hour.condition}</span></div>)}</div>
        <SourceLine result={forecast} inverse />
      </div> : <div className={styles.forecastEmpty}><ClockGlyph /><span>{forecast?.data?.length ? "예보 기준 시간이 지났어요. 새로운 예보를 기다리고 있어요." : loading && !data ? "시간별 예보를 불러오는 중" : unknownMessage(forecast, "시간별 예보")}</span></div>}
    </section>
    <section className={styles.airCard} aria-labelledby="air-quality-title">
      <div className={styles.cardEyebrow}><span id="air-quality-title">오늘의 공기</span><Leaf size={19} /></div>
      <div className={styles.airIllustration}><Leaf size={39} strokeWidth={1.3} /></div>
      <h2>{readings ? "대기질 관측" : "공기 정보 확인 전"}</h2>
      <p>{readings ? `${readings.stationName} 측정소 기준` : "측정소에서 확인한 정보만 알려드려요."}</p>
      <div className={styles.airReadings}>
        <div><span>미세먼지 <small>PM10</small></span><strong>{readings?.pm10 !== null && readings?.pm10 !== undefined ? readings.pm10 : "—"}<small>μg/m³</small></strong>{readings?.pm10Grade && <span>{readings.pm10Grade}</span>}</div>
        <div><span>초미세먼지 <small>PM2.5</small></span><strong>{readings?.pm25 !== null && readings?.pm25 !== undefined ? readings.pm25 : "—"}<small>μg/m³</small></strong>{readings?.pm25Grade && <span>{readings.pm25Grade}</span>}</div>
      </div>
      {air && <SourceLine result={air} />}
      {!readings && <p className={styles.airNote}>{unknownMessage(air, "대기질 정보")}</p>}
    </section>
  </div>;
}

function ClockGlyph() { return <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" /><path d="M10 6v4l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>; }
