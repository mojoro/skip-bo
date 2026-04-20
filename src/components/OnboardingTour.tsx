'use client';

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

// Hand-rolled tour. Two reasons: (1) one more npm dep is one more thing to
// audit, and (2) the only tricky bits — spotlight cutout + tooltip placement
// near a moving target — are a few dozen lines of SVG + rect math.

const STORAGE_KEY = 'skipbo.tour.v1';

export function hasSeenTour(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'done';
  } catch {
    return true;
  }
}

function markTourSeen() {
  try {
    window.localStorage.setItem(STORAGE_KEY, 'done');
  } catch {
    // localStorage disabled (private mode) — silently give up.
  }
}

type Placement = 'top' | 'bottom' | 'left' | 'right' | 'center' | 'auto';

interface TourStep {
  selector: string | null; // null = centered step with no spotlight
  title: string;
  body: string;
  placement?: Placement;
}

function buildSteps(isDesktop: boolean): TourStep[] {
  const statusTarget = isDesktop ? '[data-tour="status-desktop"]' : '[data-tour="status-mobile"]';
  return [
    {
      selector: null,
      placement: 'center',
      title: 'Welcome to Skip-Bo',
      body: 'Skip-Bo is a sequential-numbers card race. Your goal is to empty your stock pile before anyone else does.',
    },
    {
      selector: '[data-tour="stock"]',
      placement: 'auto',
      title: 'Your stock pile',
      body: 'This is what you are racing to empty. The top card is visible — play it onto a build pile whenever you can. First to zero wins.',
    },
    {
      selector: '[data-tour="hand"]',
      placement: 'auto',
      title: 'Your hand',
      body: 'Up to five cards. They refill automatically at the start of your turn. Play as many as you can before you end the turn.',
    },
    {
      selector: '[data-tour="build"]',
      placement: isDesktop ? 'bottom' : 'top',
      title: 'Build piles',
      body: 'Shared by everyone. Start a pile with a 1 or a Skip-Bo (wild), then stack 2, 3, 4 … up to 12. Completed piles clear and play continues.',
    },
    {
      selector: '[data-tour="discard"]',
      placement: 'top',
      title: 'Your discard piles',
      body: 'Four personal piles. End your turn by discarding one card here. On future turns the top of each pile is playable, so discard strategically.',
    },
    {
      selector: statusTarget,
      placement: 'auto',
      title: 'Turn indicator',
      body: 'Shows whose turn it is. When it says "Your turn", drag cards or tap to select, then tap a build or discard pile.',
    },
    {
      selector: null,
      placement: 'center',
      title: 'You are ready',
      body: 'That is the short version. Hit "Rules" in the header any time for the full rulebook, or "Tour" to replay this walkthrough.',
    },
  ];
}

