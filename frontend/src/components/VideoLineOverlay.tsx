import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

export type LineSeg = { x1: number; y1: number; x2: number; y2: number };

/** Coordenadas no espaco do frame de inferencia (nao no JPEG redimensionado no browser). */
function pointerEventToFrame(
  ev: { clientX: number; clientY: number },
  img: HTMLImageElement,
  infW: number,
  infH: number
): [number, number] {
  const r = img.getBoundingClientRect();
  let x = Math.round(((ev.clientX - r.left) / r.width) * infW);
  let y = Math.round(((ev.clientY - r.top) / r.height) * infH);
  x = Math.max(0, Math.min(infW - 1, x));
  y = Math.max(0, Math.min(infH - 1, y));
  return [x, y];
}

function frameToDisplay(
  fx: number,
  fy: number,
  infW: number,
  infH: number,
  dw: number,
  dh: number
): { x: number; y: number } {
  return {
    x: (fx / infW) * dw,
    y: (fy / infH) * dh,
  };
}

function lineEqual(a: LineSeg, b: LineSeg): boolean {
  return (
    a.x1 === b.x1 &&
    a.y1 === b.y1 &&
    a.x2 === b.x2 &&
    a.y2 === b.y2
  );
}

type Props = {
  active: boolean;
  line: LineSeg;
  imgRef: RefObject<HTMLImageElement | null>;
  onCommit: (line: LineSeg) => void;
  disabled?: boolean;
  /** Se definido, mapeia pontos para o display; caso contrario usa naturalWidth/Height do img (legado). */
  inferenceSize: { w: number; h: number } | null;
};

export function VideoLineOverlay({
  active,
  line,
  imgRef,
  onCommit,
  disabled,
  inferenceSize,
}: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [draft, setDraft] = useState<LineSeg>(line);
  const [dragging, setDragging] = useState<"p1" | "p2" | null>(null);
  const dragStartRef = useRef<LineSeg | null>(null);
  const draftRef = useRef<LineSeg>(line);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (!dragging) {
      setDraft(line);
      draftRef.current = line;
    }
  }, [line, dragging]);

  const measure = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    setSize({ w: img.clientWidth, h: img.clientHeight });
  }, [imgRef]);

  useEffect(() => {
    measure();
    const img = imgRef.current;
    if (!img) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(img);
    return () => ro.disconnect();
  }, [imgRef, measure, active]);

  useEffect(() => {
    if (!dragging || disabled) return;
    const onMove = (e: PointerEvent) => {
      const img = imgRef.current;
      if (!img) return;
      const nw = img.naturalWidth || img.width || 1;
      const nh = img.naturalHeight || img.height || 1;
      const infW = inferenceSize?.w && inferenceSize.w > 0 ? inferenceSize.w : nw;
      const infH = inferenceSize?.h && inferenceSize.h > 0 ? inferenceSize.h : nh;
      const [fx, fy] = pointerEventToFrame(e, img, infW, infH);
      setDraft((prev) => {
        const next =
          dragging === "p1"
            ? { ...prev, x1: fx, y1: fy }
            : { ...prev, x2: fx, y2: fy };
        draftRef.current = next;
        return next;
      });
    };
    const onUp = () => {
      const start = dragStartRef.current;
      const end = draftRef.current;
      setDragging(null);
      dragStartRef.current = null;
      if (start && !lineEqual(start, end)) {
        onCommit(end);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, disabled, imgRef, onCommit, inferenceSize]);

  const startDrag =
    (which: "p1" | "p2") => (e: React.PointerEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      dragStartRef.current = { ...draftRef.current };
      setDragging(which);
    };

  if (!active || size.w < 8 || size.h < 8) return null;

  const img = imgRef.current;
  const nw = img?.naturalWidth || img?.width || 1;
  const nh = img?.naturalHeight || img?.height || 1;
  const infW = inferenceSize?.w && inferenceSize.w > 0 ? inferenceSize.w : nw;
  const infH = inferenceSize?.h && inferenceSize.h > 0 ? inferenceSize.h : nh;

  const p1 = frameToDisplay(draft.x1, draft.y1, infW, infH, size.w, size.h);
  const p2 = frameToDisplay(draft.x2, draft.y2, infW, infH, size.w, size.h);

  return (
    <svg
      className="pointer-events-auto absolute left-0 top-0 z-10 select-none"
      width={size.w}
      height={size.h}
      style={{ cursor: dragging ? "grabbing" : "default" }}
      aria-hidden
    >
      <line
        x1={p1.x}
        y1={p1.y}
        x2={p2.x}
        y2={p2.y}
        stroke="#f87171"
        strokeWidth={2.5}
        strokeLinecap="round"
        pointerEvents="none"
      />
      <circle
        cx={p1.x}
        cy={p1.y}
        r={11}
        fill="rgba(15,23,42,0.88)"
        stroke="#facc15"
        strokeWidth={2}
        className="touch-none"
        style={{ cursor: dragging === "p1" ? "grabbing" : "grab" }}
        onPointerDown={startDrag("p1")}
      />
      <circle
        cx={p2.x}
        cy={p2.y}
        r={11}
        fill="rgba(15,23,42,0.88)"
        stroke="#facc15"
        strokeWidth={2}
        className="touch-none"
        style={{ cursor: dragging === "p2" ? "grabbing" : "grab" }}
        onPointerDown={startDrag("p2")}
      />
    </svg>
  );
}
