"use client";

import { useEffect, useState } from "react";

export function MorphingText({
  texts,
  intervalMs = 2200,
  className,
}: {
  texts: string[];
  intervalMs?: number;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (texts.length <= 1) return;
    const timer = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIndex((i) => (i + 1) % texts.length);
        setVisible(true);
      }, 220);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [texts.length, intervalMs]);

  return (
    <span
      className={`inline-block transition-all duration-300 ${
        visible ? "opacity-100 blur-0" : "opacity-0 blur-sm"
      } ${className ?? ""}`}
    >
      {texts[index]}
    </span>
  );
}

export default MorphingText;
