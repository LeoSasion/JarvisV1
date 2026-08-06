import { useEffect, useRef } from "react";
import { NeuralVectorField } from "./VectorMarks.jsx";

export function CoreStage({ listening, onActivate }) {
  const stageRef = useRef(null);
  const rectRef = useRef(null);
  const pointerRef = useRef(null);
  const frameRef = useRef(0);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;

    const updateRect = () => {
      rectRef.current = stage.getBoundingClientRect();
    };
    updateRect();
    const observer = new ResizeObserver(updateRect);
    observer.observe(stage);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const applyPointer = () => {
    frameRef.current = 0;
    const stage = stageRef.current;
    const rect = rectRef.current;
    const point = pointerRef.current;
    if (!stage || !rect || !point || rect.width <= 0 || rect.height <= 0) return;

    const x = ((point.x - rect.left) / rect.width - 0.5) * 2;
    const y = ((point.y - rect.top) / rect.height - 0.5) * 2;
    stage.style.setProperty("--parallax-x", `${x * 8}px`);
    stage.style.setProperty("--parallax-y", `${y * 6}px`);
  };

  const handlePointerMove = (event) => {
    pointerRef.current = { x: event.clientX, y: event.clientY };
    if (!frameRef.current) frameRef.current = requestAnimationFrame(applyPointer);
  };

  const resetPointer = () => {
    const stage = stageRef.current;
    if (!stage) return;
    pointerRef.current = null;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    stage.style.setProperty("--parallax-x", "0px");
    stage.style.setProperty("--parallax-y", "0px");
  };

  return (
    <section
      ref={stageRef}
      className={`core-stage ${listening ? "is-listening" : ""}`}
      onPointerEnter={() => {
        rectRef.current = stageRef.current?.getBoundingClientRect() ?? null;
      }}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetPointer}
      aria-label="JARVIS ambient core"
    >
      <div className="core-stage__media" aria-hidden="true">
        <NeuralVectorField active={listening} />
        <div className="core-stage__readout">
          <span>LOCAL VISUAL FRAME</span>
          <strong>{listening ? "AGENT PROCESS ACTIVE" : "SYSTEM NOMINAL"}</strong>
          <small>VECTOR FIELD // OWN PROCESS</small>
        </div>
      </div>
      <button
        type="button"
        className="core-hotspot"
        onClick={onActivate}
        aria-label="Open JARVIS Pi Agent"
        title="Open Pi Agent"
      >
        <span className="core-hotspot__mark" aria-hidden="true"><i /><i /><i /><i /><b /></span>
        <span className="core-hotspot__copy" aria-hidden="true">
          <strong>PI AGENT</strong>
          <small>{listening ? "PROCESS ACTIVE" : "OPEN CHANNEL"}</small>
        </span>
      </button>
    </section>
  );
}
