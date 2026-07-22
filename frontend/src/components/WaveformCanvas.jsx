import { memo, useEffect, useRef } from "react";

export const WaveformCanvas = memo(function WaveformCanvas({ active = true, compact = false }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const context = canvas.getContext("2d");
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduceMotion = motionQuery.matches;
    let documentVisible = !document.hidden;
    let elementVisible = true;
    let lastDrawTime = Number.NEGATIVE_INFINITY;
    let cssWidth = 0;
    let cssHeight = 0;
    let dpr = 1;
    let raf = 0;

    const schedule = () => {
      if (!raf && documentVisible && elementVisible) {
        raf = requestAnimationFrame(render);
      }
    };

    const render = (timestamp = performance.now()) => {
      raf = 0;
      if (!documentVisible || !elementVisible) return;
      if (active && !reduceMotion && timestamp - lastDrawTime < 1000 / 24) {
        schedule();
        return;
      }

      if (cssWidth <= 0 || cssHeight <= 0) {
        return;
      }

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.scale(dpr, dpr);
      const mid = cssHeight / 2;
      const bars = compact ? 28 : 46;
      const gap = cssWidth / bars;
      const phase = reduceMotion ? 0 : timestamp * 0.0027;
      context.strokeStyle = active ? "#22cfff" : "#365064";
      context.lineWidth = 1;
      context.shadowColor = active ? "#0084ee" : "transparent";
      context.shadowBlur = active ? 5 : 0;

      for (let index = 0; index < bars; index += 1) {
        const envelope = 0.25 + Math.sin(index * 0.71 + phase) ** 2 * 0.75;
        const jitter = 0.55 + Math.sin(index * 1.91 - phase * 1.4) ** 2 * 0.45;
        const amplitude = active ? Math.max(2, envelope * jitter * mid * 0.78) : 1.5;
        const x = index * gap + gap / 2;
        context.beginPath();
        context.moveTo(x, mid - amplitude);
        context.lineTo(x, mid + amplitude);
        context.stroke();
      }
      context.restore();
      lastDrawTime = timestamp;

      if (active && !reduceMotion) {
        schedule();
      }
    };

    const updateSize = () => {
      const rect = canvas.getBoundingClientRect();
      cssWidth = rect.width;
      cssHeight = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(cssWidth * dpr));
      const height = Math.max(1, Math.round(cssHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      schedule();
    };

    const resizeObserver = new ResizeObserver(updateSize);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      elementVisible = entry?.isIntersecting ?? true;
      if (elementVisible) schedule();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    });
    const handleVisibility = () => {
      documentVisible = !document.hidden;
      if (documentVisible) schedule();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    const handleMotionPreference = (event) => {
      reduceMotion = event.matches;
      schedule();
    };

    resizeObserver.observe(canvas);
    intersectionObserver.observe(canvas);
    document.addEventListener("visibilitychange", handleVisibility);
    motionQuery.addEventListener("change", handleMotionPreference);
    updateSize();

    return () => {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
      motionQuery.removeEventListener("change", handleMotionPreference);
      cancelAnimationFrame(raf);
    };
  }, [active, compact]);

  return <canvas ref={canvasRef} className="waveform" aria-hidden="true" />;
});
