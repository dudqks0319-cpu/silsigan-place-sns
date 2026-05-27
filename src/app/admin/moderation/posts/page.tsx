import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { adminCookieName, isAdminTokenValid } from "@/lib/admin-auth";
import { store } from "@/lib/store";
import { ModerationQueueClient } from "./ModerationQueueClient";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function PostModerationPage() {
  if (process.env.NODE_ENV === "production" && !process.env.SILSIGAN_ADMIN_TOKEN) {
    notFound();
  }

  const adminToken = (await cookies()).get(adminCookieName)?.value;
  if (!isAdminTokenValid(adminToken)) {
    redirect("/admin/login" as never);
  }

  const queue = await store.listPostModerationQueue();
  const hiddenCount = queue.filter((item) => item.hidden).length;
  const sensitiveCount = queue.filter((item) =>
    item.flagReasons.some((reason) => ["privacy_face", "privacy_plate", "sensitive_info"].includes(reason)),
  ).length;

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p>#실시간 운영 큐</p>
        <h1>게시물 신고 검토</h1>
        <span>데모 저장소 기준입니다. 실서비스에서는 관리자 인증, 처리 로그, RLS가 필요합니다.</span>
      </section>

      <section className={styles.metrics} aria-label="신고 큐 요약">
        <div>
          <strong>{queue.length}</strong>
          <span>검토 대기</span>
        </div>
        <div>
          <strong>{hiddenCount}</strong>
          <span>임시 숨김</span>
        </div>
        <div>
          <strong>{sensitiveCount}</strong>
          <span>민감 우선</span>
        </div>
      </section>

      <nav className={styles.tabs} aria-label="신고 사유 필터 예시">
        {["전체", "개인정보", "차량번호", "민감정보", "허위", "스팸", "임시 숨김"].map((tab) => (
          <button key={tab} type="button">{tab}</button>
        ))}
      </nav>

      <ModerationQueueClient initialItems={queue} />
    </main>
  );
}
