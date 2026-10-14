"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { useViewer } from "@/lib/store";
import type { CamerasPayload, ChangeJson, ChangesPayload } from "@/lib/types";

function css(name: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(v || "#ffffff");
}

/** Pipeline frame is OpenCV-style with world z up after floor fit; three.js is y up. Rotate x by -90°. */
const WORLD_TO_THREE = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

function frustum(K: number[][], camFromWorld: number[][], color: THREE.Color, size = 0.12): THREE.LineSegments {
  const E = new THREE.Matrix4().set(
    camFromWorld[0][0], camFromWorld[0][1], camFromWorld[0][2], camFromWorld[0][3],
    camFromWorld[1][0], camFromWorld[1][1], camFromWorld[1][2], camFromWorld[1][3],
    camFromWorld[2][0], camFromWorld[2][1], camFromWorld[2][2], camFromWorld[2][3],
    0, 0, 0, 1,
  );
  const camToWorld = E.clone().invert();
  const fx = K[0][0], fy = K[1][1], cx = K[0][2], cy = K[1][2];
  const w = cx * 2, h = cy * 2;
  const corner = (u: number, v: number) => new THREE.Vector3(((u - cx) / fx) * size, ((v - cy) / fy) * size, size);
  const c = [corner(0, 0), corner(w, 0), corner(w, h), corner(0, h)];
  const o = new THREE.Vector3();
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 4; i++) { pts.push(o, c[i]); pts.push(c[i], c[(i + 1) % 4]); }
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 }));
  l.applyMatrix4(camToWorld);
  return l;
}

function obbBox(c: ChangeJson["after"], color: THREE.Color): THREE.LineSegments | null {
  if (!c) return null;
  const [ex, ey, ez] = c.obb.extent;
  const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(ex, ey, ez));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, linewidth: 2 }));
  const R = c.obb.rotation;
  const m = new THREE.Matrix4().set(R[0][0], R[0][1], R[0][2], c.obb.center[0], R[1][0], R[1][1], R[1][2], c.obb.center[1], R[2][0], R[2][1], R[2][2], c.obb.center[2], 0, 0, 0, 1);
  l.applyMatrix4(m);
  return l;
}

