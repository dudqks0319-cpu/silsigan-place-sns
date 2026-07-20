"use client";

import { Camera, Flag, Image as ImageIcon, Trash2 } from "lucide-react";
import { type CSSProperties, useId, useRef, useState } from "react";
import {
  PHOTO_LOCAL_SOURCE_MAX_BYTES,
  PHOTO_MAX_DIMENSION,
  PHOTO_RIGHTS_TERMS_VERSION,
  PHOTO_UPLOAD_MAX_BYTES,
} from "../../../packages/contracts/src/index.ts";
import styles from "./SilsiganRedesign.module.css";
import { EmptyState } from "./EmptyState";

const PHOTO_OUTPUT_QUALITIES = [0.82, 0.68, 0.54, 0.42] as const;
const PHOTO_OUTPUT_DIMENSIONS = [PHOTO_MAX_DIMENSION, 1024, 800, 640] as const;

type PhotoMimeType = "image/jpeg" | "image/webp";

export type PlacePhoto = {
  id: string;
  label: string;
  meta: string;
  ownedByCurrentSession?: boolean;
  previewUrl?: string;
  workerPhotoId?: string;
};

export type PreparedPhotoUpload = {
  blob: Blob;
  byteSize: number;
  height: number;
  mimeType: PhotoMimeType;
  rightsAttested: true;
  rightsPolicyVersion: typeof PHOTO_RIGHTS_TERMS_VERSION;
  width: number;
};

type ReencodedPhoto = Omit<PreparedPhotoUpload, "rightsAttested" | "rightsPolicyVersion">;

