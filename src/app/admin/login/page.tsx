"use client";

import { useEffect, useState, type FormEvent } from "react";
import styles from "./page.module.css";

export default function AdminLoginPage() {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("관리자 토큰은 이 로그인 요청에만 사용됩니다.");

  useEffect(() => {
    const readyId = window.setTimeout(() => setReady(true), 0);
    return () => window.clearTimeout(readyId);
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready || submitting || !token) {
      return;
    }

    setSubmitting(true);
    setNotice("관리자 인증을 확인하고 있습니다.");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) {
        throw new Error("관리자 토큰을 확인해 주세요.");
      }

      setToken("");
      window.location.assign("/admin/moderation/posts");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "관리자 인증에 실패했습니다.");
      setSubmitting(false);
    }
  };

  return (
    <main className={styles.page}>
      <form className={styles.card} onSubmit={submit}>
        <p>#실시간 Admin</p>
        <h1>관리자 인증</h1>
        <label>
          관리자 토큰
          <input
            name="token"
            type="password"
            autoComplete="current-password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            disabled={submitting}
            required
          />
        </label>
        <button type="submit" disabled={!ready || submitting || !token}>
          {submitting ? "인증 확인 중" : "운영 큐 열기"}
        </button>
        <span aria-live="polite">{notice}</span>
        <span>프로덕션에서는 `SILSIGAN_ADMIN_TOKEN` 환경변수가 필요합니다.</span>
      </form>
    </main>
  );
}
