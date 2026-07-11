import type { ActorIdentity } from "./types.ts";

export function identityKey(identity: ActorIdentity): string {
  if (identity.kind === "anonymous") {
    const id = identity.anonymousId.trim();
    if (!id) {
      throw new Error("anonymousId is required");
    }
    return `anonymous:${id}`;
  }

  const id = identity.profileId.trim();
  if (!id) {
    throw new Error("profileId is required");
  }
  return `member:${id}`;
}
