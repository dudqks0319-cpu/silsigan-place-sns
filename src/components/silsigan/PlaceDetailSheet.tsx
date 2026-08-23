"use client";

import { type CSSProperties, type FormEvent, useState } from "react";
import { Flag, Heart, Send, ShieldAlert, ShieldCheck, X } from "lucide-react";
import styles from "./SilsiganRedesign.module.css";
import { CommentFeed, type PlaceComment } from "./CommentFeed";
import { PhotoUploader, type PlacePhoto, type PreparedPhotoUpload } from "./PhotoUploader";

export type SheetPlace = {
  id: string;
  name: string;
  address: string;
  signal: string;
  summary: string;
  crowd: string;
  parking: string;
  line: string;
  weather: string;
  updated: string;
  score: number;
  tone: "calm" | "normal" | "busy" | "danger" | "unknown";
  isSample?: boolean;
};

export type PlaceRealtimeEvent = {
  type: "place.liked" | "comment.created" | "photo.ready" | "report.created" | "heartbeat";
  createdAt: string;
  payload: Record<string, unknown>;
};

export function PlaceDetailSheet({
  comments,
  liked,
  onBlockComment,
  onClose,
  onCommentLike,
  onLike,
  onCommentSubmit,
  onPhotoDelete,
  onPhotoClick,
  onPhotoUpload,
  photoUploadReady,
  onReportComment,
  onReport,
  onReportPhoto,
  onReportPlace,
  photos,
  place,
  realtimeEvents = [],
  realtimeMode,
  reportCount,
  safetyNotice,
}: {
  comments: PlaceComment[];
  liked: boolean;
  onBlockComment: (comment: PlaceComment) => void;
  onClose: () => void;
  onCommentLike: (comment: PlaceComment) => Promise<void>;
  onLike: () => void;
  onCommentSubmit: (body: string) => Promise<void>;
  onPhotoDelete: (photo: PlacePhoto) => Promise<void>;
  onPhotoClick: (photo: PlacePhoto) => Promise<void>;
  onPhotoUpload: (photo: PreparedPhotoUpload) => Promise<void>;
  photoUploadReady: boolean;
  onReportComment: (comment: PlaceComment) => void;
  onReport: () => void;
  onReportPhoto: (photo: PlacePhoto) => void;
  onReportPlace: () => void;
  photos: PlacePhoto[];
  place: SheetPlace;
  realtimeEvents?: PlaceRealtimeEvent[];
  realtimeMode: "connecting" | "live" | "polling";
  reportCount: number;
  safetyNotice?: string | null;
}) {
  const recentRealtimeEvents = realtimeEvents.slice(0, 3);
  const heroPhoto = photos[0] ?? null;
  const heroPhotoStyle = photoPreviewBackground(heroPhoto?.previewUrl);
  const [commentBody, setCommentBody] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const trimmedComment = commentBody.trim();

  const submitComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trimmedComment || commentSubmitting) {
      return;
    }

    setCommentSubmitting(true);
    try {
      await onCommentSubmit(trimmedComment);
      setCommentBody("");
    } finally {
      setCommentSubmitting(false);
    }
  };

  return (
    <aside className={styles.detailSheet} aria-label={`${place.name} 상세 정보`}>
      <div className={styles.sheetHandle} />
      <button
        className={styles.sheetPhotoHero}
        style={heroPhotoStyle}
        type="button"
        onClick={onReport}
        aria-label={`${place.name} 지금컷 올리기`}
      >
        <span>{photos.length > 0 ? `사진 ${photos.length}장 · 최근 ${place.updated}` : "첫 사진을 기다리는 중"}</span>
        <strong>{heroPhoto?.label ?? `${place.name} 지금컷 올리기`}</strong>
      </button>
      <div className={styles.detailHeader}>
        <div>
          <p className={styles.eyebrow}>{place.address}</p>
          <h2>{place.name}</h2>
        </div>
        <button className={styles.iconButton} type="button" onClick={onClose} aria-label="상세 닫기">
          <X size={18} />
        </button>
      </div>

      <div className={styles.detailStatusRow}>
        <span className={`${styles.statusChip} ${styles[place.tone]}`}>{place.signal}</span>
        <span>{place.isSample ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />} {place.isSample ? "체험용 샘플" : `신뢰도 ${place.score}%`}</span>
        <span>최근 {place.updated}</span>
      </div>
      <p className={styles.detailSummary}>{place.summary}</p>

      <div className={styles.statusGrid}>
        <div className={styles.statBox}><strong>{place.crowd}</strong><span>사람</span></div>
        <div className={styles.statBox}><strong>{place.parking}</strong><span>주차</span></div>
        <div className={styles.statBox}><strong>{place.line}</strong><span>줄</span></div>
        <div className={styles.statBox}><strong>{place.weather}</strong><span>날씨</span></div>
      </div>

      <div className={styles.sheetActions}>
        <button className={liked ? styles.sheetActionActive : ""} type="button" onClick={onLike} aria-label="좋아요">
          <Heart size={17} /> 좋아요
        </button>
        <button type="button" onClick={onReport} aria-label="지금컷 올리기">
          지금컷 올리기
        </button>
        <button type="button" onClick={onReportPlace} aria-label="장소 신고">
          <Flag size={17} /> 신고
        </button>
      </div>

      <section className={styles.realtimeStrip} aria-label="실시간 반영 상태">
        <div className={styles.realtimeHeader}>
          <strong>실시간 반영</strong>
          <span>{realtimeModeLabel(realtimeMode)}</span>
        </div>
        {recentRealtimeEvents.length > 0 ? (
          <ul>
            {recentRealtimeEvents.map((event) => (
              <li key={`${event.type}:${event.createdAt}`}>
                <span>{realtimeEventLabel(event)}</span>
                <time dateTime={event.createdAt}>{event.createdAt.slice(11, 16)}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p>최근 반영 이벤트가 없습니다.</p>
        )}
      </section>

      <section className={styles.detailSection}>
        <div className={styles.panelTitleRow}>
          <h3>최근 제보</h3>
          <span>{reportCount}건</span>
        </div>
        <form className={styles.commentComposer} onSubmit={submitComment}>
          <label htmlFor={`comment-${place.id}`}>댓글 남기기</label>
          <div>
            <textarea
              id={`comment-${place.id}`}
              maxLength={300}
              onChange={(event) => setCommentBody(event.target.value)}
              placeholder="지금 보이는 현장 상황을 짧게 남겨주세요."
              rows={2}
              value={commentBody}
              aria-label={`${place.name} 댓글 작성`}
            />
            <button type="submit" disabled={!trimmedComment || commentSubmitting}>
              <Send size={15} />
              {commentSubmitting ? "등록 중" : "등록"}
            </button>
          </div>
          <span>{trimmedComment.length}/300</span>
        </form>
        <CommentFeed
          comments={comments}
          onBlockComment={onBlockComment}
          onLikeComment={onCommentLike}
          onReportComment={onReportComment}
        />
      </section>

      <section className={styles.detailSection}>
        <div className={styles.panelTitleRow}>
          <h3>사진</h3>
          <span>{photos.length}장</span>
        </div>
        <PhotoUploader
          photos={photos}
          onDeletePhoto={onPhotoDelete}
          onPhotoClick={onPhotoClick}
          onReportPhoto={onReportPhoto}
          onUpload={onPhotoUpload}
          uploadEnabled={photoUploadReady}
          safetyNotice={safetyNotice}
        />
      </section>
    </aside>
  );
}

function realtimeModeLabel(mode: "connecting" | "live" | "polling") {
  if (mode === "connecting") {
    return "연결 중";
  }

  if (mode === "live") {
    return "실시간 연결";
  }

  return "자동 갱신";
}

function photoPreviewBackground(previewUrl: string | undefined): CSSProperties | undefined {
  if (!previewUrl) {
    return undefined;
  }

  if (previewUrl.startsWith("/")) {
    return { backgroundImage: `url(${JSON.stringify(previewUrl)})` };
  }

  try {
    const url = new URL(previewUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return undefined;
    }

    return { backgroundImage: `url(${JSON.stringify(url.href)})` };
  } catch {
    return undefined;
  }
}

function realtimeEventLabel(event: PlaceRealtimeEvent) {
  if (event.type === "place.liked") {
    return "좋아요 반영";
  }

  if (event.type === "comment.created") {
    return "댓글 업데이트";
  }

  if (event.type === "photo.ready") {
    return "사진 등록";
  }

  if (event.type === "report.created") {
    return "신고 접수";
  }

  return "상태 확인";
}
