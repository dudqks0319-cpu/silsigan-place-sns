import { isSafePlaceId } from "@/lib/shared-post";
import { notFound, redirect } from "next/navigation";

type PlaceRedirectPageProps = {
  params: Promise<{
    placeId: string;
  }>;
};

export default async function PlaceRedirectPage({ params }: PlaceRedirectPageProps) {
  const { placeId } = await params;

  if (!isSafePlaceId(placeId)) {
    notFound();
  }

  redirect(`/?place=${encodeURIComponent(placeId)}`);
}
