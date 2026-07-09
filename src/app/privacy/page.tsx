import type { Metadata } from "next";
import Link from "next/link";
import styles from "../policy-page.module.css";

export const metadata: Metadata = {
  title: "개인정보 처리방침 | #실시간",
  description: "#실시간의 위치정보, 사진, 댓글, 신고, Cloudflare D1/R2 데이터 처리 기준입니다.",
};

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.topLink} href="/">#실시간으로 돌아가기</Link>
        <section className={styles.hero}>
          <p className={styles.eyebrow}>Privacy Policy</p>
          <h1>개인정보 처리방침</h1>
          <p className={styles.lead}>
            #실시간은 장소 주변 상황을 짧게 확인하기 위한 베타 서비스입니다. 정확한 사용자 좌표, 원본 사진 파일명, EXIF/GPS, 원본 IP처럼
            개인을 직접 식별하거나 추적할 수 있는 정보는 공개하지 않고, 운영에 필요한 최소 정보만 처리합니다.
          </p>
          <p className={styles.updated}>기준일: 2026-06-27</p>
        </section>

        <section className={styles.grid} aria-label="개인정보 처리 항목">
          <article className={styles.section}>
            <h2>수집 및 이용 목적</h2>
            <ul>
              <li>장소별 댓글, 사진, 좋아요, 신고, 랭킹을 제공하기 위해 익명 사용자 ID를 사용합니다.</li>
              <li>위치 권한은 현재 주변 장소 표시와 현장 인증 여부 판단에만 사용합니다.</li>
              <li>앱 품질과 abuse control을 위해 요청 ID, 응답 코드, redacted error code, latency 같은 최소 로그를 확인할 수 있습니다.</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>위치정보</h2>
            <ul>
              <li>사용자의 raw coordinate는 공개 응답, Cloudflare D1, R2, KV, Workers logs에 저장하지 않습니다.</li>
              <li>현장 인증 결과는 장소 ID, 거리 구간, 인증 시각, 만료 시각처럼 coarse data만 남깁니다.</li>
              <li>위치 권한을 거부해도 지역 선택과 읽기 기능은 사용할 수 있습니다.</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>사진 및 R2 저장</h2>
            <ul>
              <li>사진은 JPEG 또는 WebP로 제한하고, 업로드 전후로 EXIF/GPS와 원본 파일명을 제거합니다.</li>
              <li>Cloudflare R2에는 랜덤 object key와 재인코딩된 안전 이미지 variant만 저장합니다.</li>
              <li>얼굴, 차량번호, 문서, 결제정보, 병원/관공서 민감정보가 보이는 사진은 제한됩니다.</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>댓글, 신고, 운영 조치</h2>
            <ul>
              <li>전화번호, 주민등록번호, 주소, 차량번호, script, URL spam 등은 서버에서 차단하거나 검토 플래그를 붙입니다.</li>
              <li>개인정보 또는 민감정보 신고는 먼저 숨기고 나중에 판단하는 원칙으로 처리합니다.</li>
              <li>운영자는 hide, restore, delete, restrict 같은 최소 조치와 감사 기록을 남길 수 있습니다.</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>보관 및 삭제</h2>
            <ul>
              <li>현장 제보는 기본 3시간 후 공개 목록에서 제외됩니다.</li>
              <li>작성자 삭제 또는 운영자 삭제가 필요한 경우 공개 노출을 중단하고 D1/R2/KV 관련 데이터를 정리합니다.</li>
              <li>분쟁 또는 악용 조사에 필요한 최소 감사 정보만 제한 기간 보관합니다.</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>문의 및 권리 행사</h2>
            <ul>
              <li>버그, 안전하지 않은 콘텐츠, 개인정보, 삭제 요청은 지원 페이지에서 안내하는 채널로 접수합니다.</li>
              <li>TestFlight 베타에서는 TestFlight 피드백과 앱 내 신고 기능을 우선 지원합니다.</li>
              <li>외부 TestFlight 제출 전 최종 support URL과 privacy policy URL은 공개 HTTPS 주소로 고정합니다.</li>
            </ul>
          </article>
        </section>

        <p className={styles.notice}>
          이 페이지는 Cloudflare-backed TestFlight MVP의 공개 정책 표면입니다. App Store 정식 제출 전에는 실제 운영 채널, privacy label,
          위치정보 고지, 삭제/보관 세부 절차를 최종 URL과 함께 다시 검증합니다.
        </p>
      </div>
    </main>
  );
}
