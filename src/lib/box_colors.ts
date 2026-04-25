const KEY = (id: string) => `box_color_${id}`;

export function getBoxColor(id: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(KEY(id));
}

export function setBoxColor(id: string, color: string | null): void {
  if (color) localStorage.setItem(KEY(id), color);
  else localStorage.removeItem(KEY(id));
}

export const BOX_COLOR_OPTIONS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
];
