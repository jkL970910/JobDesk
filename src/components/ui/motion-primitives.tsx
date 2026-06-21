"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

type MotionPanelProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
};

export function MotionPanel({ children, className = "", delay = 0 }: MotionPanelProps) {
  return (
    <div
      className={["motion-panel", className].filter(Boolean).join(" ")}
      style={{ "--motion-delay": `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}

type FocusGlowCardProps = {
  children: ReactNode;
  className?: string;
  active?: boolean;
};

export function FocusGlowCard({ active = true, children, className = "" }: FocusGlowCardProps) {
  return (
    <div className={["focus-glow-card", className].filter(Boolean).join(" ")} data-active={active}>
      {children}
    </div>
  );
}

type CountUpMetricProps = {
  value: number;
  suffix?: string;
  prefix?: string;
  durationMs?: number;
  className?: string;
};

export function CountUpMetric({
  className = "",
  durationMs = 700,
  prefix = "",
  suffix = "",
  value,
}: CountUpMetricProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [displayValue, setDisplayValue] = useState(value);
  const previousValue = useRef(value);
  const displayValueRef = useRef(value);

  useEffect(() => {
    if (prefersReducedMotion) {
      setDisplayValue(value);
      displayValueRef.current = value;
      previousValue.current = value;
      return;
    }
    const from = displayValueRef.current;
    const delta = value - from;
    if (delta === 0) return;
    const startedAt = performance.now();
    let frame = 0;
    function tick(now: number) {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextValue = Math.round(from + delta * eased);
      displayValueRef.current = nextValue;
      setDisplayValue(nextValue);
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick);
      } else {
        previousValue.current = value;
      }
    }
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [durationMs, prefersReducedMotion, value]);

  return (
    <span className={["count-up-metric", className].filter(Boolean).join(" ")}>
      {prefix}
      {displayValue}
      {suffix}
    </span>
  );
}

type AnimatedQueueListProps<T> = {
  items: T[];
  children: (item: T, index: number) => ReactNode;
  className?: string;
  getKey: (item: T) => string;
};

export function AnimatedQueueList<T>({
  children,
  className = "",
  getKey,
  items,
}: AnimatedQueueListProps<T>) {
  return (
    <div className={["animated-queue-list", className].filter(Boolean).join(" ")}>
      {items.map((item, index) => (
        <div
          className="animated-queue-list__item"
          key={getKey(item)}
          style={{ "--motion-delay": `${Math.min(index * 28, 180)}ms` } as CSSProperties}
        >
          {children(item, index)}
        </div>
      ))}
    </div>
  );
}

type WorkflowStep = {
  id: string;
  label: string;
  metric?: string;
  state: "blocked" | "active" | "complete" | "idle";
};

type WorkflowStepperProps = {
  steps: WorkflowStep[];
  className?: string;
};

export function WorkflowStepper({ className = "", steps }: WorkflowStepperProps) {
  const activeStepId =
    steps.find((step) => step.state === "active")?.id ??
    steps.find((step) => step.state === "blocked")?.id ??
    null;
  return (
    <ol className={["workflow-stepper", className].filter(Boolean).join(" ")}>
      {steps.map((step, index) => (
        <li
          aria-current={step.id === activeStepId ? "step" : undefined}
          className="workflow-stepper__item"
          data-state={step.state}
          key={step.id}
        >
          <span className="workflow-stepper__dot">{index + 1}</span>
          <span className="workflow-stepper__label">{step.label}</span>
          {step.metric ? <strong>{step.metric}</strong> : null}
        </li>
      ))}
    </ol>
  );
}

type GradualBlurProps = {
  edge?: "bottom" | "top";
};

export function GradualBlur({ edge = "bottom" }: GradualBlurProps) {
  return <div aria-hidden="true" className="gradual-blur" data-edge={edge} />;
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(query.matches);
    function onChange(event: MediaQueryListEvent) {
      setPrefersReducedMotion(event.matches);
    }
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return prefersReducedMotion;
}
