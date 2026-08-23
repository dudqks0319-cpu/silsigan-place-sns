import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { isPostExpired } from "@/lib/domain";
import { findSharedPost, formatSharedPostObservedAt } from "@/lib/shared-post";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

type OpenGraphImageProps = {
  params: Promise<{
    postId: string;
  }>;
};

const variantGradients: Record<string, string> = {
  avoid: "linear-gradient(135deg, #ef4444, #f97316)",
  good: "linear-gradient(135deg, #16a34a, #22c55e)",
  parking_full: "linear-gradient(135deg, #ea580c, #dc2626)",
  waiting: "linear-gradient(135deg, #7c3aed, #f97316)",
  photo_spot: "linear-gradient(135deg, #0f766e, #38bdf8)",
};

export default async function OpenGraphImage({ params }: OpenGraphImageProps) {
  const { postId } = await params;
  const post = await findSharedPost(postId);

  if (!post || post.hiddenAt) {
    notFound();
  }

  const isExpired = isPostExpired(post.expiresAt);
  const provenanceLabel = post.locationVerified ? "현장 인증" : "상태 제보";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          padding: 56,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#f8fafc",
          color: "#0f172a",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", color: "#16a34a", fontSize: 34, fontWeight: 900 }}>#실시간</div>
          <div style={{ display: "flex", padding: "14px 22px", borderRadius: 999, background: "#dcfce7", color: "#15803d", fontSize: 28, fontWeight: 800 }}>
            {isExpired ? `지난 제보 · ${provenanceLabel}` : provenanceLabel}
          </div>
        </div>
        <div
          style={{
            borderRadius: 42,
            padding: 48,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            flex: 1,
            marginTop: 28,
            background: variantGradients[post.shareCard.variant] ?? variantGradients.good,
            color: "#ffffff",
          }}
        >
          <div style={{ display: "flex", fontSize: 28, fontWeight: 800, opacity: 0.88 }}>{post.photoLabel}</div>
          <div style={{ display: "flex", marginTop: 28, fontSize: 72, lineHeight: 1.05, fontWeight: 900 }}>{post.shareCard.headline}</div>
          <div style={{ display: "flex", marginTop: 24, fontSize: 32, lineHeight: 1.35, fontWeight: 800, whiteSpace: "pre-wrap" }}>{`${isExpired ? "지난 제보 · " : ""}${post.shareCard.body}`}</div>
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 28, fontSize: 26, color: "#15803d", fontWeight: 800 }}>
          {post.shareCard.hashtags.slice(0, 4).map((tag) => (
            <div key={tag} style={{ display: "flex", padding: "12px 18px", borderRadius: 999, background: "#ecfdf3" }}>#{tag}</div>
          ))}
        </div>
        <div style={{ display: "flex", marginTop: 18, fontSize: 24, color: "#64748b", fontWeight: 700 }}>
          제보 시각 {formatSharedPostObservedAt(post.createdAt)}
        </div>
        {isExpired && <div style={{ display: "flex", marginTop: 10, fontSize: 22, color: "#6e6e73", fontWeight: 700 }}>현재 방문 판단에는 사용하지 않는 만료 제보</div>}
      </div>
    ),
    size,
  );
}