const SPOTLIGHT_PADDING = 8;
const TOOLTIP_GAP = 14;
const TOOLTIP_WIDTH = 320;
const TOOLTIP_WIDTH_MOBILE = 280;
const VIEWPORT_MARGIN = 12;

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function readRect(selector: string | null): TargetRect | null {
  if (!selector || typeof document === 'undefined') return null;
  // querySelectorAll lets us skip display:none clones on opposite breakpoints.
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector));
  const visible = candidates.find((el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  if (!visible) return null;
  const rect = visible.getBoundingClientRect();
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

function pickPlacement(
  rect: TargetRect,
  viewport: { width: number; height: number },
  tooltipHeight: number,
  preferred: Placement,
): Exclude<Placement, 'auto' | 'center'> {
  if (preferred === 'top' || preferred === 'bottom' || preferred === 'left' || preferred === 'right') {
    return preferred;
  }
  // 'auto' — pick the side with the most space.
  const spaceBelow = viewport.height - (rect.top + rect.height);
  const spaceAbove = rect.top;
  if (spaceBelow >= tooltipHeight + TOOLTIP_GAP + VIEWPORT_MARGIN) return 'bottom';
  if (spaceAbove >= tooltipHeight + TOOLTIP_GAP + VIEWPORT_MARGIN) return 'top';
  return spaceBelow >= spaceAbove ? 'bottom' : 'top';
}

function computeTooltipStyle(
  rect: TargetRect | null,
  tooltipSize: { width: number; height: number },
  viewport: { width: number; height: number },
  placement: Placement,
): CSSProperties {
  // No target → center of viewport.
  if (!rect) {
    return {
      left: Math.max(VIEWPORT_MARGIN, (viewport.width - tooltipSize.width) / 2),
      top: Math.max(VIEWPORT_MARGIN, (viewport.height - tooltipSize.height) / 2),
    };
  }

  const side = pickPlacement(rect, viewport, tooltipSize.height, placement);

  let top: number;
  let left: number;
  if (side === 'bottom') {
    top = rect.top + rect.height + TOOLTIP_GAP;
    left = rect.left + rect.width / 2 - tooltipSize.width / 2;
  } else if (side === 'top') {
    top = rect.top - tooltipSize.height - TOOLTIP_GAP;
    left = rect.left + rect.width / 2 - tooltipSize.width / 2;
  } else if (side === 'right') {
    top = rect.top + rect.height / 2 - tooltipSize.height / 2;
    left = rect.left + rect.width + TOOLTIP_GAP;
  } else {
    top = rect.top + rect.height / 2 - tooltipSize.height / 2;
    left = rect.left - tooltipSize.width - TOOLTIP_GAP;
  }

  // Keep the tooltip on-screen.
  left = Math.min(Math.max(VIEWPORT_MARGIN, left), viewport.width - tooltipSize.width - VIEWPORT_MARGIN);
  top = Math.min(Math.max(VIEWPORT_MARGIN, top), viewport.height - tooltipSize.height - VIEWPORT_MARGIN);

  return { left, top };
}

export interface OnboardingTourProps {
  run: boolean;
  onClose: () => void;
}

export default function OnboardingTour({ run, onClose }: OnboardingTourProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true,
  );
  const [rect, setRect] = useState<TargetRect | null>(null);
  const [viewport, setViewport] = useState<{ width: number; height: number }>(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
  }));
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [tooltipSize, setTooltipSize] = useState<{ width: number; height: number }>({
    width: TOOLTIP_WIDTH,
    height: 200,
  });

  const steps = useMemo(() => buildSteps(isDesktop), [isDesktop]);
  const currentStep = steps[stepIndex] ?? null;

  // Reset to first step every time the tour transitions to open. Using the
  // "reset state during render" pattern from the React docs (tracked with
  // useState, not useRef — the compiler flags ref mutation during render).
  const [prevRun, setPrevRun] = useState(run);
  if (prevRun !== run) {
    setPrevRun(run);
    if (run) setStepIndex(0);
  }

  // Track breakpoint.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(min-width: 768px)');
    const update = () => setIsDesktop(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  // Track viewport size.
  useEffect(() => {
    if (typeof window === 'undefined' || !run) return;
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [run]);

  // Measure target rect every frame while the step is active — the UI can
  // reflow (status bar text changes width, keyboard opens, etc.) and we want
  // the spotlight to track.
  useLayoutEffect(() => {
    if (!run || !currentStep) return;
    let raf = 0;
    const tick = () => {
      setRect(readRect(currentStep.selector));
      raf = window.requestAnimationFrame(tick);
    };
    tick();
    return () => window.cancelAnimationFrame(raf);
  }, [run, currentStep]);

  // Measure tooltip size for placement math.
  useLayoutEffect(() => {
    if (!run || !tooltipRef.current) return;
    const node = tooltipRef.current;
    const measure = () => {
      setTooltipSize({ width: node.offsetWidth, height: node.offsetHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [run, stepIndex]);

  const handleFinish = () => {
    markTourSeen();
    onClose();
  };

  const handleNext = () => {
    if (stepIndex >= steps.length - 1) {
      handleFinish();
      return;
    }
    setStepIndex((i) => i + 1);
  };

  const handleBack = () => {
    setStepIndex((i) => Math.max(0, i - 1));
  };

  // Keyboard shortcuts: ESC to close, ← / → to navigate, Enter to advance.
  // Inlined so the effect captures the latest stepIndex without extra deps.
  useEffect(() => {
    if (!run) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        markTourSeen();
        onClose();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        setStepIndex((i) => {
          if (i >= steps.length - 1) {
            markTourSeen();
            onClose();
            return i;
          }
          return i + 1;
        });
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setStepIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run, steps.length, onClose]);

  if (!run || !currentStep) return null;

  const tooltipWidth = viewport.width < 640 ? TOOLTIP_WIDTH_MOBILE : TOOLTIP_WIDTH;
  const tooltipStyle = computeTooltipStyle(rect, tooltipSize, viewport, currentStep.placement ?? 'auto');

  const hasSpotlight = !!rect;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  return (
    <div
      className="fixed inset-0 z-[10000]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
    >
      {/* Dark overlay with a spotlight cutout for the current target. The SVG
          mask approach is simpler than four rectangles and handles rounded
          corners cleanly. */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-auto"
        onClick={handleNext}
        aria-hidden="true"
      >
        <defs>
          <mask id="tour-spotlight-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {hasSpotlight && rect && (
              <rect
                x={rect.left - SPOTLIGHT_PADDING}
                y={rect.top - SPOTLIGHT_PADDING}
                width={rect.width + SPOTLIGHT_PADDING * 2}
                height={rect.height + SPOTLIGHT_PADDING * 2}
                rx="10"
                ry="10"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.68)"
          mask="url(#tour-spotlight-mask)"
        />
        {/* Gold highlight ring around the spotlight for emphasis. */}
        {hasSpotlight && rect && (
          <rect
            x={rect.left - SPOTLIGHT_PADDING}
            y={rect.top - SPOTLIGHT_PADDING}
            width={rect.width + SPOTLIGHT_PADDING * 2}
            height={rect.height + SPOTLIGHT_PADDING * 2}
            rx="10"
            ry="10"
            fill="none"
            stroke="rgba(217, 164, 65, 0.65)"
            strokeWidth="2"
            pointerEvents="none"
          />
        )}
      </svg>

      {/* Tooltip card. Positioned absolutely in viewport coordinates. */}
      <div
        ref={tooltipRef}
        className="absolute rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.6)] border"
        style={{
          ...tooltipStyle,
          width: tooltipWidth,
          borderColor: 'rgba(217, 164, 65, 0.35)',
          background: '#1f3d2a',
          color: '#f5f0e1',
          padding: '18px 20px',
          transition: 'left 180ms ease, top 180ms ease',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="tour-title"
          className="text-[15px] font-bold tracking-widest uppercase mb-1.5"
          style={{ color: '#d9a441' }}
        >
          {currentStep.title}
        </h2>
        <p className="text-[14px] leading-relaxed" style={{ color: '#f5f0e1' }}>
          {currentStep.body}
        </p>

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={handleFinish}
            className="text-[12px] underline underline-offset-2"
            style={{ color: 'rgba(245, 240, 225, 0.6)' }}
          >
            Skip
          </button>
          <div className="flex items-center gap-2">
            <span
              className="text-[11px] tracking-wider"
              style={{ color: 'rgba(245, 240, 225, 0.5)' }}
              aria-live="polite"
            >
              {stepIndex + 1} / {steps.length}
            </span>
            {!isFirst && (
              <button
                type="button"
                onClick={handleBack}
                className="text-[13px] px-3 py-1 rounded border"
                style={{
                  color: '#f5f0e1',
                  borderColor: 'rgba(245, 240, 225, 0.25)',
                  background: 'transparent',
                }}
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={handleNext}
              className="text-[13px] font-bold px-3 py-1 rounded"
              style={{ background: '#d9a441', color: '#1a1a1a' }}
            >
              {isLast ? 'Got it' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
