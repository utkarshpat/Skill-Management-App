import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist';

export function CertificatePdfPreview({ url, fileName }: { url: string; fileName: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState({ url, loading: true, error: '', pages: 0 });
  useEffect(() => {
    let closed = false;
    let loading: PDFDocumentLoadingTask | undefined;
    let rendering: RenderTask | undefined;
    setState({ url, loading: true, error: '', pages: 0 });
    void (async () => {
      const [pdfjs, worker] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ]);
      if (closed) return;
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      loading = pdfjs.getDocument({ url });
      const document = await loading.promise;
      if (closed) return;
      const page = await document.getPage(1);
      if (closed || !canvas.current) return;
      const initial = page.getViewport({ scale: 1 });
      // Bound canvas allocation for large pages; the original is available separately.
      const viewport = page.getViewport({
        scale: Math.min(1000 / initial.width, 1600 / initial.height, 2),
      });
      const element = canvas.current;
      element.width = Math.ceil(viewport.width);
      element.height = Math.ceil(viewport.height);
      rendering = page.render({ canvas: element, viewport });
      await rendering.promise;
      if (!closed) setState({ url, loading: false, error: '', pages: document.numPages });
    })().catch(() => {
      if (!closed)
        setState({
          url,
          loading: false,
          error: 'Preview could not be loaded. Use View certificate or Download.',
          pages: 0,
        });
    });
    return () => {
      closed = true;
      rendering?.cancel();
      void loading?.destroy().catch(() => {});
    };
  }, [url]);
  const current = state.url === url ? state : { loading: true, error: '', pages: 0 };
  return (
    <div className="certificate-pdf-preview" aria-busy={current.loading}>
      {current.loading && <p role="status">Loading certificate preview…</p>}
      {current.error && <p role="status">{current.error}</p>}
      <canvas
        key={url}
        ref={canvas}
        hidden={current.loading || Boolean(current.error)}
        role="img"
        aria-label={`First page of ${fileName}`}
      />
      {!current.loading && !current.error && <p className="cert-help">Page 1 of {current.pages}</p>}
    </div>
  );
}
