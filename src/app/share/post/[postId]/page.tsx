import { notFound } from "next/navigation";
import { store } from "@/lib/store";
import styles from "./page.module.css";

type SharePostPageProps = {
  params: Promise<{
    postId: string;
  }>;
};

export default async function SharePostPage({ params }: SharePostPageProps) {
  const { postId } = await params;
  const post = store.listPosts({ includeHidden: true }).find((candidate) => candidate.id === postId);

  if (!post || post.hiddenAt) {
    notFound();
  }

  const shareUrl = `https://silsigan.vercel.app/share/post/${post.id}`;

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-label="#실시간 공유 카드">
        <div className={styles.topRow}>
          <span>#실시간</span>
          <strong>{post.locationVerified ? "현장 인증" : "상태 제보"}</strong>
        </div>
        <div className={styles.hero}>
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
          <strong>지금 여기 어떤지 확인하기</strong>
        </footer>
      </section>
    </main>
  );
}
