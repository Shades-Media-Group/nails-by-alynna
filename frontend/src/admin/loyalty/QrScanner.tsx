import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/ui';
import { QrCodeScannerIcon } from '@/components/ui/icons';

type State = 'idle' | 'starting' | 'running' | 'denied' | 'unsupported' | 'failed';

interface Detector {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
}

/** The phone's own QR reader where there is one (Chrome on Android); jsQR everywhere else (iOS). */
async function createDetector(): Promise<Detector> {
  const Native = (window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } })
    .BarcodeDetector;
  if (Native) {
    try {
      const formats = (await Native.getSupportedFormats?.()) ?? [];
      if (formats.includes('qr_code')) return new Native({ formats: ['qr_code'] });
    } catch {
      // Fall through to jsQR.
    }
  }
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return {
    async detect(source) {
      const video = source as HTMLVideoElement;
      if (!ctx || !video.videoWidth) return [];
      // Decoding a ~480 px frame is plenty for a QR on a phone screen, and fast.
      const scale = Math.min(1, 480 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
      return found ? [{ rawValue: found.data }] : [];
    },
  };
}

/**
 * Camera QR reader for the desk. Starts on a tap (and asks for the camera then), reads a few
 * frames a second, stops the camera as soon as a code is read or the app is hidden.
 */
export function QrScanner({ onCode }: { onCode: (text: string) => void }) {
  const { t } = useTranslation('loyalty');
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const [state, setState] = useState<State>(() =>
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function' ? 'idle' : 'unsupported',
  );

  const stop = useCallback(() => {
    window.clearTimeout(timer.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);

  const start = async () => {
    setState('starting');
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      stream.current = media;
      const el = video.current;
      if (!el) return stop();
      el.srcObject = media;
      await el.play();
      setState('running');
      const detector = await createDetector();
      const tick = async () => {
        if (!stream.current || !video.current) return;
        try {
          const [hit] = await detector.detect(video.current);
          if (hit?.rawValue) {
            navigator.vibrate?.(30);
            stop();
            setState('idle');
            onCode(hit.rawValue);
            return;
          }
        } catch {
          // A frame that couldn't be read; try the next one.
        }
        timer.current = window.setTimeout(() => void tick(), 140);
      };
      void tick();
    } catch (error) {
      stop();
      const name = (error as { name?: string }).name;
      setState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' ? 'unsupported' : 'failed');
    }
  };

  // Hidden app or leaving the page: the camera goes off.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && stream.current) {
        stop();
        setState('idle');
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      stop();
    };
  }, [stop]);

  const live = state === 'running' || state === 'starting';

  return (
    <div className="flex flex-col gap-3">
      <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-2xl bg-ink-900">
        <video ref={video} playsInline muted autoPlay className={live ? 'size-full object-cover' : 'hidden'} aria-hidden="true" />
        {!live ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center text-white">
            <QrCodeScannerIcon fontSize="inherit" className="text-6xl text-white/80" />
            {state !== 'unsupported' ? (
              <Button variant="soft" onClick={() => void start()}>
                {t('scan.start')}
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            {/* Aim here: a rounded frame with a slow sweep, like the system camera. */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-[18%] rounded-2xl ring-2 ring-white/85" />
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-[18%] h-0.5 animate-[scanline_1.8s_ease-in-out_infinite] bg-rose-400/80 motion-reduce:hidden" />
            {state === 'starting' ? (
              <p className="absolute inset-x-0 bottom-4 text-center text-sm text-white/80" role="status">
                {t('scan.starting')}
              </p>
            ) : null}
            <Button
              variant="soft"
              size="sm"
              className="absolute bottom-3 left-1/2 -translate-x-1/2"
              onClick={() => {
                stop();
                setState('idle');
              }}
            >
              {t('scan.stop')}
            </Button>
          </>
        )}
      </div>
      {state === 'denied' ? <Alert tone="warning">{t('scan.denied')}</Alert> : null}
      {state === 'unsupported' ? <Alert tone="info">{t('scan.unsupported')}</Alert> : null}
      {state === 'failed' ? <Alert tone="warning">{t('scan.failed')}</Alert> : null}
    </div>
  );
}
