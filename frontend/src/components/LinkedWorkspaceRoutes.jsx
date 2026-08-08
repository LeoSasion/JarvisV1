import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  createThreeSegmentRoute,
  isRouteAnchorVisible,
  roundRouteCoordinate,
} from "../linked-workspace-route-model.js";
import { useReducedMotion } from "../hooks/useReducedMotion.js";

const LAYOUT_TRACKING_MS = 340;
const VIEWPORT_INSET = 1;

function relationElements(attribute, relationId) {
  return [...document.querySelectorAll(`[${attribute}]`)]
    .filter((element) => element.getAttribute(attribute) === relationId);
}

function viewportRectFor(element) {
  const viewport = element?.closest?.("[data-linked-scroll-viewport]");
  if (viewport) return viewport.getBoundingClientRect();
  return {
    left: VIEWPORT_INSET,
    top: VIEWPORT_INSET,
    right: window.innerWidth - VIEWPORT_INSET,
    bottom: window.innerHeight - VIEWPORT_INSET,
    width: window.innerWidth - (VIEWPORT_INSET * 2),
    height: window.innerHeight - (VIEWPORT_INSET * 2),
  };
}

function visibleRelationElement(elements) {
  return elements.find((element) => {
    const rect = element.getBoundingClientRect();
    return isRouteAnchorVisible(rect, viewportRectFor(element));
  }) ?? null;
}

function edgePoint(rect, edge) {
  if (!rect) return null;
  return {
    x: roundRouteCoordinate(edge === "right" ? rect.right : rect.left),
    y: roundRouteCoordinate(rect.top + (rect.height / 2)),
  };
}

function readRouteGeometry(relationId) {
  const origins = relationElements("data-agent-relation-origin", relationId);
  const targets = relationElements("data-agent-relation-target", relationId);
  const origin = visibleRelationElement(origins);
  const target = visibleRelationElement(targets);
  const observed = new Set([...origins, ...targets]);
  for (const element of [...observed]) {
    const viewport = element.closest?.("[data-linked-scroll-viewport]");
    if (viewport) observed.add(viewport);
  }

  if (!origin || !target) {
    return { visible: false, observed: [...observed], mutationRoot: null };
  }

  const originRect = origin.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const forwards = originRect.left <= targetRect.left;
  const start = edgePoint(originRect, forwards ? "right" : "left");
  const end = edgePoint(targetRect, forwards ? "left" : "right");
  const corridorX = start.x + ((end.x - start.x) * 0.46);
  const path = createThreeSegmentRoute(start, end, corridorX);
  return {
    visible: Boolean(path),
    path,
    start,
    end,
    observed: [...observed],
    mutationRoot: target.closest?.("[data-linked-scroll-viewport]") ?? target.parentElement,
  };
}

function setPoint(circle, point) {
  if (!circle || !point) return;
  circle.setAttribute("cx", String(point.x));
  circle.setAttribute("cy", String(point.y));
}

export function LinkedWorkspaceRoutes({
  phase,
  relationId,
  targetKey,
  layoutVariant,
}) {
  const svgRef = useRef(null);
  const basePathRef = useRef(null);
  const activePathRef = useRef(null);
  const startRef = useRef(null);
  const endRef = useRef(null);
  const motionReduced = useReducedMotion();
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== "hidden");
  const processing = ["submitting", "running"].includes(phase);
  const routeClassName = useMemo(
    () => `linked-route-field is-${phase}${pageVisible ? "" : " is-paused"}`,
    [pageVisible, phase],
  );

  useLayoutEffect(() => {
    const handleVisibility = () => setPageVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useLayoutEffect(() => {
    if (!relationId || !targetKey) return undefined;

    let frame = 0;
    let burstUntil = performance.now() + LAYOUT_TRACKING_MS;
    const svg = svgRef.current;
    const writeGeometry = () => {
      svg?.setAttribute("viewBox", `0 0 ${window.innerWidth} ${window.innerHeight}`);
      const geometry = readRouteGeometry(relationId);
      const visible = Boolean(geometry.visible && geometry.path);
      if (svg) svg.dataset.routeVisible = String(visible);
      if (!visible) return geometry;
      basePathRef.current?.setAttribute("d", geometry.path);
      activePathRef.current?.setAttribute("d", geometry.path);
      setPoint(startRef.current, geometry.start);
      setPoint(endRef.current, geometry.end);
      return geometry;
    };
    const tick = (time) => {
      frame = 0;
      writeGeometry();
      if (time < burstUntil) schedule();
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(tick);
    };
    const extendTracking = () => {
      burstUntil = Math.max(burstUntil, performance.now() + LAYOUT_TRACKING_MS);
      schedule();
    };

    const initial = writeGeometry();
    const observer = new ResizeObserver(schedule);
    for (const element of initial.observed ?? []) observer.observe(element);
    const mutationObserver = new MutationObserver(schedule);
    if (initial.mutationRoot) {
      mutationObserver.observe(initial.mutationRoot, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }

    window.addEventListener("resize", extendTracking, { passive: true });
    document.addEventListener("scroll", schedule, { passive: true, capture: true });
    document.addEventListener("transitionrun", extendTracking, { capture: true });
    document.addEventListener("animationstart", extendTracking, { capture: true });
    schedule();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", extendTracking);
      document.removeEventListener("scroll", schedule, true);
      document.removeEventListener("transitionrun", extendTracking, true);
      document.removeEventListener("animationstart", extendTracking, true);
    };
  }, [layoutVariant, relationId, targetKey]);

  if (!relationId || !targetKey) return null;

  return (
    <svg
      ref={svgRef}
      className={routeClassName}
      data-route-visible="false"
      viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`}
      aria-hidden="true"
      focusable="false"
    >
      <path ref={basePathRef} className="linked-route-base" d="" vectorEffect="non-scaling-stroke" />
      <path
        ref={activePathRef}
        id="linked-active-relation-path"
        className="linked-route-active"
        d=""
        pathLength="1"
        vectorEffect="non-scaling-stroke"
      />
      <circle ref={startRef} className="linked-route-terminal" cx="0" cy="0" r="3" />
      <circle ref={endRef} className="linked-route-terminal" cx="0" cy="0" r="3" />
      {processing && !motionReduced && pageVisible ? (
        <circle className="linked-route-packet" r="2.5">
          <animateMotion
            dur="1.6s"
            repeatCount="indefinite"
            keyPoints="0;1;1"
            keyTimes="0;0.56;1"
            calcMode="linear"
          >
            <mpath href="#linked-active-relation-path" />
          </animateMotion>
        </circle>
      ) : null}
    </svg>
  );
}
