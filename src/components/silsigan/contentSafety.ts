const privacyContentPatterns = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /(?:^|[^\d])\d{6}\s*-\s*[1-4]\d{6}(?:$|[^\d])/,
  /(?:01[016789]|0\d{1,2})[-.\s]?\d{3,4}[-.\s]?\d{4}/,
  /(?:^|[^\d])\d{2,3}\s*[가-힣]\s*\d{4}(?:$|[^\d])/u,
];

const spamContentPatterns = [
  /https?:\/\//i,
  /www\./i,
  /javascript:/i,
  /<\s*\/?\s*(script|iframe|object|embed)\b/i,
];

export function contentSafetyWarningFor(text: string): string | null {
  const value = text.trim();
  if (!value) return null;

  if (privacyContentPatterns.some((pattern) => pattern.test(value))) {
    return "전화번호, 이메일, 차량번호 같은 개인정보는 올릴 수 없습니다.";
  }

  if (spamContentPatterns.some((pattern) => pattern.test(value))) {
    return "링크나 스크립트는 올릴 수 없습니다. 장소 상황만 짧게 남겨 주세요.";
  }

  return null;
}
