import styles from "./page.module.css";

export default function AdminLoginPage() {
  return (
    <main className={styles.page}>
      <form className={styles.card} method="post" action="/api/admin/login">
        <p>#실시간 Admin</p>
        <h1>관리자 인증</h1>
        <label>
          관리자 토큰
          <input name="token" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit">운영 큐 열기</button>
        <span>프로덕션에서는 `SILSIGAN_ADMIN_TOKEN` 환경변수가 필요합니다.</span>
      </form>
    </main>
  );
}
