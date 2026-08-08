import { useEffect, useRef } from "react";
import { getKnowledgeGraphPresentation } from "../knowledge-graph-model.js";
import { KnowledgeGraphField } from "./VectorMarks.jsx";

export function CoreStage({ graphState = null }) {
  const stageRef = useRef(null);
  const rectRef = useRef(null);
  const pointerRef = useRef(null);
  const frameRef = useRef(0);
  const presentation = getKnowledgeGraphPresentation(graphState);

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
      className={`core-stage is-${presentation.status}`}
      onPointerEnter={() => {
        rectRef.current = stageRef.current?.getBoundingClientRect() ?? null;
      }}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetPointer}
      aria-label="JARVIS knowledge graph workspace"
    >
      <p className="sr-only">{presentation.announcement}</p>
      <div className="core-stage__media" aria-hidden="true">
        <KnowledgeGraphField connected={presentation.connected} />
        <div className="core-stage__readout">
          <span>LOCAL KNOWLEDGE GRAPH</span>
          <strong>{presentation.title}</strong>
          <small>{presentation.detail}</small>
          <small>{presentation.meta}</small>
        </div>
      </div>
    </section>
  );
}
