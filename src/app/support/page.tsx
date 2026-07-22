import type { Metadata } from "next";
import Link from "next/link";
import styles from "../policy-page.module.css";

export const metadata: Metadata = {
  title: "지원 | #실시간",
  description: "#실시간 내부 베타 지원, UGC 신고, 개인정보 권리 행사와 이의제기 안내입니다.",
};

export default function SupportPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <nav className={styles.policyNav} aria-label="정책 문서">
          <Link className={styles.topLink} href="/">#실시간으로 돌아가기</Link>
          <Link href="/privacy">개인정보 처리방침</Link>
          <Link href="/terms">이용약관</Link>
        </nav>

        <section className={styles.hero}>
          <p className={styles.eyebrow}>Support · Internal Beta</p>
          <h1>지원 및 신고 안내</h1>
          <p className={styles.lead}>
            #실시간은 Cloudflare staging 기반 내부 베타를 준비 중입니다. 설치·실행 문제, 지도와 위치 권한, UGC 신고, 개인정보 권리 행사,
            삭제 요청과 운영 조치 이의제기를 분리해 처리합니다.
          </p>
          <p className={styles.updated}>문서 버전: support-beta-2026-07-22-v1 · 내부 베타 적용일: 2026-07-22</p>
          <p className={styles.blockedNotice} role="status">
            현재 접수 채널은 앱 내 신고와 TestFlight 피드백뿐입니다. 검증된 운영자 이름, 지원 이메일·전화번호, 개인정보 담당자와 응답 SLA가
            확정되지 않았으므로 외부 TestFlight와 production 지원 채널로 사용할 수 없습니다.
          </p>
        </section>

        <section className={styles.grid} aria-label="지원 항목">
          <article className={styles.section}>
            <h2>설치 및 실행 문제</h2>
            <ul>
              <li>TestFlight 설치 실패, 첫 화면 진입 실패, iPhone/Android crash는 기기 모델, OS 버전, 빌드 번호와 함께 남겨 주세요.</li>
              <li>지도 표시 문제는 현재 위치 권한 상태, 지역 선택 상태, 개인정보를 가린 화면 캡처를 함께 확인합니다.</li>
              <li>Android internal/debug build는 뒤로가기, 권한 거부 상태, 사진 선택 흐름을 별도로 확인합니다.</li>
              <li>token, 정확한 좌표, 익명 사용자 ID, 원본 사진 파일명은 피드백에 첨부하지 마세요.</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>콘텐츠 신고</h2>
            <ul>
              <li>앱 안의 장소, 댓글, 사진 신고 버튼을 먼저 사용해 주세요.</li>
              <li>얼굴, 차량번호, 문서, 결제정보, 병원·관공서 민감정보는 privacy_face, privacy_plate, sensitive_info 우선 큐로 처리합니다.</li>
              <li>명백한 개인정보 또는 민감정보는 먼저 숨기고 운영자가 최종 판단합니다.</li>
              <li>저작권·초상권 침해 신고에는 대상 URL, 권리 관계, 요청 조치만 받고 불필요한 신분증 사본은 요구하지 않습니다.</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>개인정보 권리와 삭제 요청</h2>
            <ul>
              <li>열람, 정정, 삭제, 처리정지, 동의 철회와 계정·익명 활동 삭제를 요청할 수 있습니다.</li>
              <li>대상 장소, 대략적인 작성 시각, 요청 유형을 남기되 정확한 위치나 다른 사람의 개인정보는 보내지 마세요.</li>
              <li>본인 여부를 안전하게 확인한 뒤 공개 노출 중단, D1 상태 갱신, R2 파일 정리, KV/cache 무효화를 확인합니다.</li>
              <li>처리 결과, 거절 사유, 재검토 요청 방법을 접수한 검증 채널로 안내합니다.</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>운영 조치 이의제기</h2>
            <ul>
              <li>댓글·사진 숨김, 삭제 또는 이용 제한이 잘못됐다고 판단하면 대상과 조치 시각, 이의 사유를 제출할 수 있습니다.</li>
              <li>최초 판단자와 다른 권한자의 재검토, restore 또는 기존 조치 유지, 판단 근거 기록을 원칙으로 합니다.</li>
              <li>개인정보 보호를 위해 다른 신고자의 신원·신고 원문·운영자 비밀정보는 제공하지 않습니다.</li>
              <li>이의제기 접수와 처리 SLA는 실제 trust-safety 담당자가 지정되기 전까지 확정되지 않았습니다.</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>미성년자와 긴급 요청</h2>
            <ul>
              <li>만 14세 미만 이용자의 개인정보 또는 사진이 발견되면 우선 숨김 신고를 사용해 주세요.</li>
              <li>보호자 요청 절차와 법정대리인 확인 방식은 named legal reviewer 승인 전까지 외부 서비스에 적용하지 않습니다.</li>
              <li>생명·신체의 즉각적 위험은 이 베타 지원 채널이 아닌 112 또는 119 등 적절한 긴급기관에 연락해야 합니다.</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>정책과 베타 피드백</h2>
            <ul>
              <li>데이터 처리 기준은 <Link href="/privacy">개인정보 처리방침</Link>을 확인해 주세요.</li>
              <li>사용자 콘텐츠와 서비스 이용 규칙은 <Link href="/terms">이용약관</Link>을 확인해 주세요.</li>
              <li>TestFlight 사용자는 피드백 제출 기능으로 개인정보를 가린 스크린샷과 설명을 남길 수 있습니다.</li>
              <li>최종 support URL, privacy policy URL, terms URL과 운영 연락 채널은 외부 공개 전에 별도로 검증합니다.</li>
            </ul>
          </article>
        </section>

        <section className={styles.contactCard} aria-labelledby="support-stop-conditions">
          <h2 id="support-stop-conditions">확장 중단 조건</h2>
          <p>
            실제 운영자·담당자·검증된 연락 채널·응답 SLA가 비어 있거나, R2 사진 삭제를 증명할 수 없거나, 실기기 crash가 반복되거나,
            개인정보 신고를 숨김 처리·재검토할 수 없으면 외부 TestFlight와 production 확장을 중단합니다.
          </p>
        </section>

        <p className={styles.notice}>
          이 페이지는 앱 내 신고와 TestFlight 피드백을 기준으로 한 내부 베타 지원 표면입니다. 실제 외부 테스트를 시작하기 전 운영자 법적 정보,
          공개 HTTPS support URL, 개인정보 담당 채널, trust-safety 담당자와 처리 SLA를 release gate에서 확인해야 합니다.
        </p>
      </div>
    </main>
  );
}
