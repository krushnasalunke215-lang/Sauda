import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { ui } from '../ui.js';

/** A QR code of `url`, drawn in the browser. A grey placeholder of the same size shows until it is ready. */
export function QrImage({ url, size, alt, testId, className = '' }: { url: string; size: number; alt: string; testId: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setSrc(null);
    QRCode.toDataURL(url, { margin: 1, width: size * 2 })
      .then((d) => live && setSrc(d))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [url, size]);
  if (!src) return <div className={`${ui.skeleton} shrink-0 rounded-lg ${className}`} style={{ width: size, height: size }} aria-hidden />;
  return <img data-testid={testId} src={src} width={size} height={size} alt={alt} title={alt} className={`shrink-0 rounded-lg ring-1 ring-stone-200 ${className}`} />;
}
