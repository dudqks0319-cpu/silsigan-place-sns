import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isPostExpired } from "@/lib/domain";
import { findSharedPost, formatSharedPostObservedAt } from "@/lib/shared-post";
import { getSiteUrl } from "@/lib/site-url";
import styles from "./page.module.css";

type SharePostPageProps = {
  params: Promise<{
    postId: string;
  }>;
};

export async function generateMetadata({ params }: SharePostPageProps): Promise<Metadata> {
  const { postId } = await params;
  const post = await findSharedPost(postId);

  if (!post || post.hiddenAt) {
    return {};
  }

  const siteUrl = getSiteUrl();
  const shareUrl = `${siteUrl}/share/post/${post.id}`;
  const imageUrl = `${shareUrl}/opengraph-image`;
  const description = `${isPostExpired(post.expiresAt) ? "지난 제보 · " : ""}${post.shareCard.body}`.replace(/\s+/g, " ").slice(0, 150);

  return {
    title: post.shareCard.headline,
    description,
    openGraph: {
      title: post.shareCard.headline,
      description,
      url: shareUrl,
      images: [{ url: imageUrl, width: 1200, height: 630, alt: post.shareCard.headline }],
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: post.shareCard.headline,
      description,
      images: [imageUrl],
    },
  };
}

export default async function SharePostPage({ params }: SharePostPageProps) {
  const { postId } = await params;
  const post = await findSharedPost(postId);

  if (!post || post.hiddenAt) {
    notFound();
  }

  const shareUrl = `${getSiteUrl()}/share/post/${post.id}`;
  const isExpired = isPostExpired(post.expiresAt);
  const provenanceLabel = post.locationVerified ? "현장 인증" : "상태 제보";
  const shareDescription = `${isExpired ? "지난 제보 · " : ""}${post.shareCard.body}`;

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-label="#실시간 공유 카드">
        <div className={styles.topRow}>
          <span>#실시간</span>
          <strong>{isExpired ? `지난 제보 · ${provenanceLabel}` : provenanceLabel}</strong>
        </div>
        <div className={`${styles.hero} ${styles[post.shareCard.variant]}`}>
          <span>{post.photoLabel}</span>
          <h1>{post.shareCard.headline}</h1>
          <p>{shareDescription}</p>
          {isExpired && <p className={styles.staleNotice}>이 제보는 만료되어 현재 방문 판단에 사용되지 않습니다.</p>}
        </div>
        <div className={styles.statusGrid}>
          <span>사람 {post.crowdLevel === "packed" ? "매우 많음" : post.crowdLevel === "busy" ? "많음" : post.crowdLevel === "quiet" ? "한산" : "보통"}</span>
          <span>주차 {post.parkingStatus === "full" ? "만차" : post.parkingStatus === "limited" ? "거의 없음" : post.parkingStatus === "available" ? "여유" : "확인 필요"}</span>
          <span>줄 {post.lineStatus === "long" ? "김" : post.lineStatus === "medium" ? "보통" : "없음"}</span>
          <time dateTime={post.createdAt}>제보 {formatSharedPostObservedAt(post.createdAt)}</time>
        </div>
        <div className={styles.hashtags}>
          {post.shareCard.hashtags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
        <footer>
          <span>{shareUrl}</span>
          <strong>지금 여기 어떤지 확인하기</strong>
        </footer>
      </section>
    </main>
  );
}
