import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { bbox, getMaterial, ITEM_KIND_COLORS, openingWorld, polygonCentroid, wallPolygon, type PlacedItem, type Plan, type Project, type ViewPreset, type Wall } from "@planner/shared";
import { useStore } from "../store";
import { doorLeaves, openingFrame, wallBoxes, type Box3 } from "./geometry";
import { materialTexture } from "./textures";

const S = 0.01; // cm → m

interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  /** Narrower field of view for plan-like views. */
  fov?: number;
}

function planExtent(plan: Plan) {
  const pts = [...plan.walls.flatMap((w) => wallPolygon(w)), ...plan.rooms.flatMap((r) => r.polygon)];
  if (!pts.length) return { min: { x: -100, y: -100 }, max: { x: 300, y: 300 }, center: { x: 100, y: 100 } };
  const b = bbox(pts);
  return { ...b, center: { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 } };
}

export function cameraPose(plan: Plan, view: ViewPreset): CameraPose | null {
  const ext = planExtent(plan);
  const room = plan.rooms[0];
  const c = room ? polygonCentroid(room.polygon) : ext.center;
  const size = Math.max(ext.max.x - ext.min.x, ext.max.y - ext.min.y);
  switch (view) {
    case "top":
      return { position: new THREE.Vector3(c.x * S, size * S * 2.4 + 3, c.y * S + 0.01), target: new THREE.Vector3(c.x * S, 0, c.y * S), fov: 28 };
    case "entrance": {
      const wallMap = new Map(plan.walls.map((w) => [w.id, w]));
      const doors = plan.openings.filter((o) => (o.type === "door" || o.type === "double_door" || o.type === "passage") && wallMap.has(o.wallId));
      const entrance = doors.find((o) => /вход|entrance/i.test(o.label ?? "")) ?? doors.sort((a, b) => b.width - a.width)[0];
      if (!entrance) return null;
      const w = wallMap.get(entrance.wallId)!;
      const ow = openingWorld(w, entrance);
      // inward = direction from the door towards the room centroid
      const toC = { x: c.x - ow.center.x, y: c.y - ow.center.y };
      const len = Math.hypot(toC.x, toC.y) || 1;
      const inward = { x: toC.x / len, y: toC.y / len };
      const pos = { x: ow.center.x + inward.x * 25, y: ow.center.y + inward.y * 25 };
      return { position: new THREE.Vector3(pos.x * S, 1.55, pos.y * S), target: new THREE.Vector3(c.x * S, 1.0, c.y * S) };
    }
    case "corner_left": {
      const b = room ? bbox(room.polygon) : ext;
      return { position: new THREE.Vector3((b.min.x + 25) * S, 2.1, (b.min.y + 25) * S), target: new THREE.Vector3(c.x * S, 0.9, c.y * S) };
    }
    case "corner_right": {
      const b = room ? bbox(room.polygon) : ext;
      return { position: new THREE.Vector3((b.max.x - 25) * S, 2.1, (b.min.y + 25) * S), target: new THREE.Vector3(c.x * S, 0.9, c.y * S) };
    }
    default:
      return null;
  }
}

/** Imperative handle shared with the toolbar buttons. */
export const viewer3d: { setView: ((v: ViewPreset) => void) | null } = { setView: null };

function BoxMesh({ b, wallMaterial }: { b: Box3; wallMaterial?: THREE.Material }) {
  const h = b.y1 - b.y0;
  const color = b.color ?? (b.kind === "niche" ? "#efe9df" : "#f1ede6");
  return (
    <mesh position={[b.cx, b.y0 + h / 2, b.cy]} rotation={[0, (-b.angle * Math.PI) / 180, 0]} castShadow receiveShadow>
      <boxGeometry args={[b.length, h, b.thickness]} />
      {wallMaterial && !b.color ? <primitive object={wallMaterial} attach="material" /> : <meshStandardMaterial color={color} roughness={b.kind === "leaf" ? 0.55 : 0.9} />}
    </mesh>
  );
}

function useWallMaterial(materialId: string | undefined): THREE.Material {
  return useMemo(() => {
    const m = getMaterial(materialId, "wall");
    if (m.pattern === "plain" || m.pattern === "concrete") return new THREE.MeshStandardMaterial({ color: m.color, roughness: 0.95 });
    const { texture, tileCm } = materialTexture(m);
    const t = texture.clone();
    t.needsUpdate = true;
    t.repeat.set(1 / tileCm, 1 / tileCm);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 });
  }, [materialId]);
}

