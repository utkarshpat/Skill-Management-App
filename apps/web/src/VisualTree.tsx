import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Building2, Users, Pencil, UserRound } from 'lucide-react';

export interface TreeItem {
  id: string;
  label: string;
  detail: string;
  children: string[];
  person?: boolean;
}
interface Props {
  items: TreeItem[];
  roots: string[];
  selected?: string;
  fitOnSearch?: string;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
}
const width = 190,
  height = 78,
  xGap = 65,
  yGap = 22;
const padding = 24;
const maximumZoom = 1.5;
const initialCamera = { x: padding, y: padding, zoom: 1 };
type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Camera = Point & { zoom: number };

function fitZoom(view: Size, diagram: Size) {
  return Math.min(
    1,
    (view.width - 2 * padding) / diagram.width,
    (view.height - 2 * padding) / diagram.height,
  );
}

function constrain(camera: Camera, view: Size, diagram: Size) {
  const constrainAxis = (offset: number, visible: number, content: number) => {
    const overlap = Math.min(padding, content, visible);
    return Math.min(visible - overlap, Math.max(overlap - content, offset));
  };
  return {
    ...camera,
    x: constrainAxis(camera.x, view.width, diagram.width * camera.zoom),
    y: constrainAxis(camera.y, view.height, diagram.height * camera.zoom),
  };
}

function transformCamera(
  camera: Camera,
  view: Size,
  diagram: Size,
  from: Point,
  to: Point,
  factor: number,
) {
  const minZoom = Math.max(0.001, Math.min(0.25, fitZoom(view, diagram)));
  const zoom = Math.min(maximumZoom, Math.max(minZoom, camera.zoom * factor));
  const ratio = zoom / camera.zoom;
  return constrain(
    { x: to.x + (camera.x - from.x) * ratio, y: to.y + (camera.y - from.y) * ratio, zoom },
    view,
    diagram,
  );
}

function viewSize(element: HTMLDivElement): Size {
  return { width: element.clientWidth, height: element.clientHeight };
}

