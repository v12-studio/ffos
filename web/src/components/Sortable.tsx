import { GripVertical } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

interface Drag {
  from: number;
  to: number;
  startY: number;
  startScroll: number;
  pointerY: number;
  tops: number[];
  heights: number[];
}

/** Props for the element that starts a drag (the grip). */
export interface HandleProps {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

/**
 * A vertical list whose items are reordered by dragging their grip, with touch, mouse or pen.
 * The grip blocks page scrolling while held; holding near the top or bottom of the screen scrolls.
 * Arrow keys on a focused grip move the item one place, for keyboards and switch access.
 */
export function SortableList<T>({
  items,
  keyOf,
  onMove,
  renderItem,
  className = '',
}: {
  items: T[];
  keyOf: (item: T) => string;
  onMove: (from: number, to: number) => void;
  renderItem: (item: T, handle: HandleProps, dragging: boolean) => ReactNode;
  className?: string;
}) {
  const nodes = useRef<(HTMLDivElement | null)[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  const targetIndex = (d: Drag, scrollY: number) => {
    const dy = d.pointerY - d.startY + (scrollY - d.startScroll);
    const center = d.tops[d.from]! + d.heights[d.from]! / 2 + dy;
    let to = 0;
    d.tops.forEach((top, i) => {
      if (i !== d.from && top + d.heights[i]! / 2 < center) to++;
    });
    return to;
  };

  const update = (patch: Partial<Drag>) => {
    const d = dragRef.current;
    if (!d) return;
    const next = { ...d, ...patch };
    next.to = targetIndex(next, window.scrollY);
    setDrag(next);
  };

  // Scroll while the item is held near the top or bottom edge (the tab bar or save bar covers the bottom).
  useEffect(() => {
    if (!drag) return;
    let frame = 0;
    const tick = () => {
      const d = dragRef.current;
      if (d) {
        const edge = d.pointerY < 96 ? -1 : d.pointerY > window.innerHeight - 150 ? 1 : 0;
        if (edge) {
          window.scrollBy(0, edge * 8);
          update({});
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [drag !== null]);

  const handleFor = (index: number): HandleProps => ({
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const rects = nodes.current.slice(0, items.length).map((n) => n?.getBoundingClientRect());
      navigator.vibrate?.(8);
      setDrag({
        from: index,
        to: index,
        startY: e.clientY,
        startScroll: window.scrollY,
        pointerY: e.clientY,
        tops: rects.map((r) => (r?.top ?? 0) + window.scrollY),
        heights: rects.map((r) => r?.height ?? 0),
      });
    },
    onPointerMove: (e) => {
      if (dragRef.current) update({ pointerY: e.clientY });
    },
    onPointerUp: () => {
      const d = dragRef.current;
      setDrag(null);
      if (d && d.to !== d.from) onMove(d.from, d.to);
    },
    onPointerCancel: () => setDrag(null),
    onKeyDown: (e) => {
      if (e.key === 'ArrowUp' && index > 0) {
        e.preventDefault();
        onMove(index, index - 1);
      } else if (e.key === 'ArrowDown' && index < items.length - 1) {
        e.preventDefault();
        onMove(index, index + 1);
      }
    },
  });

  const offset = (i: number): number => {
    if (!drag) return 0;
    if (i === drag.from) return drag.pointerY - drag.startY + (window.scrollY - drag.startScroll);
    const h = drag.heights[drag.from]!;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -h;
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return h;
    return 0;
  };

  return (
    <div className={className}>
      {items.map((item, i) => {
        const dragging = drag?.from === i;
        return (
          <div
            key={keyOf(item)}
            ref={(n) => {
              nodes.current[i] = n;
            }}
            className={`${dragging ? 'relative z-10 bg-surface shadow-lg ring-1 ring-line' : drag ? 'transition-transform duration-150' : ''}`}
            style={{ transform: drag ? `translateY(${offset(i)}px)` : undefined }}
          >
            {renderItem(item, handleFor(i), dragging)}
          </div>
        );
      })}
    </div>
  );
}

/** The grip a person holds to drag a row. */
export function DragHandle({ handle, label }: { handle: HandleProps; label: string }) {
  return (
    <button
      type="button"
      {...handle}
      aria-label={`${label}. Drag, or use the arrow keys, to reorder`}
      className="-ml-2 grid size-10 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-muted hover:bg-subtle active:cursor-grabbing"
    >
      <GripVertical className="size-4.5" />
    </button>
  );
}

/** Returns a copy of `list` with the item at `from` moved to `to`. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