function WallGroup({ wall, plan }: { wall: Wall; plan: Plan }) {
  const mat = useWallMaterial(wall.materialId);
  const boxes = useMemo(() => wallBoxes(wall, plan.openings), [wall, plan.openings]);
  return (
    <group>
      {boxes.map((b) => (
        <BoxMesh key={b.key} b={b} wallMaterial={mat} />
      ))}
    </group>
  );
}

function Floor({ polygon, materialId }: { polygon: { x: number; y: number }[]; materialId: string }) {
  const geom = useMemo(() => {
    const shape = new THREE.Shape(polygon.map((p) => new THREE.Vector2(p.x, -p.y)));
    return new THREE.ShapeGeometry(shape);
  }, [polygon]);
  const mat = useMemo(() => {
    const m = getMaterial(materialId, "floor");
    const { texture, tileCm } = materialTexture(m);
    const t = texture.clone();
    t.needsUpdate = true;
    t.repeat.set(1 / tileCm, 1 / tileCm);
    return new THREE.MeshStandardMaterial({ map: t, roughness: m.pattern === "carpet" ? 1 : 0.6, metalness: 0 });
  }, [materialId]);
  return (
    <mesh geometry={geom} material={mat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.2, 0]} receiveShadow />
  );
}

function useImageTexture(url?: string): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!url) {
      setTex(null);
      return;
    }
    let alive = true;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      url,
      (t) => {
        if (!alive) return;
        t.colorSpace = THREE.SRGBColorSpace;
        setTex(t);
      },
      undefined,
      () => alive && setTex(null),
    );
    return () => {
      alive = false;
    };
  }, [url]);
  return tex;
}

function ItemMesh({ item, selected, showLabel, onClick }: { item: PlacedItem; selected: boolean; showLabel: boolean; onClick: () => void }) {
  const tex = useImageTexture(item.imageUrl);
  const color = item.color ?? ITEM_KIND_COLORS[item.kind] ?? "#bdbdbd";
  const flat = item.kind === "rug";
  const h = flat ? 1 : item.h;
  return (
    <group position={[item.x, item.elevation + h / 2, item.y]} rotation={[0, (-item.rotation * Math.PI) / 180, 0]}>
      <mesh castShadow={!flat} receiveShadow onClick={(e) => (e.stopPropagation(), onClick())}>
        <boxGeometry args={[item.w, h, item.d]} />
        {tex ? <meshStandardMaterial map={tex} roughness={0.7} /> : <meshStandardMaterial color={color} roughness={item.kind === "mirror" ? 0.1 : 0.75} metalness={item.kind === "mirror" ? 0.6 : 0} />}
      </mesh>
      {selected && (
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(item.w + 1, h + 1, item.d + 1)]} />
          <lineBasicMaterial color="#2b7cff" />
        </lineSegments>
      )}
      {showLabel && (
        <Html center position={[0, h / 2 + 8, 0]} style={{ pointerEvents: "none" }} zIndexRange={[10, 0]}>
          <div className="label3d">{item.name}</div>
        </Html>
      )}
    </group>
  );
}

function Scene({ project }: { project: Project }) {
  const plan = project.plan;
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const showLabels = useStore((s) => s.showLabels3d);
  const ext = planExtent(plan);
  const groundSize = Math.max(ext.max.x - ext.min.x, ext.max.y - ext.min.y) * 3 + 600;
  return (
    <group scale={S}>
      {/* ground outside the rooms */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[ext.center.x, -0.5, ext.center.y]} receiveShadow onClick={() => select(null)}>
        <planeGeometry args={[groundSize, groundSize]} />
        <meshStandardMaterial color="#dfe3e8" roughness={1} />
      </mesh>
      {plan.rooms.map((r) => (
        <Floor key={r.id} polygon={r.polygon} materialId={r.floorMaterialId} />
      ))}
      {plan.walls.map((w) => (
        <WallGroup key={w.id} wall={w} plan={plan} />
      ))}
      {plan.openings.flatMap((o) => {
        const w = plan.walls.find((x) => x.id === o.wallId);
        if (!w) return [];
        return [...openingFrame(w, o), ...doorLeaves(w, o)].map((b) => <BoxMesh key={b.key} b={b} />);
      })}
      {plan.items.map((it) => (
        <ItemMesh key={it.id} item={it} selected={selection?.type === "item" && selection.id === it.id} showLabel={showLabels} onClick={() => select({ type: "item", id: it.id })} />
      ))}
      {showLabels &&
        plan.labels.map((l) => (
          <Html key={l.id} center position={[l.x, 5, l.y]} style={{ pointerEvents: "none" }}>
            <div className="label3d label3d-zone">{l.text}</div>
          </Html>
        ))}
    </group>
  );
}

