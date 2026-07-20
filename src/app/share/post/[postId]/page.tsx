import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { findSharedPost } from "@/lib/shared-post";
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
  const imageUrl = post.thumbnail?.url ?? `${shareUrl}/opengraph-image`;

  return {
    title: post.shareCard.headline,
    description: post.shareCard.body.replace(/\s+/g, " ").slice(0, 150),
    openGraph: {
      title: post.shareCard.headline,
      description: post.shareCard.body.replace(/\s+/g, " ").slice(0, 150),
      url: shareUrl,
      images: [{ url: imageUrl, alt: post.thumbnail?.alt ?? post.shareCard.headline }],
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: post.shareCard.headline,
      description: post.shareCard.body.replace(/\s+/g, " ").slice(0, 150),
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
  const placeUrl = `/place/${encodeURIComponent(post.placeId)}`;
  const currentStatusData = post.status?.dataMode === "live" ? post.status : null;
  const currentStatus = currentStatusData?.status ?? "insufficient";
  const currentStatusLabel =
    currentStatus === "likely_good"
      ? "방문 전 확인하면 무난할 가능성"
      : currentStatus === "check_before_visit"
        ? "방문 전 확인 필요"
        : currentStatus === "likely_crowded"
          ? "혼잡할 가능성"
          : "현재 정보 부족";
  const currentEvidence = currentStatusData
    ? `현재 근거 ${currentStatusData.currentSignals.length}개 · ${minutesAgoLabel(post.observedAt)} 관측`
    : "현재 장소 상태를 불러오지 못했습니다.";

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-label="#실시간 공유 카드">
        <div className={styles.topRow}>
          <span>#실시간</span>
          <strong>{post.locationVerified ? "현장 인증" : "상태 제보"}</strong>
        </div>
        <div className={`${styles.hero} ${styles[post.shareCard.variant]}`}>
          {post.thumbnail && (
            <Image
              className={styles.heroThumbnail}
              src={post.thumbnail.url}
              alt={post.thumbnail.alt}
              fill
              sizes="(max-width: 430px) 100vw, 390px"
              unoptimized
            />
          )}
          <span>{post.photoLabel}</span>
          <h1>{post.shareCard.headline}</h1>
          <p>{post.shareCard.body}</p>
        </div>
        <div className={styles.currentStatus} aria-label="현재 장소 종합 상태">
          <strong>현재 장소 상태</strong>
          <span>{currentStatusLabel}</span>
          <small>{currentEvidence}</small>
        </div>
        <div className={styles.reportLabel}>공유한 제보 내용</div>
        <div className={styles.statusGrid}>
          <span>사람 {post.crowdLevel === "packed" ? "매우 많음" : post.crowdLevel === "busy" ? "많음" : post.crowdLevel === "quiet" ? "한산" : "보통"}</span>
          <span>주차 {post.parkingStatus === "full" ? "만차" : post.parkingStatus === "limited" ? "거의 없음" : post.parkingStatus === "available" ? "여유" : "확인 필요"}</span>
          <span>줄 {post.lineStatus === "long" ? "김" : post.lineStatus === "medium" ? "보통" : "없음"}</span>
        </div>
        <div className={styles.hashtags}>
          {post.shareCard.hashtags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
        <footer>
          <span>{shareUrl}</span>
          <a className={styles.cta} href={placeUrl}>지금 여기 어떤지 확인하기</a>
        </footer>
      </section>
    </main>
  );
}

function minutesAgoLabel(createdAt: string): string {
  const diffMinutes = Math.max(1, Math.round((Date.now() - new Date(createdAt).getTime()) / 60_000));
  return diffMinutes >= 60 ? `${Math.round(diffMinutes / 60)}시간 전` : `${diffMinutes}분 전`;
}
