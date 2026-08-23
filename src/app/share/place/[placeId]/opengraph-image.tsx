import { notFound } from "next/navigation";
import { sharedPlaceFallbackImagePath } from "@/lib/shared-place";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

type OpenGraphImageProps = {
  params: Promise<{
    placeId: string;
  }>;
};

export default async function OpenGraphImage({ params }: OpenGraphImageProps) {
  const { placeId } = await params;
  const imagePath = sharedPlaceFallbackImagePath(placeId);

  if (!imagePath) {
    notFound();
  }

  return new Response(null, {
    status: 307,
    headers: {
      location: imagePath,
      "cache-control": "public, max-age=300",
    },
  });
}
