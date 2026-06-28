"use client";

import * as React from "react";
import * as THREE from "three";
import { useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

// ─── 3D feature glyphs (raw three.js) ────────────────────────────────────────
//
// A small, gently-rotating Three.js object per feature card. Built imperatively
// on a <canvas> (no React-Three-Fiber, so no JSX-type conflicts). Each `kind`
// maps to a distinct violet primitive. Runs low-power, pauses when scrolled off
// screen, renders a single static frame under reduced-motion, and disposes the
// GL context on unmount.

export type GlyphKind =
  | "markdown"
  | "branches"
  | "graph"
  | "skills"
  | "mcp"
  | "audit";

const VIOLET = 0x7c5cff;

function solidMaterial() {
  return new THREE.MeshStandardMaterial({
    color: VIOLET,
    metalness: 0.35,
    roughness: 0.35,
    emissive: 0x2a1768,
    emissiveIntensity: 0.4,
  });
}

function wireMaterial() {
  return new THREE.MeshStandardMaterial({
    color: VIOLET,
    wireframe: true,
    metalness: 0.2,
    roughness: 0.5,
  });
}

function buildObject(kind: GlyphKind): THREE.Group {
  const group = new THREE.Group();

  switch (kind) {
    case "markdown": {
      [0.22, 0, -0.22].forEach((y, i) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.13, 0.85), solidMaterial());
        m.position.set((i - 1) * 0.06, y, 0);
        group.add(m);
      });
      group.rotation.x = 0.25;
      break;
    }
    case "branches": {
      group.add(new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.95, 0.95), wireMaterial()));
      const a = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 20), solidMaterial());
      a.position.set(0.7, 0.65, 0);
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 20), solidMaterial());
      b.position.set(-0.65, -0.6, 0.3);
      group.add(a, b);
      break;
    }
    case "graph": {
      group.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.78, 0), wireMaterial()));
      (
        [
          [0, 0.78, 0],
          [0.66, -0.3, 0.2],
          [-0.6, -0.35, -0.25],
        ] as const
      ).forEach((p) => {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 16), solidMaterial());
        s.position.set(p[0], p[1], p[2]);
        group.add(s);
      });
      break;
    }
    case "skills":
      group.add(new THREE.Mesh(new THREE.TorusKnotGeometry(0.5, 0.16, 100, 18), solidMaterial()));
      break;
    case "mcp": {
      group.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.46, 0), solidMaterial()));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.05, 16, 60), solidMaterial());
      ring.rotation.x = Math.PI / 2.4;
      group.add(ring);
      break;
    }
    case "audit": {
      [0.3, 0, -0.3].forEach((y) => {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.13, 40), solidMaterial());
        m.position.y = y;
        group.add(m);
      });
      break;
    }
  }

  return group;
}

export function FeatureGlyph({
  kind,
  className,
}: {
  kind: GlyphKind;
  className?: string;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    let width = parent.clientWidth || 56;
    let height = parent.clientHeight || 56;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.z = 3;
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(3, 4, 5);
    scene.add(dir);

    const obj = buildObject(kind);
    scene.add(obj);

    let raf = 0;
    let visible = true;

    const renderFrame = () => renderer.render(scene, camera);

    const tick = () => {
      obj.rotation.y += 0.01;
      renderFrame();
      if (visible && !reduceMotion) raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (reduceMotion) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = !!entry?.isIntersecting;
        if (visible) start();
        else cancelAnimationFrame(raf);
      },
      { threshold: 0 },
    );
    io.observe(canvas);

    const ro = new ResizeObserver(() => {
      width = parent.clientWidth || width;
      height = parent.clientHeight || height;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderFrame();
    });
    ro.observe(parent);

    renderFrame();
    start();

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const mat = o.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, [kind, reduceMotion]);

  return (
    <div
      className={cn(
        "relative size-14 overflow-hidden rounded-2xl bg-violet-500/10",
        className,
      )}
    >
      <canvas ref={canvasRef} className="block size-full" />
    </div>
  );
}
