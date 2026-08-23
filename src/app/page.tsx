import type { Metadata } from "next";
import SilsiganRedesign from "@/components/silsigan/SilsiganRedesign";
import { findSharedPlace, sharedPlaceCategoryLabel, sharedPlaceRegionLabel } from "@/lib/shared-place";
import { getSiteUrl } from "@/lib/site-url";

type HomePageProps = {
  searchParams?: Promise<{
    place?: string | string[];
  }>;
};

export async function generateMetadata({ searchParams }: HomePageProps): Promise<Metadata> {
  const params = searchParams ? await searchParams : {};
  const placeId = typeof params.place === "string" ? params.place : params.place?.[0];
  if (!placeId) {
    return {};
  }

  const place = await findSharedPlace(placeId);
  if (!place) {
    return {};
  }

  const siteUrl = getSiteUrl();
  const shareUrl = `${siteUrl}/?place=${encodeURIComponent(place.id)}&from=share`;
  const imageUrl = `${siteUrl}/share/place/${encodeURIComponent(place.id)}/opengraph-image`;
  const description = `${sharedPlaceRegionLabel(place.regionId)} · ${sharedPlaceCategoryLabel(place.categoryId)} · 혼잡·대기·주차·날씨를 최신 근거와 함께 확인하세요.`;
  const title = `${place.name} 현재 정보`;

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

export default function HomePage() {
  return <SilsiganRedesign />;
}