function CaptureBridge({ project }: { project: Project }) {
  const { gl, scene, camera, controls, invalidate } = useThree();
  const setCapture = useStore((s) => s.setCapture);
  const ctrlRef = useRef<OrbitControlsImpl | null>(null);
  ctrlRef.current = (controls as OrbitControlsImpl | null) ?? null;

  useEffect(() => {
    const applyPose = (pose: CameraPose) => {
      const cam = camera as THREE.PerspectiveCamera;
      if (cam.isPerspectiveCamera) {
        cam.fov = pose.fov ?? 60;
        cam.updateProjectionMatrix();
      }
      camera.position.copy(pose.position);
      camera.lookAt(pose.target);
      const c = ctrlRef.current;
      if (c) {
        c.target.copy(pose.target);
        c.update();
      }
      camera.updateMatrixWorld();
    };
    viewer3d.setView = (view) => {
      const pose = cameraPose(project.plan, view);
      if (pose) {
        applyPose(pose);
        invalidate();
      }
    };
    setCapture(async (views) => {
      const out: Partial<Record<ViewPreset, string>> = {};
      const savedPos = camera.position.clone();
      const savedTarget = ctrlRef.current ? ctrlRef.current.target.clone() : new THREE.Vector3();
      const savedQuat = camera.quaternion.clone();
      const cam = camera as THREE.PerspectiveCamera;
      const savedFov = cam.isPerspectiveCamera ? cam.fov : 60;
      // HTML labels are DOM overlays and never part of the canvas, so nothing to hide here
      for (const view of views) {
        if (view === "custom") {
          if (cam.isPerspectiveCamera) {
            cam.fov = savedFov;
            cam.updateProjectionMatrix();
          }
          camera.position.copy(savedPos);
          camera.quaternion.copy(savedQuat);
          camera.updateMatrixWorld();
        } else {
          const pose = cameraPose(project.plan, view);
          if (!pose) continue;
          applyPose(pose);
        }
        gl.render(scene, camera);
        out[view] = gl.domElement.toDataURL("image/png");
      }
      if (cam.isPerspectiveCamera) {
        cam.fov = savedFov;
        cam.updateProjectionMatrix();
      }
      camera.position.copy(savedPos);
      camera.quaternion.copy(savedQuat);
      if (ctrlRef.current) {
        ctrlRef.current.target.copy(savedTarget);
        ctrlRef.current.update();
      }
      camera.updateMatrixWorld();
      invalidate();
      return out;
    });
    return () => {
      setCapture(null);
      viewer3d.setView = null;
    };
  }, [project, gl, scene, camera, invalidate, setCapture]);
  return null;
}

export default function Viewer3D({ visible }: { visible: boolean }) {
  const project = useStore((s) => s.project);
  const initial = useMemo(() => (project ? cameraPose(project.plan, "corner_left") : null), [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!project) return null;
  const ext = planExtent(project.plan);
  const target: [number, number, number] = [ext.center.x * S, 0.8, ext.center.y * S];
  return (
    <div className="viewer3d" style={{ visibility: visible ? "visible" : "hidden", pointerEvents: visible ? "auto" : "none" }}>
      <Canvas shadows frameloop="demand" gl={{ preserveDrawingBuffer: true, antialias: true }} camera={{ position: initial ? [initial.position.x, initial.position.y, initial.position.z] : [3, 2.5, 3], fov: 60, near: 0.05, far: 200 }} dpr={[1, 1.5]}>
        <color attach="background" args={["#e9edf2"]} />
        <hemisphereLight args={["#ffffff", "#b8b0a2", 0.7]} />
        <ambientLight intensity={0.35} />
        <directionalLight position={[4, 8, 3]} intensity={1.4} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={6} shadow-camera-bottom={-6} shadow-bias={-0.0005} />
        <pointLight position={[target[0], 2.5, target[2]]} intensity={6} distance={8} decay={2} color="#ffe6c4" />
        <Suspense fallback={null}>
          <Scene project={project} />
        </Suspense>
        <OrbitControls makeDefault target={target} maxPolarAngle={Math.PI / 2 + 0.05} minDistance={0.3} maxDistance={40} />
        <CaptureBridge project={project} />
      </Canvas>
      {visible && (
        <div className="viewer3d-hud">
          {(["top", "entrance", "corner_left", "corner_right"] as ViewPreset[]).map((v) => (
            <button key={v} onClick={() => viewer3d.setView?.(v)}>
              {{ top: "Сверху", entrance: "От входа", corner_left: "Угол слева", corner_right: "Угол справа", custom: "" }[v]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
