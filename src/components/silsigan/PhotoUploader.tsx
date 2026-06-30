"use client";

import { Camera, Flag, Image as ImageIcon, Trash2 } from "lucide-react";
import { type CSSProperties, useId, useRef, useState } from "react";
import styles from "./SilsiganRedesign.module.css";
import { EmptyState } from "./EmptyState";

const PHOTO_MAX_BYTES = 3 * 1024 * 1024;
const PHOTO_MAX_DIMENSION = 1280;

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
  base64: string;
  byteSize: number;
  height: number;
  mimeType: PhotoMimeType;
  width: number;
};

export function PhotoUploader({
  onDeletePhoto,
  onPhotoClick,
  onReportPhoto,
  onUpload,
  photos,
  safetyNotice,
}: {
  onDeletePhoto?: (photo: PlacePhoto) => Promise<void>;
  onPhotoClick?: (photo: PlacePhoto) => Promise<void>;
  onReportPhoto?: (photo: PlacePhoto) => void;
  onUpload: (photo: PreparedPhotoUpload) => Promise<void>;
  photos: PlacePhoto[];
  safetyNotice?: string | null;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "processing" | "uploading" | "done" | "error">("idle");
  const [message, setMessage] = useState("JPEG 또는 WebP 1장, 최대 3MB");
  const [clickingPhotoId, setClickingPhotoId] = useState<string | null>(null);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const busy = status === "processing" || status === "uploading";

  const selectPhoto = () => {
    if (!busy) {
      inputRef.current?.click();
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) {
      return;
    }

    setStatus("processing");
    setMessage("사진을 안전한 크기로 다시 저장하는 중");

    try {
      const prepared = await preparePhotoForUpload(file);
      setStatus("uploading");
      setMessage("사진을 서버에 저장하는 중");
      await onUpload(prepared);
      setStatus("done");
      setMessage("사진 제보가 등록됐습니다.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "사진 제보에 실패했습니다.");
    }
  };

  const clickPhoto = async (photo: PlacePhoto) => {
    if (!photo.workerPhotoId || !onPhotoClick || clickingPhotoId) {
      return;
    }

    setClickingPhotoId(photo.id);
    setStatus("processing");
    setMessage("사진 확인을 반영하는 중");
    try {
      await onPhotoClick(photo);
      setStatus("done");
      setMessage("사진 확인이 반영됐습니다.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "사진 확인을 반영하지 못했습니다.");
    } finally {
      setClickingPhotoId(null);
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
        onChange={handleFileChange}
      />
      <button className={styles.photoUploadButton} type="button" onClick={selectPhoto} disabled={busy} aria-describedby={`${inputId}-status`}>
        <Camera size={18} />
        {busy ? "처리 중" : "사진 제보"}
      </button>
      <p id={`${inputId}-status`} className={`${styles.photoUploadStatus} ${status === "error" ? styles.photoUploadError : ""}`}>
        {message}
      </p>
      {safetyNotice && <p className={styles.photoSafetyNotice}>{safetyNotice}</p>}
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
                  <span className={styles.photoPreviewImage} style={previewStyle} aria-hidden />
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
                    onClick={() => void clickPhoto(photo)}
                    disabled={clickingPhotoId === photo.id}
                    aria-label={`${photo.label} 사진 확인`}
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

async function preparePhotoForUpload(file: File): Promise<PreparedPhotoUpload> {
  const sourceMimeType = photoMimeType(file.type);
  if (file.size > PHOTO_MAX_BYTES) {
    throw new Error("사진은 3MB 이하만 올릴 수 있습니다.");
  }

  const image = await loadImage(file);
  const { width, height } = fitInside(image.naturalWidth, image.naturalHeight, PHOTO_MAX_DIMENSION);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("이 브라우저에서는 사진을 처리할 수 없습니다.");
  }

  context.drawImage(image, 0, 0, width, height);
  const blob = await canvasToBlob(canvas, sourceMimeType);
  const mimeType = photoMimeType(blob.type || sourceMimeType);
  if (blob.size > PHOTO_MAX_BYTES) {
    throw new Error("다시 저장한 사진도 3MB를 넘습니다.");
  }

  return {
    base64: await blobToBase64(blob),
    byteSize: blob.size,
    height,
    mimeType,
    width,
  };
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

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: PhotoMimeType): Promise<Blob> {
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
      0.86,
    );
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : value);
    };
    reader.onerror = () => reject(new Error("사진 파일을 인코딩하지 못했습니다."));
    reader.readAsDataURL(blob);
  });
}

function photoPreviewStyle(previewUrl: string | undefined): CSSProperties | undefined {
  if (!previewUrl) {
    return undefined;
  }

  try {
    const url = new URL(previewUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return undefined;
    }

    return { backgroundImage: `url("${url.href}")` };
  } catch {
    return undefined;
  }
}
