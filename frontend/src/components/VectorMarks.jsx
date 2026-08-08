import { memo } from "react";

function VectorFrame({ className = "", viewBox = "0 0 32 32", children }) {
  return (
    <svg
      className={`vector-mark ${className}`}
      viewBox={viewBox}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function JarvisMark({ className = "" }) {
  return (
    <VectorFrame className={`jarvis-mark ${className}`}>
      <path className="vector-mark__dim" d="M3 11V3h8M21 3h8v8M29 21v8h-8M11 29H3v-8" />
      <path className="vector-mark__grid" d="M7 16h6m6 0h6M16 7v6m0 6v6" />
      <path d="m16 9 7 7-7 7-7-7 7-7Zm-4 7h8" />
      <path className="vector-mark__signal" d="M3 16h4m18 0h4M16 3v4m0 18v4" />
      <rect className="vector-mark__node" x="14" y="14" width="4" height="4" />
      <rect className="vector-mark__point" x="2" y="2" width="2" height="2" />
      <rect className="vector-mark__point" x="28" y="28" width="2" height="2" />
    </VectorFrame>
  );
}

export function AgentGlyph({ className = "", state = "ready" }) {
  return (
    <VectorFrame className={`agent-glyph is-${state} ${className}`}>
      <path className="vector-mark__dim" d="M4 10V4h6M22 4h6v6M28 22v6h-6M10 28H4v-6" />
      <path d="m16 7 9 9-9 9-9-9 9-9Zm0 5 4 4-4 4-4-4 4-4Z" />
      <path className="vector-mark__grid" d="M2 16h7m14 0h7M16 2v7m0 14v7" />
      <path className="vector-mark__signal" d="M7 8h5l4-4 4 4h5M7 24h5l4 4 4-4h5" />
      <rect className="vector-mark__node" x="14" y="14" width="4" height="4" />
      <rect className="vector-mark__point" x="1" y="15" width="2" height="2" />
      <rect className="vector-mark__point" x="29" y="15" width="2" height="2" />
    </VectorFrame>
  );
}

export function CoreNodeGlyph({ className = "", active = false }) {
  return (
    <VectorFrame className={`core-node-glyph ${active ? "is-active" : ""} ${className}`} viewBox="0 0 96 96">
      <path className="vector-mark__dim" d="M8 30V8h22M66 8h22v22M88 66v22H66M30 88H8V66" />
      <path className="vector-mark__grid" d="M12 48h25m22 0h25M48 12v25m0 22v25M20 20l17 17m22 22 17 17M76 20 59 37M37 59 20 76" />
      <path d="m48 21 27 27-27 27-27-27 27-27Zm0 11 16 16-16 16-16-16 16-16Z" />
      <path className="vector-mark__signal" d="M48 4v17M92 48H75M48 92V75M4 48h17" />
      <rect className="vector-mark__node" x="43" y="43" width="10" height="10" />
      <rect className="vector-mark__point" x="6" y="6" width="4" height="4" />
      <rect className="vector-mark__point" x="86" y="26" width="4" height="4" />
      <rect className="vector-mark__point" x="26" y="86" width="4" height="4" />
    </VectorFrame>
  );
}

const knowledgeNodes = [
  [112, 126], [188, 86], [246, 168], [338, 112], [408, 204], [502, 116],
  [582, 178], [674, 92], [748, 156], [862, 112], [914, 232], [808, 288],
  [704, 244], [622, 326], [520, 260], [438, 348], [350, 274], [264, 352],
  [170, 276], [86, 356], [144, 448], [252, 430], [330, 506], [430, 452],
  [516, 532], [610, 438], [708, 512], [786, 414], [890, 486], [934, 380],
];

const knowledgeEdges = [
  [0, 1], [0, 2], [1, 3], [2, 3], [2, 4], [3, 5], [4, 5], [4, 6],
  [5, 6], [5, 7], [6, 8], [7, 8], [7, 9], [8, 10], [8, 11], [10, 11],
  [11, 12], [12, 13], [12, 14], [13, 15], [14, 15], [14, 16], [15, 16],
  [15, 23], [16, 17], [17, 18], [17, 21], [18, 19], [18, 20], [19, 20],
  [20, 21], [21, 22], [21, 23], [22, 23], [22, 24], [23, 24], [23, 25],
  [24, 25], [24, 26], [25, 26], [25, 27], [26, 27], [26, 28], [27, 28],
  [27, 29], [28, 29], [9, 10], [9, 8], [6, 14], [4, 16], [13, 25],
];

const knowledgeNodeKinds = ["document", "entity", "event", "task", "system"];

export const KnowledgeGraphField = memo(function KnowledgeGraphField({ connected = false }) {
  return (
    <svg
      className={`knowledge-graph-field ${connected ? "is-connected" : "is-disconnected"}`}
      viewBox="0 0 1000 620"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <g className="knowledge-graph-field__grid">
        <path d="M80 110h840M80 310h840M80 510h840M180 68v484M500 52v516M820 68v484" />
      </g>
      <g className="knowledge-graph-field__datum">
        <path d="M50 76h132M818 76h132M50 544h132M818 544h132" />
        <path d="M50 76v52M950 76v52M50 492v52M950 492v52" />
        <path d="M178 310 292 156 500 108 708 156 822 310 708 464 500 512 292 464 178 310Z" />
      </g>
      <g className="knowledge-graph-field__clusters">
        <path d="M72 104 330 66 444 174 352 302 98 276Z" />
        <path d="M394 116 680 66 832 184 704 324 446 268Z" />
        <path d="M94 332 360 264 520 420 336 552 84 482Z" />
        <path d="M508 324 820 246 946 396 824 548 560 526Z" />
      </g>
      <g className="knowledge-graph-field__edges">
        {knowledgeEdges.map(([from, to]) => (
          <line
            key={`${from}-${to}`}
            x1={knowledgeNodes[from][0]}
            y1={knowledgeNodes[from][1]}
            x2={knowledgeNodes[to][0]}
            y2={knowledgeNodes[to][1]}
          />
        ))}
      </g>
      <g className="knowledge-graph-field__routes">
        <path d="M86 356 170 276 264 352 350 274 438 348 520 260 622 326 704 244 808 288 914 232" />
        <path d="M144 448 252 430 330 506 430 452 516 532 610 438 708 512 786 414 890 486" />
      </g>
      {connected ? (
        <>
          <g className="knowledge-graph-field__signal-halo">
            <path d="M112 126 246 168 408 204 520 260 622 326 786 414 934 380" />
            <path d="M188 86 338 112 502 116 674 92 862 112 914 232" />
          </g>
          <g className="knowledge-graph-field__signal">
            <path d="M112 126 246 168 408 204 520 260 622 326 786 414 934 380" />
            <path d="M188 86 338 112 502 116 674 92 862 112 914 232" />
          </g>
        </>
      ) : null}
      <g className="knowledge-graph-field__focus">
        <path d="M458 310h30m24 0h58M500 268v30m0 24v30" />
        <rect x="494" y="304" width="12" height="12" />
        <text x="520" y="305">{connected ? "LOCAL INDEX" : "SOURCE DISCONNECTED"}</text>
        <text className="is-muted" x="520" y="322">{connected ? "VERIFIED RELATIONS" : "STRUCTURE PREVIEW"}</text>
      </g>
      <g className="knowledge-graph-field__nodes">
        {knowledgeNodes.map(([x, y], index) => (
          <rect
            key={`${x}-${y}`}
            className={`${connected && index % 7 === 0 ? "is-hot " : ""}is-${knowledgeNodeKinds[index % knowledgeNodeKinds.length]}`}
            x={x - (index % 7 === 0 ? 2.5 : 1.5)}
            y={y - (index % 7 === 0 ? 2.5 : 1.5)}
            width={index % 7 === 0 ? 5 : 3}
            height={index % 7 === 0 ? 5 : 3}
          />
        ))}
      </g>
      <g className="knowledge-graph-field__labels">
        <text x="62" y="66">JARVIS // LOCAL KNOWLEDGE GRAPH</text>
        <text x="112" y="96">DOCUMENTS</text>
        <text x="690" y="96">ENTITIES</text>
        <text x="108" y="520">EVENTS / TASKS</text>
        <text x="790" y="520">SYSTEM / ARCHIVE</text>
      </g>
    </svg>
  );
});
