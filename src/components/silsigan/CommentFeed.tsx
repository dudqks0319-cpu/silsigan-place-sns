"use client";

import { Flag, Heart, MessageCircle, UserX } from "lucide-react";
import { useState } from "react";
import styles from "./SilsiganRedesign.module.css";
import { EmptyState } from "./EmptyState";

export type PlaceComment = {
  id: string;
  author: string;
  body: string;
  meta: string;
  verified: boolean;
  likeCount?: number;
  liked?: boolean;
  workerCommentId?: string;
  ownedByCurrentSession?: boolean;
};

export function CommentFeed({
  comments,
  onBlockComment,
  onLikeComment,
  onReportComment,
}: {
  comments: PlaceComment[];
  onBlockComment?: (comment: PlaceComment) => void;
  onLikeComment?: (comment: PlaceComment) => Promise<void>;
  onReportComment?: (comment: PlaceComment) => void;
}) {
  const [likingCommentId, setLikingCommentId] = useState<string | null>(null);

  if (comments.length === 0) {
    return (
      <EmptyState
        title="확인된 댓글을 모으는 중입니다"
        body="최근 제보가 들어오면 이곳에 현장 코멘트가 시간순으로 정리됩니다."
      />
    );
  }

  const likeComment = async (comment: PlaceComment) => {
    if (!comment.workerCommentId || !onLikeComment || likingCommentId) {
      return;
    }

    setLikingCommentId(comment.id);
    try {
      await onLikeComment(comment);
    } finally {
      setLikingCommentId(null);
    }
  };

  return (
    <div className={styles.commentFeed}>
      {comments.map((comment) => (
        <article key={comment.id} className={styles.commentItem}>
          <MessageCircle size={17} aria-hidden />
          <div>
            <strong>{comment.author}</strong>
            <p>{comment.body}</p>
            <span>{comment.meta}{comment.verified ? " · 현장 인증" : ""}</span>
          </div>
          {comment.workerCommentId && (onLikeComment || onReportComment || onBlockComment) && (
            <div className={styles.commentActions}>
              {onLikeComment && (
                <button
                  className={`${styles.commentActionButton} ${styles.commentLikeButton} ${comment.liked ? styles.commentLikeActive : ""}`}
                  type="button"
                  onClick={() => void likeComment(comment)}
                  aria-label={`${comment.author} 댓글 도움돼요`}
                  aria-pressed={Boolean(comment.liked)}
                  disabled={likingCommentId === comment.id}
                >
                  <Heart size={14} />
                  도움 {comment.likeCount ?? 0}
                </button>
              )}
              {onReportComment && (
                <button
                  className={`${styles.commentActionButton} ${styles.commentReportButton}`}
                  type="button"
                  onClick={() => onReportComment(comment)}
                  aria-label={`${comment.author} 댓글 신고`}
                >
                  <Flag size={14} />
                  신고
                </button>
              )}
              {onBlockComment && !comment.ownedByCurrentSession && (
                <button
                  className={[styles.commentActionButton, styles.commentReportButton].join(" ")}
                  type="button"
                  onClick={() => onBlockComment(comment)}
                  aria-label="작성자 차단"
                >
                  <UserX size={14} />
                  차단
                </button>
              )}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