export function PhotoUploader({
  onDeletePhoto,
  onPhotoClick,
  onReportPhoto,
  onUpload,
  photos,
  safetyNotice,
  uploadEnabled = true,
}: {
  onDeletePhoto?: (photo: PlacePhoto) => Promise<void>;
  onPhotoClick?: (photo: PlacePhoto) => Promise<void>;
  onReportPhoto?: (photo: PlacePhoto) => void;
  onUpload: (photo: PreparedPhotoUpload) => Promise<void>;
  photos: PlacePhoto[];
  safetyNotice?: string | null;
  uploadEnabled?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "processing" | "uploading" | "done" | "error">("idle");
  const [message, setMessage] = useState(
    uploadEnabled
      ? "JPEG 또는 WebP 원본을 고르면 서버 전송 전에 1MB 이하로 안전하게 다시 저장합니다. #실시간 앱은 iPhone HEIC를 JPEG로 자동 변환합니다."
      : "사진 업로드 서버에 연결되지 않았습니다. 확인한 상태는 사진 없이도 제보할 수 있습니다.",
  );
  const [viewingPhotoId, setViewingPhotoId] = useState<string | null>(null);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const busy = status === "processing" || status === "uploading";

  const uploadPhoto = async (file: File) => {
    if (!rightsConfirmed) {
      setStatus("error");
      setMessage("직접 촬영했거나 게시 권한이 있는 사진인지 먼저 확인해 주세요.");
      return;
    }

    setStatus("processing");
    setMessage("사진을 안전한 크기로 다시 저장하는 중");

    try {
      const prepared = await preparePhotoForUpload(file);
      setStatus("uploading");
      setMessage("사진을 서버에 저장하는 중");
      await onUpload({
        ...prepared,
        rightsAttested: true,
        rightsPolicyVersion: PHOTO_RIGHTS_TERMS_VERSION,
      });
      setStatus("done");
      setMessage("사진이 등록됐습니다.");
      setRightsConfirmed(false);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "사진을 올리지 못했습니다.");
    }
  };

  const selectPhoto = async () => {
    if (busy || !uploadEnabled || !rightsConfirmed) {
      return;
    }

    const nativeBridge = window.SilsiganNativeBridge;
    if (!nativeBridge) {
      inputRef.current?.click();
      return;
    }

    setStatus("processing");
    setMessage("iPhone 사진을 JPEG로 안전하게 변환하는 중");
    try {
      const response = await nativeBridge.invoke({
        requestId: nativePhotoRequestId(),
        command: "selectPhoto",
        payload: { purpose: "field_report", maxBytes: PHOTO_LOCAL_SOURCE_MAX_BYTES },
      });
      if (!response.ok) {
        throw new Error(nativePhotoErrorMessage(response.error?.code));
      }
      const nativePhoto = parseNativePhoto(response.value);
      const photoResponse = await fetch(nativePhoto.url);
      if (!photoResponse.ok) {
        throw new Error("선택한 사진을 읽지 못했습니다.");
      }
      const blob = await photoResponse.blob();
      const file = new File([blob], "native-photo.jpg", { type: nativePhoto.mimeType });
      await uploadPhoto(file);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "사진을 불러오지 못했습니다.");
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) {
      return;
    }

    await uploadPhoto(file);
  };

  const viewPhoto = async (photo: PlacePhoto) => {
    if (!photo.workerPhotoId || !onPhotoClick || viewingPhotoId) {
      return;
    }

    setViewingPhotoId(photo.id);
    setStatus("processing");
    setMessage("사진 조회수를 반영하는 중");
    try {
      await onPhotoClick(photo);
      setStatus("done");
      setMessage("사진 조회수가 반영됐습니다.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "사진 조회수를 반영하지 못했습니다.");
    } finally {
      setViewingPhotoId(null);
    }
  };

  const deletePhoto = async (photo: PlacePhoto) => {
    if (!photo.workerPhotoId || !photo.ownedByCurrentSession || !onDeletePhoto || deletingPhotoId) {
      return;
    }

    setDeletingPhotoId(photo.id);
    setStatus("processing");
    setMessage("내 사진을 삭제하는 중");
    try {
      await onDeletePhoto(photo);
      setStatus("done");
      setMessage("내 사진이 삭제됐습니다.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "사진을 삭제하지 못했습니다.");
    } finally {
      setDeletingPhotoId(null);
    }
  };

  return (
    <section className={styles.photoUploadPanel} aria-label="현장 사진">
      <input
        ref={inputRef}
        id={inputId}
        className={styles.hiddenFileInput}
        type="file"
        accept="image/jpeg,image/webp"
        disabled={!uploadEnabled || !rightsConfirmed}
        onChange={handleFileChange}
      />
      <label className={styles.photoRightsConfirmation} aria-label="사진 게시 권한 확인">
        <input
          type="checkbox"
          checked={rightsConfirmed}
          disabled={busy || !uploadEnabled}
          onChange={(event) => {
            const checked = event.target.checked;
            setRightsConfirmed(checked);
            setMessage(
              checked
                ? "JPEG 또는 WebP 원본 1장(최대 12MB)을 고르면 서버 전송 전에 1MB 이하로 다시 저장합니다."
                : "직접 촬영했거나 게시 권한이 있는 사진인지 먼저 확인해 주세요.",
            );
          }}
        />
        <span>제가 촬영했거나 이 사진을 게시할 권한이 있으며, 공개 전 안전 검수에 동의합니다.</span>
      </label>
      <button
        className={styles.photoUploadButton}
        type="button"
        onClick={() => void selectPhoto()}
        disabled={busy || !uploadEnabled || !rightsConfirmed}
        aria-busy={busy}
        aria-describedby={`${inputId}-status`}
      >
        <Camera size={18} />
        {!uploadEnabled ? "사진 업로드 불가" : busy ? "처리 중" : !rightsConfirmed ? "권한 확인 후 사진 올리기" : "사진 올리기"}
      </button>
      <p id={`${inputId}-status`} className={`${styles.photoUploadStatus} ${status === "error" ? styles.photoUploadError : ""}`} aria-live="polite">
        {message}
      </p>
      {safetyNotice && <p className={styles.photoSafetyNotice}>{safetyNotice}</p>}
      {photos.some((photo) => photo.workerPhotoId && onPhotoClick) && (
        <p className={styles.photoSafetyNotice}>
          사진 보기는 조회수만 기록하며 현재 상태 확인으로 처리되지 않습니다. 상태 확인은 제보 카드에서 할 수 있습니다.
        </p>
      )}
      {photos.length === 0 ? (
        <EmptyState title="새 사진을 기다리고 있어요" body="최근 사진이 올라오면 출발 전 분위기를 빠르게 확인할 수 있습니다." />
      ) : (
        <div className={styles.photoGrid}>
          {photos.slice(0, 6).map((photo, index) => {
            const tileClassName = `${styles.photoTile} ${styles[`photo${(index % 3) + 1}` as keyof typeof styles]}`;
            const previewStyle = photoPreviewStyle(photo.previewUrl);
            const tileContents = (
              <>
                {previewStyle ? (
                  <span
                    className={styles.photoPreviewImage}
                    style={previewStyle}
                    role="img"
                    aria-label={photoAltText(photo)}
                  />
                ) : (
                  <ImageIcon size={18} aria-hidden />
                )}
                <strong>{photo.label}</strong>
                <span>{photo.meta}</span>
              </>
            );

            if (photo.workerPhotoId && onPhotoClick) {
              return (
                <div key={photo.id} className={styles.photoTileWrap}>
                  <button
                    className={`${tileClassName} ${styles.photoTileButton}`}
                    type="button"
                    onClick={() => void viewPhoto(photo)}
                    disabled={viewingPhotoId === photo.id}
                    aria-label={photoViewLabel(photo)}
                  >
                    {tileContents}
                  </button>
                  {onReportPhoto && (
                    <button className={styles.photoReportButton} type="button" onClick={() => onReportPhoto(photo)} aria-label={`${photo.label} 사진 신고`}>
                      <Flag size={13} />
                      신고
                    </button>
                  )}
                  {photo.ownedByCurrentSession && onDeletePhoto && (
                    <button
                      className={styles.photoDeleteButton}
                      type="button"
                      onClick={() => void deletePhoto(photo)}
                      aria-label={`${photo.label} 사진 삭제`}
                      disabled={deletingPhotoId === photo.id}
                    >
                      <Trash2 size={13} />
                      삭제
                    </button>
                  )}
                </div>
              );
            }

            return (
              <article key={photo.id} className={tileClassName}>
                {tileContents}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function nativePhotoRequestId(): string {
  return `native_photo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseNativePhoto(value: unknown): { mimeType: "image/jpeg"; url: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("변환된 사진 응답이 올바르지 않습니다.");
  }
  const photo = value as Record<string, unknown>;
  if (typeof photo.url !== "string" || !isAllowedNativePhotoUrl(photo.url) || photo.format !== "image/jpeg") {
    throw new Error("iPhone 사진을 JPEG로 변환하지 못했습니다.");
  }
  return { mimeType: "image/jpeg", url: photo.url };
}

function isAllowedNativePhotoUrl(value: string): boolean {
  if (value.length === 0 || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === "blob:") return true;
    if (url.protocol === "capacitor:") return url.hostname === "localhost";
    return (url.protocol === "http:" || url.protocol === "https:") && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function nativePhotoErrorMessage(code: string | undefined): string {
  if (code === "PHOTO_TOO_LARGE") return "선택한 원본 사진이 12MB를 넘습니다. 다른 사진을 선택해 주세요.";
  if (code === "PERMISSION_DENIED") return "사진 접근 권한이 필요합니다. 설정에서 사진 권한을 허용해 주세요.";
  if (code === "PHOTO_FORMAT_UNSUPPORTED") return "iPhone 사진을 JPEG로 변환하지 못했습니다.";
  return "사진을 불러오지 못했습니다. 다시 시도해 주세요.";
}

function photoAltText(photo: PlacePhoto): string {
  return `${photo.label} 현장 사진. ${photo.meta}`;
}

function photoViewLabel(photo: PlacePhoto): string {
  return `${photo.label} 사진 보기. ${photo.meta}`;
}

async function preparePhotoForUpload(file: File): Promise<ReencodedPhoto> {
  const sourceMimeType = photoMimeType(file.type);
  if (file.size > PHOTO_LOCAL_SOURCE_MAX_BYTES) {
    throw new Error("원본 사진은 12MB 이하만 선택할 수 있습니다.");
  }

  const image = await loadImage(file);
  let previousDimensions = "";

  for (const maxDimension of PHOTO_OUTPUT_DIMENSIONS) {
    const { width, height } = fitInside(image.naturalWidth, image.naturalHeight, maxDimension);
    const dimensions = `${width}x${height}`;
    if (dimensions === previousDimensions) continue;
    previousDimensions = dimensions;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("이 브라우저에서는 사진을 처리할 수 없습니다.");
    }
    context.drawImage(image, 0, 0, width, height);

    for (const quality of PHOTO_OUTPUT_QUALITIES) {
      const blob = await canvasToBlob(canvas, sourceMimeType, quality);
      if (blob.size <= PHOTO_UPLOAD_MAX_BYTES) {
        return {
          blob,
          byteSize: blob.size,
          height,
          mimeType: photoMimeType(blob.type || sourceMimeType),
          width,
        };
      }
    }
  }

  throw new Error("사진을 1MB 이하로 줄이지 못했습니다. 다른 사진을 선택해 주세요.");
}

function photoMimeType(value: string): PhotoMimeType {
  if (value === "image/jpeg" || value === "image/webp") {
    return value;
  }

  throw new Error("JPEG 또는 WebP 사진만 올릴 수 있습니다.");
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("사진 파일을 읽을 수 없습니다."));
    };
    image.decoding = "async";
    image.src = objectUrl;
  });
}

function fitInside(sourceWidth: number, sourceHeight: number, maxDimension: number) {
  const width = Math.max(1, sourceWidth);
  const height = Math.max(1, sourceHeight);
  const scale = Math.min(1, maxDimension / Math.max(width, height));

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: PhotoMimeType, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("사진을 다시 저장하지 못했습니다."));
          return;
        }

        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

function photoPreviewStyle(previewUrl: string | undefined): CSSProperties | undefined {
  if (!previewUrl) {
    return undefined;
  }

  if (previewUrl.startsWith("/")) {
    return { backgroundImage: `url(${JSON.stringify(previewUrl)})` };
  }

  try {
    const url = new URL(previewUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return undefined;
    }

    return { backgroundImage: `url(${JSON.stringify(url.href)})` };
  } catch {
    return undefined;
  }
}
