import { memo, useEffect, useRef } from "react";
import { useReducedMotion } from "../hooks/useReducedMotion.js";

export const WaveformCanvas = memo(function WaveformCanvas({ active = true, compact = false }) {
  const canvasRef = useRef(null);
  const motionReduced = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const context = canvas.getContext("2d");
    let documentVisible = !document.hidden;
    let elementVisible = true;
    let lastDrawTime = Number.NEGATIVE_INFINITY;
    let cssWidth = 0;
    let cssHeight = 0;
    let dpr = 1;
    let raf = 0;
    let signalColor = "#ff6a00";
    let structureColor = "#77716a";

    const schedule = () => {
      if (!raf && documentVisible && elementVisible) {
        raf = requestAnimationFrame(render);
      }
    };

    const render = (timestamp = performance.now()) => {
      raf = 0;
      if (!documentVisible || !elementVisible) return;
      if (active && !motionReduced && timestamp - lastDrawTime < 1000 / 24) {
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
      const phase = motionReduced ? 0 : timestamp * 0.0027;
      context.strokeStyle = active ? signalColor : structureColor;
      context.lineWidth = 1;
      context.shadowColor = active ? signalColor : "transparent";
      context.shadowBlur = active ? 3 : 0;

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

      if (active && !motionReduced) {
        schedule();
      }
    };

    const updateSize = () => {
      const rect = canvas.getBoundingClientRect();
      const computedStyle = getComputedStyle(canvas);
      signalColor = computedStyle.getPropertyValue("--signal-hot").trim() || "#ff6a00";
      structureColor = computedStyle.getPropertyValue("--structure-strong").trim() || "#77716a";
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
    resizeObserver.observe(canvas);
    intersectionObserver.observe(canvas);
    document.addEventListener("visibilitychange", handleVisibility);
    updateSize();

    return () => {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
      cancelAnimationFrame(raf);
    };
  }, [active, compact, motionReduced]);

  return <canvas ref={canvasRef} className="waveform" aria-hidden="true" />;
});
