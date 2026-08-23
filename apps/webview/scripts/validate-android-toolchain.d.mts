export const REQUIRED_ANDROID_JAVA_MAJOR: 21;

export function parseJavaMajor(output: string): number | null;
export function resolveJavaExecutable(env?: Readonly<Record<string, string | undefined>>): string;
export function detectJavaMajor(javaExecutable?: string): number;
export function validateAndroidToolchain(input?: {
  javaExecutable?: string;
  javaMajor?: number;
}): {
  javaExecutable: string;
  javaMajor: number;
};
