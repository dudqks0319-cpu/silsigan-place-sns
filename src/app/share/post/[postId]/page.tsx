import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSiteUrl } from "@/lib/site-url";
import { isCommunityReadEnabled, isRecentPublicPost } from "@/lib/legacy-access";
import { store } from "@/lib/store";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type SharePostPageProps = {
  params: Promise<{
    postId: string;
  }>;
};

async function findSharedPost(postId: string) {
  if (!isCommunityReadEnabled()) return undefined;
  const now = new Date();
  return (await store.listPosts({ includeHidden: false })).find((candidate) => candidate.id === postId && isRecentPublicPost(candidate, now));
}

export async function generateMetadata({ params }: SharePostPageProps): Promise<Metadata> {
  const { postId } = await params;
  const post = await findSharedPost(postId);

  if (!post || post.hiddenAt) {
    return {};
  }

  const siteUrl = getSiteUrl();
  const shareUrl = `${siteUrl}/share/post/${post.id}`;
  const imageUrl = `${shareUrl}/opengraph-image`;

  return {
    title: post.shareCard.headline,
    description: post.shareCard.body.replace(/\s+/g, " ").slice(0, 150),
    openGraph: {
      title: post.shareCard.headline,
      description: post.shareCard.body.replace(/\s+/g, " ").slice(0, 150),
      url: shareUrl,
      images: [{ url: imageUrl, width: 1200, height: 630, alt: post.shareCard.headline }],
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

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-label="#실시간 공유 카드">
        <div className={styles.topRow}>
          <span>#실시간</span>
          <strong>사용자 제보 · 현장 상황 미확인</strong>
        </div>
        <div className={`${styles.hero} ${styles[post.shareCard.variant]}`}>
          <span>{post.photoLabel}</span>
          <h1>{post.shareCard.headline}</h1>
          <p>{post.shareCard.body}</p>
        </div>
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
          <time dateTime={post.createdAt}>제보 작성: {new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(post.createdAt))}</time>
        </footer>
      </section>
    </main>
  );
}
