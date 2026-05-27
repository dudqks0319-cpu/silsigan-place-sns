"use client";

import { useState } from "react";
import { trackEvent } from "@/lib/analytics";
import styles from "./page.module.css";

type ModerationQueueItem = {
  post: {
    id: string;
    creatorName: string;
    caption: string | null;
    photoLabel: string;
    createdAt: string;
  };
  place: {
    name: string;
  };
  flagReasons: string[];
  flagCount: number;
  hidden: boolean;
  recommendedAction: string;
};

export function ModerationQueueClient({ initialItems }: { initialItems: ModerationQueueItem[] }) {
  const [items, setItems] = useState(initialItems);

  const applyAction = (postId: string, action: "keep" | "hide" | "delete" | "restrict_author") => {
    setItems((current) =>
      current.map((item) =>
        item.post.id === postId
          ? {
              ...item,
              hidden: action === "keep" ? item.hidden : true,
              recommendedAction: actionLabel(action),
            }
          : item,
      ),
    );
    trackEvent("moderate_post", { postId, action });
    void fetch("/api/admin/moderation/posts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ postId, action }),
    }).catch(() => undefined);
  };

  return (
    <div className={styles.queueList}>
      {items.map((item) => (
        <article key={item.post.id} className={styles.queueItem}>
          <div className={styles.thumb}>{item.hidden ? "숨김" : "검토"}</div>
          <div className={styles.itemBody}>
            <div className={styles.itemHeader}>
              <div>
                <strong>{item.place.name}</strong>
                <span>{item.post.creatorName} · 신고 {item.flagCount}건</span>
              </div>
              <em>{item.recommendedAction}</em>
            </div>
            <p>{item.post.caption ?? item.post.photoLabel}</p>
            <div className={styles.reasonRow}>
              {(item.flagReasons.length ? item.flagReasons : ["신고 대기 없음"]).map((reason) => (
                <span key={reason}>{reasonLabel(reason)}</span>
              ))}
            </div>
            <div className={styles.actionRow}>
              <button type="button" onClick={() => applyAction(item.post.id, "keep")}>유지</button>
              <button type="button" onClick={() => applyAction(item.post.id, "hide")}>숨김</button>
              <button type="button" onClick={() => applyAction(item.post.id, "delete")}>삭제</button>
              <button type="button" onClick={() => applyAction(item.post.id, "restrict_author")}>작성자 제한</button>
            </div>
          </div>
        </article>
      ))}
      {items.length === 0 && (
        <section className={styles.empty}>
          <strong>검토 대기 게시물이 없습니다.</strong>
          <p>신고가 접수되면 개인정보/차량번호/민감정보를 우선 확인합니다.</p>
        </section>
      )}
    </div>
  );
}

function reasonLabel(reason: string) {
  const labels: Record<string, string> = {
    privacy_face: "얼굴",
    privacy_plate: "차량번호",
    sensitive_info: "민감정보",
    false_content: "허위",
    spam: "광고/스팸",
    other: "기타",
  };

  return labels[reason] ?? reason;
}

function actionLabel(action: "keep" | "hide" | "delete" | "restrict_author") {
  if (action === "keep") return "유지 처리";
  if (action === "hide") return "임시 숨김 처리";
  if (action === "delete") return "삭제 처리";
  return "작성자 제한 검토";
}
