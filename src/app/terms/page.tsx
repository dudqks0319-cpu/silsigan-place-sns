import type { Metadata } from "next";
import Link from "next/link";
import styles from "../policy-page.module.css";

export const metadata: Metadata = {
  title: "이용약관 | #실시간",
  description: "#실시간 내부 베타의 이용 조건, 사용자 콘텐츠, 신고·이의제기와 안전 규칙입니다.",
};

export default function TermsPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <nav className={styles.policyNav} aria-label="정책 문서">
          <Link className={styles.topLink} href="/">#실시간으로 돌아가기</Link>
          <Link href="/privacy">개인정보 처리방침</Link>
          <Link href="/support">지원·신고</Link>
        </nav>

        <section className={styles.hero}>
          <p className={styles.eyebrow}>Terms of Use · Internal Beta</p>
          <h1>이용약관</h1>
          <p className={styles.lead}>
            이 약관은 #실시간 내부 베타에서 장소 정보, 현장 제보, 사진, 댓글, 좋아요, 신고 기능을 사용할 때 적용되는 기본 규칙입니다.
            실시간 정보는 이용자의 현장 판단을 돕는 참고 자료이며 안전·의료·교통·공공기관의 공식 판단을 대신하지 않습니다.
          </p>
          <p className={styles.updated}>약관 버전: terms-beta-2026-07-22-v1 · 내부 베타 적용일: 2026-07-22</p>
          <p className={styles.blockedNotice} role="status">
            서비스 제공자의 법적 명칭·주소·대표 연락처와 관할·분쟁 처리 기준이 확정되지 않았습니다. named legal reviewer의 승인과 실제 운영 정보가
            기록되기 전에는 외부 이용자에게 동의를 받거나 production 약관으로 사용하지 않습니다.
          </p>
        </section>

        <section className={styles.grid} aria-label="이용약관 항목">
          <article className={styles.section}>
            <h2>서비스와 베타 범위</h2>
            <ul>
              <li>#실시간은 주변 장소의 혼잡도·분위기·현장 상황을 제보와 공공 데이터로 보여 주는 베타 서비스입니다.</li>
              <li>기능, 제공 지역, 데이터 source와 운영 시간은 시험 과정에서 변경·중단될 수 있습니다.</li>
              <li>로그인 없이 익명 세션으로 사용할 수 있으며 기기 변경·삭제 시 활동 복구가 제한될 수 있습니다.</li>
              <li>유료 기능, 광고, 보상 환전과 production 서비스는 현재 제공하지 않습니다.</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>현장 정보의 한계</h2>
            <ul>
              <li>제보와 파생 판단에는 관측 시각, 표본 부족, 위치 오차와 사용자 입력 오류가 있을 수 있습니다.</li>
              <li>교통 통제, 재난, 응급, 치안, 의료, 시설 운영 여부는 반드시 관계 기관과 현장을 별도로 확인해야 합니다.</li>
              <li>표본이 부족할 때는 충분한 정보 없음으로 표시하며, 참고 이미지나 오래된 정보를 현재 현장 사진처럼 표시하지 않습니다.</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>사용자 콘텐츠와 권리</h2>
            <ul>
              <li>이용자는 직접 촬영·작성했거나 게시 권한을 가진 사진과 글만 제출해야 합니다.</li>
              <li>업로드를 위해 확인한 촬영·게시 권리 문구는 실제 저작권·초상권 보유를 자동 증명하지 않습니다.</li>
              <li>이용자는 서비스 제공·표시·크기 조정·안전 검수에 필요한 범위의 비독점적 이용을 허락하며, 소유권은 이용자에게 남습니다.</li>
              <li>삭제 요청 또는 권리 침해 확인 뒤에는 공개 이용을 중단하되, 법적 의무와 분쟁 대응에 필요한 최소 기록은 별도 기준에 따라 처리할 수 있습니다.</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>금지되는 콘텐츠와 행위</h2>
            <ul>
              <li>타인의 얼굴·차량번호·문서·결제정보·정확한 주소 등 개인정보 또는 민감정보를 노출하는 행위</li>
              <li>허위 제보, 명예훼손, 혐오·위협, 불법 촬영물, 성적 착취물, 스팸, 악성 script·URL을 게시하는 행위</li>
              <li>권한 없는 저작물·CCTV·stream을 복제·중계하거나 자동화로 신고·좋아요·랭킹을 조작하는 행위</li>
              <li>rate limit, Turnstile, 위치 인증, 비용 안전장치, 접근 권한을 우회하거나 서비스에 과도한 부하를 주는 행위</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>신고, 운영 조치와 이의제기</h2>
            <ul>
              <li>이용자는 앱 내 신고로 개인정보, 권리 침해, 허위, 스팸과 안전 문제를 알릴 수 있습니다.</li>
              <li>운영자는 위험도에 따라 콘텐츠를 먼저 숨기고 검토한 뒤 hide, restore, delete, restrict 조치를 할 수 있습니다.</li>
              <li>작성자는 <Link href="/support">지원 및 신고 안내</Link>에 따라 조치 사유 확인과 재검토를 요청할 수 있습니다.</li>
              <li>실제 trust-safety 담당자, 응답 SLA와 법적 이의제기 채널이 확정되지 않으면 외부 UGC를 활성화하지 않습니다.</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>위치 권한과 개인정보</h2>
            <ul>
              <li>위치 권한은 주변 장소 표시와 현장 인증에만 사용하며, 거부해도 지역 선택과 읽기 기능을 이용할 수 있습니다.</li>
              <li>개인정보 처리 항목, 보유·삭제, 처리업체, 권리 행사는 <Link href="/privacy">개인정보 처리방침</Link>을 따릅니다.</li>
              <li>위치정보법상 서비스 분류와 별도 약관·신고 의무가 확정되기 전에는 외부 위치 기반 기능을 출시하지 않습니다.</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>미성년자</h2>
            <ul>
              <li>이 서비스는 만 14세 미만 아동을 대상으로 하지 않습니다.</li>
              <li>연령 확인, 법정대리인 동의·확인·철회 절차가 확정되기 전에는 만 14세 미만 이용자의 개인정보를 의도적으로 수집하지 않습니다.</li>
              <li>아동의 개인정보나 사진을 발견하면 우선 숨기고 검증된 보호자 요청 절차에 따라 삭제합니다.</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>중단, 변경과 책임 경계</h2>
            <ul>
              <li>보안, 개인정보, 비용 폭증, 데이터 source 권리 철회, 장애가 발생하면 일부 또는 전체 기능을 중단할 수 있습니다.</li>
              <li>고의·중대한 과실 등 법률상 제한할 수 없는 책임을 배제하지 않으며, 구체적인 책임·준거법·분쟁 절차는 법무 검토 후 확정합니다.</li>
              <li>이용자에게 불리한 중요한 변경은 적용 전에 새 버전, 적용일과 변경 이유를 정책 페이지에 고지합니다.</li>
              <li>지원·삭제·신고·이의제기 절차는 <Link href="/support">지원 페이지</Link>에서 확인할 수 있습니다.</li>
            </ul>
          </article>
        </section>

        <p className={styles.notice}>
          이 약관은 내부 베타의 안전 규칙을 고정하기 위한 초안입니다. 서비스 제공자 정보, 위치정보법 적용 판단, 미성년자 절차, 책임·분쟁 조항,
          운영 연락 채널과 named legal reviewer 승인이 완료되기 전에는 외부 동의 또는 production 출시의 근거로 사용할 수 없습니다.
        </p>
      </div>
    </main>
  );
}