export function VisualTree({ items, roots, selected, onSelect, onEdit, fitOnSearch }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<Size>();
  const [camera, setCamera] = useState(initialCamera);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef({ points: new Map<number, Point>(), active: false });
  const lastSearch = useRef('');
  const diagram = useMemo(() => {
    const lookup = new Map(items.map(item => [item.id, item]));
    const seen = new Set<string>();
    let row = 0;
    const positions: { item: TreeItem; x: number; y: number }[] = [];
    const edges: { from: string; to: string }[] = [];
    function visit(id: string, depth: number): number | undefined {
      const item = lookup.get(id);
      if (!item || seen.has(id) || depth > 200) return undefined;
      seen.add(id);
      const children: number[] = [];
      for (const child of item.children) {
        const y = visit(child, depth + 1);
        if (y !== undefined) {
          children.push(y);
          edges.push({ from: id, to: child });
        }
      }
      const y = children.length ? (children[0] + children.at(-1)!) / 2 : row++ * (height + yGap);
      positions.push({ item, x: depth * (width + xGap), y });
      return y;
    }
    for (const root of roots) {
      visit(root, 0);
      row++;
    }
    return {
      positions,
      edges,
      byId: new Map(positions.map(node => [node.item.id, node])),
      width: Math.max(width, ...positions.map(node => node.x + width)),
      height: Math.max(height, ...positions.map(node => node.y + height)),
    };
  }, [items, roots]);

  useEffect(() => {
    const element = viewport.current!;
    const measure = () => {
      const size = viewSize(element);
      if (!size.width || !size.height) return;
      setView(size);
      setCamera(current => constrain(current, size, diagram));
    };
    measure();
    const observer = new window.ResizeObserver(measure);
    observer.observe(element);
    const wheel = (event: WheelEvent) => {
      if (!diagram.positions.length || !event.deltaY) return;
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      const anchor = {
        x: event.clientX - bounds.left - element.clientLeft,
        y: event.clientY - bounds.top - element.clientTop,
      };
      const factor = Math.exp(
        -Math.sign(event.deltaY) *
          Math.min(Math.abs(event.deltaY) * (event.deltaMode === 0 ? 0.002 : 0.08), 0.3),
      );
      const view = viewSize(element);
      setCamera(current => transformCamera(current, view, diagram, anchor, anchor, factor));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', wheel);
    };
  }, [diagram]);

  function zoomBy(delta: number) {
    const view = viewSize(viewport.current!);
    setCamera(current => {
      const anchor = {
        x: Math.min(current.x + diagram.width * current.zoom, Math.max(current.x, view.width / 2)),
        y: Math.min(
          current.y + diagram.height * current.zoom,
          Math.max(current.y, view.height / 2),
        ),
      };
      return transformCamera(
        current,
        view,
        diagram,
        anchor,
        anchor,
        (current.zoom + delta) / current.zoom,
      );
    });
  }

  function fit() {
    const view = viewSize(viewport.current!);
    setView(view);
    const zoom = Math.max(0.001, fitZoom(view, diagram));
    setCamera({
      x: (view.width - diagram.width * zoom) / 2,
      y: (view.height - diagram.height * zoom) / 2,
      zoom,
    });
  }

  useEffect(() => {
    if (lastSearch.current === (fitOnSearch ?? '')) return;
    lastSearch.current = fitOnSearch ?? '';
    if (fitOnSearch) fit();
    else setCamera(initialCamera);
  }, [fitOnSearch, diagram]);

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const { points, active } = gesture.current;
    const before = points.get(event.pointerId);
    if (!before) return;
    const after = { x: event.clientX, y: event.clientY };
    if (!active && points.size === 1 && Math.hypot(after.x - before.x, after.y - before.y) < 5)
      return;

    const element = event.currentTarget;
    if (!active) {
      for (const id of points.keys()) element.setPointerCapture(id);
      gesture.current.active = true;
      setDragging(true);
    }
    const other = [...points].find(([id]) => id !== event.pointerId)?.[1];
    points.set(event.pointerId, after);
    const view = viewSize(element);
    const bounds = element.getBoundingClientRect();
    const anchor = (point: Point) => ({
      x: (other ? (point.x + other.x) / 2 : point.x) - bounds.left - element.clientLeft,
      y: (other ? (point.y + other.y) / 2 : point.y) - bounds.top - element.clientTop,
    });
    const factor = other
      ? Math.hypot(after.x - other.x, after.y - other.y) /
        Math.max(1, Math.hypot(before.x - other.x, before.y - other.y))
      : 1;
    const from = anchor(before),
      to = anchor(after);
    setCamera(current => transformCamera(current, view, diagram, from, to, factor));
  }

  function pointerEnd(event: PointerEvent<HTMLDivElement>) {
    // Touch may transfer implicit capture from a node button to the viewport.
    if (event.type === 'lostpointercapture' && event.target !== event.currentTarget) return;
    const current = gesture.current;
    current.points.delete(event.pointerId);
    if (current.points.size === 0) {
      current.active = false;
      setDragging(false);
    }
  }

  const branches = useMemo(
    () => (
      <>
        <svg width={diagram.width} height={diagram.height} aria-hidden="true">
          {diagram.edges.map(edge => {
            const from = diagram.byId.get(edge.from)!,
              to = diagram.byId.get(edge.to)!;
            const x1 = from.x + width,
              y1 = from.y + height / 2,
              x2 = to.x,
              y2 = to.y + height / 2,
              middle = x1 + xGap / 2;
            return (
              <path
                key={edge.from + edge.to}
                d={`M ${x1} ${y1} H ${middle} V ${y2} H ${x2}`}
                fill="none"
                stroke="#c9ced7"
                strokeWidth="1.5"
              />
            );
          })}
        </svg>
        {diagram.positions.map(({ item, x, y }) => {
          const Icon = item.person ? UserRound : item.children.length ? Building2 : Users;
          return (
            <div
              key={item.id}
              className={`visual-node ${selected === item.id ? 'selected' : ''}`}
              style={{ left: x, top: y, width, height }}
            >
              <button
                className="visual-node-select"
                onClick={() => onSelect(item.id)}
                aria-pressed={selected === item.id}
              >
                <Icon size={18} aria-hidden="true" />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
              </button>
              {selected === item.id && (
                <button
                  className="visual-node-edit"
                  aria-label={`${item.person ? 'Edit roles for' : 'Edit'} ${item.label}`}
                  onClick={() => onEdit(item.id)}
                >
                  <Pencil size={13} />
                  {item.person ? 'Edit roles' : 'Edit'}
                </button>
              )}
            </div>
          );
        })}
      </>
    ),
    [diagram, selected, onSelect, onEdit],
  );

  const empty = diagram.positions.length === 0;
  const minZoom = view ? Math.max(0.001, Math.min(0.25, fitZoom(view, diagram))) : 0.25;
  return (
    <>
      <div className="tree-zoom-controls" role="group" aria-label="Tree zoom">
        <button
          type="button"
          onClick={() => zoomBy(-0.25)}
          disabled={empty || camera.zoom <= minZoom}
          aria-label="Zoom out tree"
        >
          −
        </button>
        <span data-testid="tree-zoom">{Math.max(1, Math.round(camera.zoom * 100))}%</span>
        <button
          type="button"
          onClick={() => zoomBy(0.25)}
          disabled={empty || camera.zoom >= maximumZoom}
          aria-label="Zoom in tree"
        >
          +
        </button>
        <button type="button" onClick={fit} disabled={empty}>
          Fit tree
        </button>
        <button type="button" onClick={() => setCamera(initialCamera)} disabled={empty}>
          Reset
        </button>
      </div>
      <div
        ref={viewport}
        className={`visual-tree-scroll${empty ? ' is-empty' : ''}${dragging ? ' is-dragging' : ''}`}
        role="region"
        tabIndex={0}
        aria-label="Visual tree"
        aria-description="Drag to move. Use the wheel, pinch, or plus and minus to zoom. Arrow keys move the tree."
        onPointerDown={event => {
          const current = gesture.current;
          if (empty || event.button !== 0 || current.points.size >= 2) return;
          current.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (current.active) event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerCancel={pointerEnd}
        onLostPointerCapture={pointerEnd}
        onPointerLeave={event => {
          if (!gesture.current.active && event.pointerType === 'mouse') pointerEnd(event);
        }}
        onKeyDown={event => {
          if (
            empty ||
            event.target !== event.currentTarget ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey
          )
            return;
          const direction = {
            ArrowLeft: [1, 0],
            ArrowRight: [-1, 0],
            ArrowUp: [0, 1],
            ArrowDown: [0, -1],
          }[event.key];
          if (direction) {
            event.preventDefault();
            const [x, y] = direction;
            const size = viewSize(event.currentTarget);
            setCamera(current =>
              constrain(
                { ...current, x: current.x + x * 48, y: current.y + y * 48 },
                size,
                diagram,
              ),
            );
          } else if (event.key === '+' || event.key === '=' || event.key === '-') {
            event.preventDefault();
            zoomBy(event.key === '-' ? -0.25 : 0.25);
          }
        }}
        onFocus={event => {
          if (event.target === event.currentTarget || !event.target.matches(':focus-visible'))
            return;
          const element = event.currentTarget;
          const viewBounds = element.getBoundingClientRect();
          const bounds = event.target.getBoundingClientRect();
          const reveal = (start: number, end: number, min: number, max: number) =>
            start < min + 4 ? min + 4 - start : Math.min(0, max - 4 - end);
          const x = reveal(bounds.left, bounds.right, viewBounds.left, viewBounds.right);
          const y = reveal(bounds.top, bounds.bottom, viewBounds.top, viewBounds.bottom);
          if (x || y) setCamera(current => ({ ...current, x: current.x + x, y: current.y + y }));
        }}
      >
        {empty ? (
          <p>No matching nodes.</p>
        ) : (
          <div
            className="visual-tree-canvas"
            style={{
              width: diagram.width,
              height: diagram.height,
              transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
            }}
          >
            {branches}
          </div>
        )}
      </div>
    </>
  );
}
