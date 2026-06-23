"use client";

import { Flag, MessageCircle } from "lucide-react";
import styles from "./SilsiganRedesign.module.css";
import { EmptyState } from "./EmptyState";

export type PlaceComment = {
  id: string;
  author: string;
  body: string;
  meta: string;
  verified: boolean;
  workerCommentId?: string;
};

export function CommentFeed({
  comments,
  onReportComment,
}: {
  comments: PlaceComment[];
  onReportComment?: (comment: PlaceComment) => void;
}) {
  if (comments.length === 0) {
    return (
      <EmptyState
        title="확인된 댓글을 모으는 중입니다"
        body="최근 제보가 들어오면 이곳에 현장 코멘트가 시간순으로 정리됩니다."
      />
    );
  }

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
          {comment.workerCommentId && onReportComment && (
            <button type="button" onClick={() => onReportComment(comment)} aria-label={`${comment.author} 댓글 신고`}>
              <Flag size={14} />
              신고
            </button>
          )}
        </article>
      ))}
    </div>
  );
}
