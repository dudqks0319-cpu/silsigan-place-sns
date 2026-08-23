import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { findSharedPlace, sharedPlaceCategoryLabel, sharedPlaceRegionLabel } from "@/lib/shared-place";
import { getSiteUrl } from "@/lib/site-url";
import styles from "./page.module.css";

type SharePlacePageProps = {
  params: Promise<{
    placeId: string;
  }>;
};

export async function generateMetadata({ params }: SharePlacePageProps): Promise<Metadata> {
  const { placeId } = await params;
  const place = await findSharedPlaceForRequest(placeId);

  if (!place) {
    return {};
  }

  const siteUrl = getSiteUrl();
  const shareUrl = `${siteUrl}/share/place/${encodeURIComponent(place.id)}`;
  const imageUrl = `${shareUrl}/opengraph-image`;
  const title = `${place.name} 현재 정보`;
  const description = `${sharedPlaceRegionLabel(place.regionId)} · ${sharedPlaceCategoryLabel(place.categoryId)} · 혼잡·대기·주차·날씨는 앱에서 출처와 관측 시각을 확인하세요.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: shareUrl,
      images: [{ url: imageUrl, width: 1200, height: 630, alt: `${place.name} 공유 이미지` }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default async function SharePlacePage({ params }: SharePlacePageProps) {
  const { placeId } = await params;
  const place = await findSharedPlaceForRequest(placeId);

  if (!place) {
    notFound();
  }

  const sharePath = `/share/place/${encodeURIComponent(place.id)}`;
  const appPath = `/?place=${encodeURIComponent(place.id)}&from=share`;
  const isLocalPreview = process.env.NODE_ENV !== "production" && !hasWorkerLookupConfigured();

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-label="#실시간 장소 공유 카드">
        <div className={styles.topRow}>
          <span>#실시간</span>
          <strong>장소 정보</strong>
        </div>

        {isLocalPreview && (
          <div className={styles.previewNotice} role="note">
            샘플 미리보기 · 실제 현재 상태와 판단에 사용하지 않습니다.
          </div>
        )}

        <div className={styles.hero}>
          <span>{sharedPlaceRegionLabel(place.regionId)} · {sharedPlaceCategoryLabel(place.categoryId)}</span>
          <h1>{place.name}</h1>
          <p>출발 전, 혼잡·대기·주차·날씨를 최신 근거와 함께 확인하세요.</p>
          <p className={styles.heroNotice}>현재 상태는 앱에서 출처와 관측 시각을 확인한 뒤 판단할 수 있습니다.</p>
        </div>

        <div className={styles.infoGrid} aria-label="장소 공유 정보">
          <div>
            <span>지역</span>
            <strong>{sharedPlaceRegionLabel(place.regionId)}</strong>
          </div>
          <div>
            <span>종류</span>
            <strong>{sharedPlaceCategoryLabel(place.categoryId)}</strong>
          </div>
        </div>

        <a className={styles.primaryAction} href={appPath}>
          앱에서 현재 상태 확인
        </a>

        <footer>
          <span>{sharePath}</span>
          <strong>출처·관측 시각은 앱에서 확인</strong>
        </footer>
      </section>
    </main>
  );
}

async function findSharedPlaceForRequest(placeId: string) {
  const requestHeaders = await headers();
  return findSharedPlace(placeId, { clientIp: requestHeaders.get("cf-connecting-ip") ?? undefined });
}

function hasWorkerLookupConfigured() {
  return Boolean(
    (process.env.SILSIGAN_WORKER_API_BASE_URL ?? process.env.SILSIGAN_STAGING_API_BASE_URL ?? process.env.NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL ?? "").trim(),
  );
}
