'use client';

/* Live 3D hero scenes (three.js) — theme-tinted, mouse parallax, paused
   offscreen, static under prefers-reduced-motion. */

import { useEffect, useRef, type CSSProperties } from 'react';

type Preset = 'blobs' | 'particles' | 'ribbon' | 'torus';

export function RtHero3D({
  preset = 'blobs',
  height = 420,
  className,
  style,
}: {
  preset?: string;
  height?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = ref.current;
    if (!wrap) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void import('three').then((THREE) => {
      if (disposed || !wrap) return;
      const cssVar = (n: string) =>
        getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888888';

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.domElement.style.position = 'absolute';
      renderer.domElement.style.inset = '0';
      wrap.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      camera.position.set(0, 0, 9);

      const c1 = new THREE.Color(cssVar('--c-primary'));
      const c2 = new THREE.Color(cssVar('--c-accent'));

      const disposables: { dispose: () => void }[] = [];
      const track = <T extends { dispose: () => void }>(x: T): T => {
        disposables.push(x);
        return x;
      };

      const group = new THREE.Group();
      scene.add(group);
      const p = (['blobs', 'particles', 'ribbon', 'torus'].includes(preset) ? preset : 'blobs') as Preset;

      if (p === 'blobs') {
        scene.add(new THREE.AmbientLight(0xffffff, 0.55));
        const key = new THREE.DirectionalLight(0xffffff, 1.4);
        key.position.set(4, 6, 8);
        scene.add(key);
        const rim = new THREE.DirectionalLight(c2, 1.1);
        rim.position.set(-6, -3, -4);
        scene.add(rim);
        const geo = track(new THREE.IcosahedronGeometry(1, 5));
        for (let i = 0; i < 6; i++) {
          const mat = track(new THREE.MeshPhongMaterial({ color: i % 2 ? c2 : c1, shininess: 60, transparent: true, opacity: 0.94 }));
          const m = new THREE.Mesh(geo, mat);
          m.scale.setScalar(0.6 + (i % 3) * 0.55);
          m.position.set((i - 2.5) * 1.5, Math.sin(i * 2.1) * 1.6, -i * 0.4);
          m.userData = { phase: i * 1.1, speed: 0.4 + (i % 3) * 0.2 };
          group.add(m);
        }
      } else if (p === 'particles') {
        const n = 900;
        const pos = new Float32Array(n * 3);
        const col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          const r = 3.2 + Math.random() * 2.2;
          const a = Math.random() * Math.PI * 2;
          const b = Math.acos(2 * Math.random() - 1);
          pos[i * 3] = r * Math.sin(b) * Math.cos(a);
          pos[i * 3 + 1] = r * Math.sin(b) * Math.sin(a) * 0.6;
          pos[i * 3 + 2] = r * Math.cos(b);
          const c = Math.random() > 0.5 ? c1 : c2;
          col[i * 3] = c.r;
          col[i * 3 + 1] = c.g;
          col[i * 3 + 2] = c.b;
        }
        const geo = track(new THREE.BufferGeometry());
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        group.add(new THREE.Points(geo, track(new THREE.PointsMaterial({ size: 0.055, vertexColors: true, transparent: true, opacity: 0.85 }))));
      } else if (p === 'ribbon') {
        for (let r = 0; r < 5; r++) {
          const pts: InstanceType<typeof THREE.Vector3>[] = [];
          for (let i = 0; i <= 120; i++) {
            const x = (i / 120 - 0.5) * 14;
            pts.push(new THREE.Vector3(x, Math.sin(x * 0.7 + r * 1.2) * (1.1 - r * 0.12), -r * 0.5));
          }
          const geo = track(new THREE.BufferGeometry().setFromPoints(pts));
          const line = new THREE.Line(geo, track(new THREE.LineBasicMaterial({ color: r % 2 ? c2 : c1, transparent: true, opacity: 0.75 - r * 0.1 })));
          line.userData = { r };
          group.add(line);
        }
      } else {
        scene.add(new THREE.AmbientLight(0xffffff, 0.4));
        const key = new THREE.DirectionalLight(0xffffff, 1.2);
        key.position.set(4, 6, 8);
        scene.add(key);
        const geo = track(new THREE.TorusKnotGeometry(2.1, 0.55, 180, 24));
        group.add(new THREE.Mesh(geo, track(new THREE.MeshPhongMaterial({ color: c1, wireframe: true, transparent: true, opacity: 0.55 }))));
        const inner = new THREE.Mesh(geo, track(new THREE.MeshPhongMaterial({ color: c2, transparent: true, opacity: 0.16 })));
        inner.scale.setScalar(0.985);
        group.add(inner);
      }

      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const mouse = { x: 0, y: 0 };
      const onMove = (e: PointerEvent) => {
        const r = wrap.getBoundingClientRect();
        mouse.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
        mouse.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
      };
      wrap.addEventListener('pointermove', onMove);

      let raf = 0;
      let running = true;
      const t0 = performance.now();
      const tick = () => {
        if (!running) return;
        raf = requestAnimationFrame(tick);
        const t = (performance.now() - t0) / 1000;
        if (p === 'blobs') {
          group.children.forEach((m) => {
            const u = m.userData as { phase: number; speed: number };
            m.position.y += Math.sin(t * u.speed + u.phase) * 0.004;
            m.rotation.y = t * 0.15 + u.phase;
          });
        } else if (p === 'particles') {
          group.rotation.y = t * 0.05;
          group.rotation.x = Math.sin(t * 0.11) * 0.12;
        } else if (p === 'ribbon') {
          group.children.forEach((line) => {
            const geo = (line as unknown as { geometry: { attributes: { position: { array: Float32Array; needsUpdate: boolean } } } }).geometry;
            const arr = geo.attributes.position.array;
            const r = (line.userData as { r: number }).r;
            for (let i = 0; i <= 120; i++) {
              const x = (i / 120 - 0.5) * 14;
              arr[i * 3 + 1] = Math.sin(x * 0.7 + r * 1.2 + t * (0.7 + r * 0.12)) * (1.1 - r * 0.12);
            }
            geo.attributes.position.needsUpdate = true;
          });
        } else {
          group.rotation.y = t * 0.22;
          group.rotation.x = Math.sin(t * 0.14) * 0.25;
        }
        camera.position.x += (mouse.x * 0.7 - camera.position.x) * 0.05;
        camera.position.y += (-mouse.y * 0.5 - camera.position.y) * 0.05;
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
      };

      const ro = new ResizeObserver(() => {
        const w = wrap.clientWidth;
        const h = wrap.clientHeight;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        if (reduced) renderer.render(scene, camera);
      });
      ro.observe(wrap);

      const io = new IntersectionObserver(([e]) => {
        if (e.isIntersecting && !reduced) {
          if (!running) {
            running = true;
            tick();
          }
        } else {
          running = false;
          cancelAnimationFrame(raf);
        }
      });
      io.observe(wrap);
      if (!reduced) tick();
      else renderer.render(scene, camera);

      cleanup = () => {
        running = false;
        cancelAnimationFrame(raf);
        ro.disconnect();
        io.disconnect();
        wrap.removeEventListener('pointermove', onMove);
        disposables.forEach((d) => d.dispose());
        renderer.dispose();
        renderer.domElement.remove();
      };
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [preset]);

  return <div ref={ref} className={className} style={{ position: 'relative', width: '100%', height, overflow: 'hidden', ...style }} />;
}
