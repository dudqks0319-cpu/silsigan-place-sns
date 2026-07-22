import type { Metadata } from "next";
import Link from "next/link";
import styles from "../policy-page.module.css";

export const metadata: Metadata = {
  title: "개인정보 처리방침 | #실시간",
  description: "#실시간의 위치정보, 사진, 사용자 콘텐츠와 Cloudflare 처리 기준 및 권리 행사 안내입니다.",
};

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <nav className={styles.policyNav} aria-label="정책 문서">
          <Link className={styles.topLink} href="/">#실시간으로 돌아가기</Link>
          <Link href="/terms">이용약관</Link>
          <Link href="/support">지원·신고</Link>
        </nav>

        <section className={styles.hero}>
          <p className={styles.eyebrow}>Privacy Policy · Internal Beta</p>
          <h1>개인정보 처리방침</h1>
          <p className={styles.lead}>
            #실시간은 장소 주변 상황을 짧게 확인하기 위한 베타 서비스입니다. 정확한 사용자 좌표, 원본 사진 파일명, EXIF/GPS, 원본 IP처럼
            개인을 직접 식별하거나 추적할 수 있는 정보는 공개하지 않고, 운영에 필요한 최소 정보만 처리합니다.
          </p>
          <p className={styles.updated}>문서 버전: privacy-beta-2026-07-22-v1 · 내부 베타 적용일: 2026-07-22</p>
          <p className={styles.blockedNotice} role="status">
            외부 공개 전 필수 확인: 운영자의 법적 명칭·주소·대표 연락처, 개인정보 보호책임자, 국내대리인 해당 여부가 아직 확정되지 않았습니다.
            해당 정보와 법무 검토일이 기록되기 전에는 외부 TestFlight와 production 출시를 진행하지 않습니다.
          </p>
        </section>

        <section className={styles.grid} aria-label="개인정보 처리 항목">
          <article className={styles.section}>
            <h2>처리 주체와 문의 채널</h2>
            <ul>
              <li>서비스 운영자: 법적 명칭·사업장 주소·대표 연락처 확정 필요</li>
              <li>개인정보 보호책임자 및 담당 부서: 이름·직책·검증된 이메일/전화번호 확정 필요</li>
              <li>확정 전에는 앱 내 신고와 TestFlight 피드백만 사용하며, 임의의 이름·이메일·전화번호를 고지하지 않습니다.</li>
              <li>권리 요청을 수신하고 본인 여부를 안전하게 확인할 운영 채널이 확정되지 않으면 외부 테스트를 시작하지 않습니다.</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>처리 목적과 항목</h2>
            <ul>
              <li>장소별 댓글, 사진, 좋아요, 신고, 랭킹 제공에 안정적인 익명 사용자 ID를 사용합니다.</li>
              <li>위치 권한은 주변 장소 표시와 현장 인증 여부 판단에만 사용합니다.</li>
              <li>품질과 오남용 방지를 위해 요청 ID, 응답 코드, redacted error code, latency 같은 최소 진단 정보를 처리할 수 있습니다.</li>
              <li>광고와 마케팅 기능은 현재 비활성화되어 있으며 광고 식별자를 수집하지 않습니다.</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>위치정보</h2>
            <ul>
              <li>사용자의 raw coordinate는 주변 조회와 거리 검증 중에만 사용하고 공개 응답, Cloudflare D1, R2, KV, Workers logs에 저장하지 않습니다.</li>
              <li>현장 인증 결과는 장소 ID, 거리 구간, 인증 시각, 만료 시각처럼 coarse data만 남깁니다.</li>
              <li>위치 권한을 거부해도 지역 선택과 읽기 기능은 사용할 수 있습니다.</li>
              <li>위치정보법상 개인위치정보사업 또는 위치기반서비스 해당 여부와 별도 이용약관·신고 의무는 named legal reviewer가 확정해야 합니다.</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>사진 및 R2 저장</h2>
            <ul>
              <li>사진은 JPEG 또는 WebP로 제한하고, 업로드 전후로 EXIF/GPS와 원본 파일명을 제거합니다.</li>
              <li>원본 업로드 파일은 보관하지 않으며 Cloudflare R2에는 랜덤 object key와 재인코딩된 안전 이미지 variant만 저장합니다.</li>
              <li>얼굴, 차량번호, 문서, 결제정보, 병원·관공서 민감정보가 보이는 사진은 제한됩니다.</li>
              <li>촬영·게시 권한 확인은 권리 보유를 자동 증명하지 않으며, 도용·초상권 신고 시 숨김과 검토 절차를 적용합니다.</li>
            </ul>
          </article>

          <article className={`${styles.section} ${styles.wideSection}`}>
            <h2>보유 기간과 삭제 기준</h2>
            <div className={styles.tableWrap}>
              <table>
                <caption>개인정보 유형별 현재 동작과 출시 전 확정 항목</caption>
                <thead>
                  <tr><th scope="col">구분</th><th scope="col">현재 동작</th><th scope="col">출시 전 확정할 법적 보유 기간</th></tr>
                </thead>
                <tbody>
                  <tr><td>현장 제보</td><td>기본 3시간 후 공개 목록 제외</td><td>비공개 전환 뒤 물리 삭제 시점 확정 필요</td></tr>
                  <tr><td>사진 파생본</td><td>삭제 승인 시 공개 중단 및 R2 object 정리</td><td>백업·cache 포함 완전 삭제 SLA 확정 필요</td></tr>
                  <tr><td>댓글·신고</td><td>작성자 삭제 또는 운영 조치 시 비공개·삭제</td><td>분쟁·법적 의무별 최대 보유 기간 확정 필요</td></tr>
                  <tr><td>감사·오남용 기록</td><td>조사에 필요한 최소 정보만 제한 보관</td><td>항목별 기간과 파기 주기 확정 필요</td></tr>
                  <tr><td>익명 식별자</td><td>기기 세션과 기능·오남용 방지에 사용</td><td>마지막 활동 기준 만료와 탈퇴 처리 확정 필요</td></tr>
                </tbody>
              </table>
            </div>
            <p className={styles.sectionNote}>
              위 미확정 기간을 법률상 필요한 최소 기간으로 확정하고 실제 D1/R2/KV/Workers 설정과 대조하기 전에는 승인본으로 전환하지 않습니다.
            </p>
          </article>

          <article className={styles.section}>
            <h2>처리업체와 국외 이전 검토</h2>
            <ul>
              <li>Cloudflare Workers, D1, R2, KV는 서비스 제공과 보안·운영을 위한 처리업체 후보입니다.</li>
              <li>법인명, 계약 주체, 처리 국가·지역, 이전 일시·방법, 보유 기간, 거부 방법은 실제 계약과 데이터 배치를 기준으로 확인해야 합니다.</li>
              <li>Cloudflare 처리가 개인정보 보호법상 위탁 또는 국외 이전에 해당하는지 named legal reviewer의 분류가 아직 완료되지 않았습니다.</li>
              <li>필요한 고지·동의·계약 또는 보호조치가 확인되지 않으면 외부 사용자 데이터를 처리하지 않습니다.</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>권리 행사와 삭제 요청</h2>
            <ul>
              <li>이용자는 개인정보 열람, 정정, 삭제, 처리정지, 동의 철회와 계정·익명 활동 삭제를 요청할 수 있습니다.</li>
              <li>요청에는 대상 장소, 대략적인 작성 시각 등 최소 정보만 받고, 추가 개인정보를 과도하게 요구하지 않습니다.</li>
              <li>본인 확인 뒤 공개 노출 중단, D1 상태 갱신, R2 파일 정리, KV/cache 무효화를 확인합니다.</li>
              <li>처리 결과 또는 거절 사유와 이의제기 방법을 검증된 지원 채널로 안내합니다.</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>UGC 신고, 이의제기와 아동</h2>
            <ul>
              <li>개인정보·민감정보 신고는 먼저 숨기고 운영자가 최종 판단하며, 작성자는 오조치에 이의를 제기할 수 있습니다.</li>
              <li>신고 접수, hide, restore, delete, restrict 조치와 판단 근거는 최소 감사 기록으로 남깁니다.</li>
              <li>만 14세 미만 아동 대상 서비스가 아니며, 연령 확인·법정대리인 동의 절차가 확정되기 전에는 이들의 개인정보를 의도적으로 수집하지 않습니다.</li>
              <li>아동의 정보가 접수된 사실을 알게 되면 우선 숨기고 검증된 보호자 요청 절차에 따라 삭제합니다.</li>
            </ul>
          </article>

          <article className={styles.section}>
            <h2>방침 변경과 관련 문서</h2>
            <ul>
              <li>중요한 처리 목적·항목·보유 기간·처리업체 변경은 시행 전에 이 페이지에서 버전과 적용일을 고지합니다.</li>
              <li><Link href="/terms">이용약관</Link>에서 서비스 이용과 UGC 규칙을 확인할 수 있습니다.</li>
              <li><Link href="/support">지원 및 신고 안내</Link>에서 신고, 삭제 요청, 이의제기 절차를 확인할 수 있습니다.</li>
              <li>최종 privacy policy URL, terms URL, support URL은 서로 구분된 공개 HTTPS 주소로 검증합니다.</li>
            </ul>
          </article>
        </section>

        <p className={styles.notice}>
          이 문서는 내부 베타의 데이터 최소화 원칙을 설명하는 공개 정책 표면이며 법률 자문이나 외부 출시 승인을 대신하지 않습니다. 운영자 정보,
          보유 기간, Cloudflare 위탁·국외 이전 분류, 위치정보법 적용 여부, 미성년자 정책을 named reviewer가 승인하기 전에는 production에 사용하지 않습니다.
        </p>
      </div>
    </main>
  );
}
