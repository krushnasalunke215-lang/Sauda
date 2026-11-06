import { useRef, useState } from 'react';
import type { PhotoKind } from '../../../shared/types.js';

const MAX_SIDE = 1600;
const QUALITY = 0.85;

/** Downscales a photo so its longest side is at most 1600 px and re-encodes it as JPEG. */
export async function downscale(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = '#fff'; // transparent PNG areas become white, not black
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', QUALITY));
  } finally {
    bitmap.close();
  }
}

/** Picks a photo, downscales it and hands the JPEG to onUpload. */
export function PhotoButton({
  kind,
  label,
  busyLabel,
  disabled,
  onUpload,
}: {
  kind: PhotoKind;
  label: string;
  busyLabel: string;
  disabled: boolean;
  onUpload: (jpeg: Blob) => Promise<boolean>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onPick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      let jpeg: Blob;
      try {
        jpeg = await downscale(file);
      } catch {
        jpeg = file; // the server still accepts the original JPEG, PNG or WebP
      }
      await onUpload(jpeg);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <>
      <button
        type="button"
        data-testid="photo-button"
        data-kind={kind}
        disabled={disabled || busy}
        onClick={() => input.current?.click()}
        className="flex items-center gap-1 rounded-xl bg-stone-100 px-3 py-2 text-sm text-stone-800 ring-1 ring-stone-300 hover:bg-stone-200 disabled:opacity-50"
      >
        <span aria-hidden>📷</span>
        {busy ? busyLabel : label}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        data-testid="photo-input"
        data-kind={kind}
        className="hidden"
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
    </>
  );
}
