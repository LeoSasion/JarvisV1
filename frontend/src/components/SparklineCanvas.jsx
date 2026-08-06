import { memo, useEffect, useRef } from "react";

function drawSparkline(canvas, points, accent) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const context = canvas.getContext("2d");
  context.clearRect(0, 0, width, height);
  context.save();
  context.scale(dpr, dpr);

  const cssWidth = rect.width;
  const cssHeight = rect.height;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = Math.max(1, max - min);
  const pad = 2;

  context.beginPath();
  points.forEach((point, index) => {
    const x = (index / (points.length - 1)) * cssWidth;
    const y = pad + (1 - (point - min) / range) * (cssHeight - pad * 2);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.strokeStyle = accent;
  context.lineWidth = 1;
  context.shadowBlur = 5;
  context.shadowColor = accent;
  context.stroke();
  context.restore();
}

export const SparklineCanvas = memo(function SparklineCanvas({ points }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const render = () => {
      const accent = getComputedStyle(canvas).getPropertyValue("--spark-color").trim() || "#ff6a00";
      drawSparkline(canvas, points, accent);
    };

    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [points]);

  return <canvas ref={canvasRef} className="sparkline" aria-hidden="true" />;
});
