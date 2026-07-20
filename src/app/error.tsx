"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";
import styles from "./error.module.css";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    trackEvent("app_runtime_error", { surface: "app_route" });
  }, []);

  return (
    <main className={styles.page}>
      <section className={styles.card} role="alert">
        <span aria-hidden="true">!</span>
        <p>#실시간</p>
        <h1>화면을 불러오지 못했습니다</h1>
        <strong>입력하신 내용이나 기술 오류 상세는 이 화면에 표시하지 않습니다.</strong>
        <div className={styles.actions}>
          <button type="button" onClick={() => reset()}>다시 시도</button>
          <a href="/support">도움말 보기</a>
        </div>
      </section>
    </main>
  );
}
