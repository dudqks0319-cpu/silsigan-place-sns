import type { Metadata } from "next";
import Link from "next/link";
import styles from "../policy-page.module.css";

export const metadata: Metadata = {
  title: "지원 | #실시간",
  description: "#실시간 TestFlight 베타 지원, 신고, 개인정보, 삭제 요청 안내입니다.",
};

export default function SupportPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.topLink} href="/">#실시간으로 돌아가기</Link>
        <section className={styles.hero}>
          <p className={styles.eyebrow}>Support</p>
          <h1>지원 및 신고 안내</h1>
          <p className={styles.lead}>
            #실시간은 Cloudflare staging 기반 TestFlight MVP를 준비 중입니다. 베타 기간에는 설치 문제, 지도/위치 권한 문제, 사진/댓글/좋아요
            오류, 개인정보 노출, 삭제 요청을 분리해 처리합니다.
          </p>
          <p className={styles.updated}>기준일: 2026-06-27</p>
        </section>

        <section className={styles.grid} aria-label="지원 항목">
          <article className={styles.section}>
            <h2>설치 및 실행 문제</h2>
            <ul>
              <li>TestFlight 설치 실패, 첫 화면 진입 실패, iPhone/Android crash는 기기 모델, OS 버전, 빌드 번호와 함께 남겨 주세요.</li>
              <li>지도 표시 문제는 현재 위치 권한 상태, 지역 선택 상태, 화면 캡처를 함께 확인합니다.</li>
              <li>Android internal/debug build는 뒤로가기, 권한 거부 상태, 사진 선택 흐름을 별도로 확인합니다.</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>콘텐츠 신고</h2>
            <ul>
              <li>앱 안의 장소, 댓글, 사진 신고 버튼을 먼저 사용해 주세요.</li>
              <li>얼굴, 차량번호, 문서, 결제정보, 병원/관공서 민감정보는 privacy_face, privacy_plate, sensitive_info 우선 큐로 처리합니다.</li>
              <li>명백한 개인정보 또는 민감정보는 먼저 숨기고 운영자가 최종 판단합니다.</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>개인정보 및 삭제 요청</h2>
            <ul>
              <li>정확한 위치, 원본 파일명, EXIF/GPS, 원본 IP는 공개하지 않는 것이 기본 정책입니다.</li>
              <li>댓글, 사진, 제보 삭제 요청은 대상 장소, 대략적인 작성 시각, 화면 캡처를 기준으로 확인합니다.</li>
              <li>삭제 처리 후에는 공개 노출 중단, D1 상태 갱신, R2 파일 정리, KV/cache 무효화를 확인합니다.</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>베타 피드백</h2>
            <ul>
              <li>TestFlight 사용자는 TestFlight 피드백 제출 기능으로 스크린샷과 설명을 남길 수 있습니다.</li>
              <li>사진 업로드 성공률, 위치 권한 거부 상태 사용성, 랭킹 이해도, 신고 접근성은 내부 테스트 핵심 확인 항목입니다.</li>
              <li>외부 TestFlight 전에는 공개 support URL, privacy policy URL, 운영 SLA, 실기기 QA 증거를 다시 확인합니다.</li>
            </ul>
          </article>
        </section>

        <section className={styles.contactCard} aria-labelledby="support-stop-conditions">
          <h2 id="support-stop-conditions">확장 중단 조건</h2>
          <p>
            R2 사진 삭제가 확인되지 않거나, 실기기 crash가 반복되거나, 개인정보 신고를 숨김 처리할 수 없거나, staging Worker/Pages URL이 서로 다른
            환경을 바라보는 경우 TestFlight 확장을 중단합니다.
          </p>
        </section>

        <p className={styles.notice}>
          이 지원 페이지는 앱 안 신고와 TestFlight 피드백을 기준으로 한 베타 지원 표면입니다. 실제 외부 테스트를 시작하기 전 최종 공개 HTTPS support URL과
          운영 연락 채널을 release gate에서 다시 확인합니다.
        </p>
      </div>
    </main>
  );
}