export default function SceneCanvas({ scene, data, cameras }: { scene: string; data: ChangesPayload; cameras: CamerasPayload }) {
  const mount = useRef<HTMLDivElement>(null);
  const groups = useRef<Record<string, THREE.Object3D>>({});
  const sel = useRef<Map<string, THREE.Object3D[]>>(new Map());
  const api = useRef<{ camera: THREE.PerspectiveCamera; controls: OrbitControls } | null>(null);

  useEffect(() => {
    const el = mount.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    const sceneT = new THREE.Scene();
    sceneT.background = css("--surface-0");
    const camera = new THREE.PerspectiveCamera(50, el.clientWidth / el.clientHeight, 0.01, 100);
    camera.position.set(2.5, 2.5, 2.5);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    api.current = { camera, controls };
    const root = new THREE.Group();
    root.applyMatrix4(WORLD_TO_THREE);
    sceneT.add(root);
    sceneT.add(new THREE.GridHelper(6, 24, css("--line"), css("--line")));

    const loader = new PLYLoader();
    const base = `/api/scenes/${scene}`;
    const addCloud = (url: string, key: string, color?: THREE.Color, size = 0.012, opacity = 1) =>
      new Promise<void>((resolve) => {
        loader.load(url, (geo) => {
          const mat = new THREE.PointsMaterial({ size, vertexColors: !color, color: color ?? 0xffffff, transparent: opacity < 1, opacity });
          const pts = new THREE.Points(geo, mat);
          root.add(pts);
          groups.current[key] = pts;
          resolve();
        }, undefined, () => resolve());
      });

    // stable clouds (vertex colours) and the unobserved subset (hatched stand-in: grey, smaller, dimmer)
    const beforeG = new THREE.Group(); root.add(beforeG); groups.current.before = beforeG;
    const afterG = new THREE.Group(); root.add(afterG); groups.current.after = afterG;
    loader.load(`${base}/before.ply`, (g) => { beforeG.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 0.012, vertexColors: true }))); fit(g); });
    loader.load(`${base}/after.ply`, (g) => afterG.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 0.012, vertexColors: true }))));
    addCloud(`${base}/before_unobserved.ply`, "unobserved", css("--unobserved"), 0.016, 0.5);

    // change blobs + boxes + arrows
    const camG = new THREE.Group(); root.add(camG); groups.current.cameras = camG;
    cameras.before.forEach((c) => camG.add(frustum(c.K, c.cam_from_world, css("--ink-faint"))));
    cameras.after.forEach((c) => camG.add(frustum(c.K, c.cam_from_world, css("--ink-muted"))));

    const stateG: Record<string, THREE.Group> = { added: new THREE.Group(), removed: new THREE.Group(), moved: new THREE.Group() };
    Object.entries(stateG).forEach(([k, g]) => { root.add(g); groups.current[k] = g; });
    for (const c of data.changes) {
      const col = css(`--${c.state}`);
      const own: THREE.Object3D[] = [];
      const g = stateG[c.state];
      if (c.before) {
        loader.load(`${base}/${c.before.ply}`, (geo) => {
          const p = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.014, color: css("--removed"), transparent: true, opacity: c.state === "moved" ? 0.35 : 0.5 }));
          g.add(p); own.push(p);
        });
        const b = obbBox(c.before, c.state === "moved" ? css("--removed") : col); if (b) { g.add(b); own.push(b); }
      }
      if (c.after) {
        loader.load(`${base}/${c.after.ply}`, (geo) => { const p = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.014, color: col })); g.add(p); own.push(p); });
        const b = obbBox(c.after, col); if (b) { g.add(b); own.push(b); }
      }
      if (c.state === "moved" && c.before && c.after) {
        const from = new THREE.Vector3(...c.before.centroid), to = new THREE.Vector3(...c.after.centroid);
        const dir = to.clone().sub(from); const len = dir.length();
        const arrow = new THREE.ArrowHelper(dir.normalize(), from, len, col.getHex(), Math.min(0.12, len * 0.3), Math.min(0.06, len * 0.15));
        g.add(arrow); own.push(arrow);
      }
      sel.current.set(c.id, own);
    }

    function fit(g: THREE.BufferGeometry) {
      g.computeBoundingSphere();
      const s = g.boundingSphere!; const c = s.center.clone().applyMatrix4(WORLD_TO_THREE);
      controls.target.copy(c); camera.position.copy(c.clone().add(new THREE.Vector3(s.radius, s.radius * 0.8, s.radius * 1.2))); controls.update();
    }

    let raf = 0;
    const loop = () => { controls.update(); renderer.render(sceneT, camera); raf = requestAnimationFrame(loop); };
    loop();
    const onResize = () => { camera.aspect = el.clientWidth / el.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(el.clientWidth, el.clientHeight); };
    const ro = new ResizeObserver(onResize); ro.observe(el);
    const unsub = useViewer.subscribe((s) => {
      const v = s.visible;
      const show = (k: string, on: boolean) => { if (groups.current[k]) groups.current[k].visible = on; };
      const diff = s.view === "diff";
      show("before", v.stable && (s.view === "before" || diff || s.view === "overlay"));
      show("after", v.stable && (s.view === "after" || s.view === "overlay"));
      show("unobserved", v.unobserved && (diff || s.view === "before"));
      show("cameras", v.cameras);
      (["added", "removed", "moved"] as const).forEach((k) => show(k, v[k] && (diff || s.view === "overlay")));
      // dim stable cloud when something is selected; highlight selection
      const dim = s.selected != null;
      [beforeG, afterG].forEach((grp) => grp.traverse((o) => { if (o instanceof THREE.Points) { const m = o.material as THREE.PointsMaterial; m.transparent = dim; m.opacity = dim ? 0.55 : 1; m.needsUpdate = true; } }));
      sel.current.forEach((objs, id) => objs.forEach((o) => {
        if (o instanceof THREE.LineSegments) (o.material as THREE.LineBasicMaterial).color = id === s.selected ? css("--accent") : (o.userData.base ??= (o.material as THREE.LineBasicMaterial).color.clone());
      }));
      if (s.selected) {
        const c = data.changes.find((x) => x.id === s.selected);
        const b = c?.after ?? c?.before;
        if (b) {
          const target = new THREE.Vector3(...b.centroid).applyMatrix4(WORLD_TO_THREE);
          const offset = camera.position.clone().sub(controls.target).setLength(Math.max(1.2, Math.max(...b.obb.extent) * 4));
          controls.target.copy(target); camera.position.copy(target.clone().add(offset));
        }
      }
    });
    return () => { cancelAnimationFrame(raf); ro.disconnect(); unsub(); renderer.dispose(); el.removeChild(renderer.domElement); };
  }, [scene, data, cameras]);

  return <div ref={mount} className="absolute inset-0" />;
}
