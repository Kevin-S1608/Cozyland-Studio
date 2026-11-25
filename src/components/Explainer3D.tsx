import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  ChevronDown,
  ChevronUp,
  Compass,
  Eye,
  Layers,
  Maximize2,
  Play,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { Episode, SceneNode } from '../types/podcast';

interface Explainer3DProps {
  episode: Episode;
  activeChapterId?: string;
  onJumpToChapter?: (chapterId: string) => void;
}

const _projVec = new THREE.Vector3();
const _desiredCamPos = new THREE.Vector3();
const _desiredTarget = new THREE.Vector3();

function detectSoftwareWebGL(): { supported: boolean; isSoftware: boolean } {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return { supported: false, isSoftware: true };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    const isSoftware = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    return { supported: true, isSoftware };
  } catch {
    return { supported: false, isSoftware: true };
  }
}

function createNodeGeometry(shape: SceneNode['shape'], scale: number): THREE.BufferGeometry {
  const s = 0.55 * scale;
  switch (shape) {
    case 'octahedron':
      return new THREE.OctahedronGeometry(s * 1.05, 0);
    case 'icosahedron':
      return new THREE.IcosahedronGeometry(s, 1);
    case 'torus':
      return new THREE.TorusGeometry(s * 0.85, s * 0.28, 18, 42);
    case 'box':
      return new THREE.BoxGeometry(s * 1.4, s * 1.4, s * 1.4);
    case 'cylinder':
      return new THREE.CylinderGeometry(s * 0.72, s * 0.88, s * 1.35, 24);
    case 'ring':
      return new THREE.TorusKnotGeometry(s * 0.68, s * 0.2, 64, 12);
    case 'sphere':
    default:
      return new THREE.SphereGeometry(s, 32, 24);
  }
}

export const Explainer3D: React.FC<Explainer3DProps> = ({
  episode,
  activeChapterId,
  onJumpToChapter,
}) => {
  const { scene3D } = episode;
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string>(scene3D.nodes[0]?.id || '');
  const [hoveredNode, setHoveredNode] = useState<{ node: SceneNode; x: number; y: number } | null>(null);
  const [projectedLabels, setProjectedLabels] = useState<
    Array<{ id: string; label: string; x: number; y: number; visible: boolean; color: string }>
  >([]);
  const [autoRotate, setAutoRotate] = useState<boolean>(() =>
    typeof window === 'undefined'
      ? true
      : !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [renderMode, setRenderMode] = useState<'3d' | 'svg'>(() =>
    detectSoftwareWebGL().supported ? '3d' : 'svg'
  );

  // Refs for stable WebGL lifecycle without teardown on React state changes
  const selectedIdRef = useRef(selectedNodeId);
  const activeChapterRef = useRef(activeChapterId);
  const autoRotateRef = useRef(autoRotate);
  const showLabelsRef = useRef(showLabels);
  const cameraActionRef = useRef<{
    focusNodeId?: string;
    resetOverview?: boolean;
    zoomDelta?: number;
  }>({});

  selectedIdRef.current = selectedNodeId;
  activeChapterRef.current = activeChapterId;
  autoRotateRef.current = autoRotate;
  showLabelsRef.current = showLabels;

  useEffect(() => {
    if (scene3D.nodes.length > 0 && !scene3D.nodes.some((n) => n.id === selectedNodeId)) {
      setSelectedNodeId(scene3D.nodes[0].id);
    }
  }, [episode.id, scene3D.nodes, selectedNodeId]);

  // Sync highlighted node when active podcast chapter changes
  useEffect(() => {
    if (!activeChapterId) return;
    const match = scene3D.nodes.find((n) => n.chapterId === activeChapterId);
    if (match) {
      setSelectedNodeId(match.id);
      cameraActionRef.current.focusNodeId = match.id;
    }
  }, [activeChapterId, scene3D.nodes]);

  const selectedNode = useMemo(
    () => scene3D.nodes.find((n) => n.id === selectedNodeId) || scene3D.nodes[0],
    [scene3D.nodes, selectedNodeId]
  );

  const connectedEdges = useMemo(() => {
    if (!selectedNode) return [];
    return scene3D.edges.filter((e) => e.from === selectedNode.id || e.to === selectedNode.id);
  }, [scene3D.edges, selectedNode]);

  useEffect(() => {
    if (renderMode !== '3d') return;
    const container = mountRef.current;
    if (!container) return;

    const probe = detectSoftwareWebGL();
    if (!probe.supported) {
      setRenderMode('svg');
      return;
    }
    const isSoftwareGl = probe.isSoftware;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 520;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0B0E1D');
    scene.fog = new THREE.FogExp2('#0B0E1D', 0.032);

    const camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 120);
    camera.position.set(0, 5.2, 13.5);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.innerHTML = '';
    container.appendChild(canvas);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setRenderMode('svg');
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);

    // Mandatory studio environment reflection
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmremGenerator.dispose();

    // 3-point lighting + cool/warm contrast
    const hemiLight = new THREE.HemisphereLight('#C4B5FD', '#0F172A', 0.9);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight('#FFF7ED', 1.8);
    keyLight.position.set(8, 12, 9);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#22D3EE', 1.15);
    rimLight.position.set(-9, 5, -8);
    scene.add(rimLight);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.minDistance = 4.5;
    controls.maxDistance = 26;
    controls.maxPolarAngle = Math.PI * 0.85;

    let cameraTransitionActive = false;
    controls.addEventListener('start', () => {
      cameraTransitionActive = false;
      cameraActionRef.current.focusNodeId = undefined;
      cameraActionRef.current.resetOverview = false;
    });

    // Track disposable resources
    const disposables: Array<{ dispose: () => void }> = [envTex];
    const track = <T extends { dispose: () => void }>(item: T): T => {
      disposables.push(item);
      return item;
    };

    // Subtle spatial grid floor
    const gridHelper = new THREE.GridHelper(28, 28, 0x3b82f6, 0x1e1b4b);
    gridHelper.position.y = -4.6;
    (gridHelper.material as THREE.Material).transparent = true;
    (gridHelper.material as THREE.Material).opacity = 0.25;
    scene.add(gridHelper);

    // Domain-specific architectural ambient geometry
    const domainLower = scene3D.domainType.toLowerCase();
    const ambientGroup = new THREE.Group();
    scene.add(ambientGroup);

    if (domainLower.includes('solar') || domainLower.includes('planet') || domainLower.includes('orbit')) {
      [3.2, 5.2, 7.4].forEach((radius, idx) => {
        const ringGeo = track(new THREE.TorusGeometry(radius, 0.025, 10, 96));
        const ringMat = track(
          new THREE.MeshBasicMaterial({
            color: idx === 1 ? '#22D3EE' : '#8B5CF6',
            transparent: true,
            opacity: 0.28,
          })
        );
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI / 2 + (idx - 1) * 0.14;
        ambientGroup.add(ring);
      });
    } else if (domainLower.includes('sound') || domainLower.includes('music') || domainLower.includes('audio')) {
      [2.2, 3.6, 5.0, 6.4].forEach((radius, idx) => {
        const waveGeo = track(new THREE.TorusGeometry(radius, 0.035, 12, 80));
        const waveMat = track(
          new THREE.MeshStandardMaterial({
            color: idx % 2 === 0 ? '#EC4899' : '#22D3EE',
            emissive: idx % 2 === 0 ? '#EC4899' : '#22D3EE',
            emissiveIntensity: 0.35,
            roughness: 0.3,
          })
        );
        const wave = new THREE.Mesh(waveGeo, waveMat);
        wave.rotation.x = Math.PI / 2;
        wave.position.y = -1.5;
        wave.userData.waveIndex = idx;
        ambientGroup.add(wave);
      });
    } else if (domainLower.includes('brain') || domainLower.includes('neural') || domainLower.includes('climate')) {
      const shellGeo = track(new THREE.IcosahedronGeometry(7.6, 2));
      const shellMat = track(
        new THREE.MeshBasicMaterial({
          color: domainLower.includes('climate') ? '#22D3EE' : '#8B5CF6',
          wireframe: true,
          transparent: true,
          opacity: 0.09,
        })
      );
      ambientGroup.add(new THREE.Mesh(shellGeo, shellMat));
    }

    // Ambient starfield / particles using Points
    const particleCount = 180;
    const pPositions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      pPositions[i * 3] = (Math.random() - 0.5) * 32;
      pPositions[i * 3 + 1] = (Math.random() - 0.5) * 18;
      pPositions[i * 3 + 2] = (Math.random() - 0.5) * 32;
    }
    const pGeo = track(new THREE.BufferGeometry());
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
    const pMat = track(
      new THREE.PointsMaterial({
        color: '#C4B5FD',
        size: 0.09,
        transparent: true,
        opacity: 0.45,
      })
    );
    scene.add(new THREE.Points(pGeo, pMat));

    // Build Composite 3-part Node Groups
    const nodeGroups = new Map<
      string,
      {
        group: THREE.Group;
        bodyMesh: THREE.Mesh;
        ringMesh: THREE.Mesh;
        coreMesh: THREE.Mesh;
        node: SceneNode;
        baseY: number;
      }
    >();
    const clickableMeshes: THREE.Object3D[] = [];

    scene3D.nodes.forEach((node, idx) => {
      const group = new THREE.Group();
      group.position.set(node.position[0], node.position[1], node.position[2]);

      const color = new THREE.Color(node.color || '#8B5CF6');
      const bodyGeo = track(createNodeGeometry(node.shape, node.scale));
      const bodyMat = track(
        new THREE.MeshPhysicalMaterial({
          color,
          roughness: 0.22,
          metalness: node.role === 'core' ? 0.65 : 0.25,
          clearcoat: 0.85,
          clearcoatRoughness: 0.12,
          emissive: color,
          emissiveIntensity: 0.14,
        })
      );
      const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
      bodyMesh.castShadow = !isSoftwareGl;
      bodyMesh.layers.enable(1);
      bodyMesh.userData.nodeId = node.id;
      clickableMeshes.push(bodyMesh);
      group.add(bodyMesh);

      // Secondary silhouette: metallic orbital collar ring
      const collarGeo = track(new THREE.TorusGeometry(0.75 * node.scale, 0.035, 12, 48));
      const collarMat = track(
        new THREE.MeshStandardMaterial({
          color: '#E2E8F0',
          metalness: 0.85,
          roughness: 0.2,
        })
      );
      const ringMesh = new THREE.Mesh(collarGeo, collarMat);
      ringMesh.rotation.x = Math.PI * 0.38 + idx * 0.2;
      ringMesh.rotation.y = idx * 0.3;
      group.add(ringMesh);

      // Accent detail: inner beacon satellite orb
      const coreGeo = track(new THREE.SphereGeometry(0.12 * node.scale, 16, 12));
      const coreMat = track(
        new THREE.MeshStandardMaterial({
          color: '#FFFFFF',
          emissive: '#22D3EE',
          emissiveIntensity: 0.9,
          roughness: 0.1,
        })
      );
      const coreMesh = new THREE.Mesh(coreGeo, coreMat);
      coreMesh.position.set(0.75 * node.scale, 0, 0);
      ringMesh.add(coreMesh);

      scene.add(group);
      nodeGroups.set(node.id, {
        group,
        bodyMesh,
        ringMesh,
        coreMesh,
        node,
        baseY: node.position[1],
      });
    });

    // Build Curved Edges + Animated Signal Pulses
    const edgePulses: Array<{
      curve: THREE.CatmullRomCurve3;
      pulse: THREE.Mesh;
      speed: number;
      offset: number;
    }> = [];

    scene3D.edges.forEach((edge, idx) => {
      const fromEntry = nodeGroups.get(edge.from);
      const toEntry = nodeGroups.get(edge.to);
      if (!fromEntry || !toEntry) return;

      const p1 = fromEntry.group.position.clone();
      const p2 = toEntry.group.position.clone();
      const mid = p1.clone().add(p2).multiplyScalar(0.5);
      mid.y += 0.55 + (idx % 2 === 0 ? 0.35 : -0.2);

      const curve = new THREE.CatmullRomCurve3([p1, mid, p2]);
      const tubeGeo = track(new THREE.TubeGeometry(curve, 24, 0.032, 8, false));
      const tubeMat = track(
        new THREE.MeshStandardMaterial({
          color: '#94A3B8',
          emissive: '#6D28D9',
          emissiveIntensity: 0.28,
          roughness: 0.4,
          transparent: true,
          opacity: 0.65,
        })
      );
      scene.add(new THREE.Mesh(tubeGeo, tubeMat));

      const pulseGeo = track(new THREE.SphereGeometry(0.09, 12, 12));
      const pulseMat = track(
        new THREE.MeshBasicMaterial({
          color: edge.flowDirection === 'bidirectional' ? '#EC4899' : '#22D3EE',
        })
      );
      const pulse = new THREE.Mesh(pulseGeo, pulseMat);
      scene.add(pulse);

      edgePulses.push({
        curve,
        pulse,
        speed: 0.28 + (edge.strength || 0.5) * 0.25,
        offset: (idx * 0.23) % 1,
      });
    });

    // Raycasting for Click & Hover
    const raycaster = new THREE.Raycaster();
    raycaster.layers.set(1);
    const pointer = new THREE.Vector2();
    let lastHoverCheck = 0;

    const updatePointer = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    };

    const onPointerDown = (ev: PointerEvent) => {
      updatePointer(ev.clientX, ev.clientY);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(clickableMeshes, false);
      if (hits.length > 0) {
        const hitId = hits[0].object.userData.nodeId as string;
        if (hitId) {
          setSelectedNodeId(hitId);
          cameraActionRef.current.focusNodeId = hitId;
        }
      }
    };

    const onPointerMove = (ev: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverCheck < 50) return;
      lastHoverCheck = now;
      updatePointer(ev.clientX, ev.clientY);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(clickableMeshes, false);
      if (hits.length > 0) {
        const hitId = hits[0].object.userData.nodeId as string;
        const entry = nodeGroups.get(hitId);
        if (entry) {
          canvas.style.cursor = 'pointer';
          const rect = canvas.getBoundingClientRect();
          setHoveredNode({
            node: entry.node,
            x: ev.clientX - rect.left,
            y: ev.clientY - rect.top,
          });
          return;
        }
      }
      canvas.style.cursor = 'grab';
      setHoveredNode(null);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 520;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const clock = new THREE.Clock();
    let frameId = 0;
    let labelTick = 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    let disposed = false;
    function tick() {
      if (disposed) return;
      const delta = Math.min(clock.getDelta(), 0.1);
      const elapsed = clock.getElapsedTime();

      // Handle camera actions smoothly
      if (cameraActionRef.current.resetOverview) {
        _desiredTarget.set(0, 0, 0);
        _desiredCamPos.set(0, 5.2, 13.5);
        cameraTransitionActive = true;
        cameraActionRef.current.resetOverview = false;
      } else if (cameraActionRef.current.focusNodeId) {
        const targetEntry = nodeGroups.get(cameraActionRef.current.focusNodeId);
        if (targetEntry) {
          _desiredTarget.copy(targetEntry.group.position);
          _desiredCamPos.set(
            targetEntry.group.position.x + 3.6,
            targetEntry.group.position.y + 2.2,
            targetEntry.group.position.z + 5.4
          );
          cameraTransitionActive = true;
        }
        cameraActionRef.current.focusNodeId = undefined;
      }

      if (cameraActionRef.current.zoomDelta) {
        const dir = camera.position.clone().sub(controls.target).normalize();
        const dist = camera.position.distanceTo(controls.target);
        const nextDist = THREE.MathUtils.clamp(dist + cameraActionRef.current.zoomDelta, 4.5, 25);
        camera.position.copy(controls.target).add(dir.multiplyScalar(nextDist));
        cameraActionRef.current.zoomDelta = undefined;
      }

      if (cameraTransitionActive) {
        controls.target.x = THREE.MathUtils.damp(controls.target.x, _desiredTarget.x, 5, delta);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, _desiredTarget.y, 5, delta);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, _desiredTarget.z, 5, delta);
        camera.position.x = THREE.MathUtils.damp(camera.position.x, _desiredCamPos.x, 4.5, delta);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, _desiredCamPos.y, 4.5, delta);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, _desiredCamPos.z, 4.5, delta);

        if (camera.position.distanceTo(_desiredCamPos) < 0.08) {
          cameraTransitionActive = false;
        }
      }

      controls.autoRotate = !isSoftwareGl && autoRotateRef.current && !cameraTransitionActive;
      controls.autoRotateSpeed = 0.7;
      controls.update();

      // Animate nodes & highlight selected/chapter-active node
      const selId = selectedIdRef.current;
      const chapId = activeChapterRef.current;
      let idx = 0;
      for (const [id, entry] of nodeGroups.entries()) {
        const isSelected = id === selId;
        const isChapterMatch = Boolean(chapId && entry.node.chapterId === chapId);

        entry.group.position.y = entry.baseY + Math.sin(elapsed * 1.4 + idx * 0.9) * 0.16;
        entry.bodyMesh.rotation.y += delta * (isSelected ? 0.9 : 0.35);
        entry.ringMesh.rotation.z += delta * (isSelected ? 1.4 : 0.55);

        const targetScale = isSelected ? 1.24 : isChapterMatch ? 1.12 : 1.0;
        const nextScale = THREE.MathUtils.damp(entry.group.scale.x, targetScale, 8, delta);
        entry.group.scale.setScalar(nextScale);

        const mat = entry.bodyMesh.material as THREE.MeshPhysicalMaterial;
        mat.emissiveIntensity = isSelected ? 0.55 : isChapterMatch ? 0.35 : 0.14;
        idx++;
      }

      // Animate edge data pulses
      for (const ep of edgePulses) {
        const t = (elapsed * ep.speed + ep.offset) % 1;
        ep.curve.getPointAt(t, ep.pulse.position);
      }

      // Ambient sound wave oscillation if applicable
      for (const child of ambientGroup.children) {
        if (typeof child.userData.waveIndex === 'number') {
          const wIdx = child.userData.waveIndex as number;
          child.position.y = -1.5 + Math.sin(elapsed * 2 + wIdx * 0.8) * 0.22;
        }
      }

      renderer.render(scene, camera);

      // Update projected 2D label coordinates smoothly every few frames
      labelTick++;
      if (showLabelsRef.current && labelTick % 3 === 0) {
        const w = container?.clientWidth || 800;
        const h = container?.clientHeight || 520;
        const nextLabels: Array<{
          id: string;
          label: string;
          x: number;
          y: number;
          visible: boolean;
          color: string;
        }> = [];
        for (const [id, entry] of nodeGroups.entries()) {
          _projVec.copy(entry.group.position);
          _projVec.y += 0.95 * entry.node.scale;
          _projVec.project(camera);
          const visible = _projVec.z < 1 && _projVec.z > -1;
          nextLabels.push({
            id,
            label: entry.node.label,
            x: ((_projVec.x + 1) / 2) * w,
            y: ((-_projVec.y + 1) / 2) * h,
            visible,
            color: entry.node.color,
          });
        }
        setProjectedLabels(nextLabels);
      }

      if (isSoftwareGl) afterDraw(tick);
      else frameId = requestAnimationFrame(tick);
    }

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      controls.dispose();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      container.innerHTML = '';
    };
  }, [episode.id, scene3D, renderMode]);

  return (
    <div className="relative w-full h-[640px] lg:h-[700px] rounded-2xl overflow-hidden border border-[#E9E4F5] dark:border-white/10 bg-[#0B0E1D] text-white select-none">
      {/* Top-Left Minimal Spec Header (No Backdrop Blur over WebGL) */}
      <div className="absolute top-4 left-4 z-10 max-w-md pointer-events-none">
        <div className="bg-[#0B0E1D]/90 border border-white/10 rounded-xl px-4 py-3 pointer-events-auto">
          <div className="flex items-center gap-2 text-xs text-[#C4B5FD] font-mono-tabular">
            <span>{scene3D.domainType.replace(/-/g, ' ')}</span>
            <span aria-hidden="true">·</span>
            <span>{scene3D.nodes.length} concepts</span>
            <span aria-hidden="true">·</span>
            <span>{scene3D.edges.length} links</span>
          </div>
          <h2 className="font-display font-semibold text-base text-white mt-0.5 truncate">
            {scene3D.title}
          </h2>
          <p className="text-xs text-slate-300 mt-1 line-clamp-2">{scene3D.centralMetaphor}</p>
        </div>
      </div>

      {/* Top-Right Mode Toggle */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setRenderMode((m) => (m === '3d' ? 'svg' : '3d'))}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[#111526]/95 border border-white/15 text-slate-100 hover:border-[#22D3EE] transition-colors whitespace-nowrap"
          title="Switch between interactive Three.js 3D and 2D SVG schematic"
        >
          <Layers className="w-3.5 h-3.5 text-[#22D3EE]" />
          {renderMode === '3d' ? '2D Schematic' : '3D WebGL'}
        </button>
      </div>

      {/* 3D Canvas Mount OR Interactive SVG Fallback */}
      {renderMode === '3d' ? (
        <div className="relative w-full h-full">
          <div ref={mountRef} className="w-full h-full" />

          {/* Projected 3D Labels */}
          {showLabels &&
            projectedLabels.map((lbl) =>
              lbl.visible && lbl.x > 40 && lbl.x < 1200 && lbl.y > 40 && lbl.y < 640 ? (
                <button
                  key={lbl.id}
                  type="button"
                  onClick={() => {
                    setSelectedNodeId(lbl.id);
                    cameraActionRef.current.focusNodeId = lbl.id;
                  }}
                  style={{
                    transform: `translate(${lbl.x}px, ${lbl.y}px) translate(-50%, -100%)`,
                  }}
                  className={`absolute top-0 left-0 z-10 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors whitespace-nowrap ${
                    selectedNodeId === lbl.id
                      ? 'bg-[#6D28D9] border-white text-white shadow-lg'
                      : 'bg-[#0F172A]/90 border-white/15 text-slate-100 hover:border-[#22D3EE]'
                  }`}
                >
                  {lbl.label}
                </button>
              ) : null
            )}

          {/* Hover Tooltip */}
          {hoveredNode && (
            <div
              style={{
                left: Math.min(hoveredNode.x + 14, 520),
                top: Math.max(hoveredNode.y - 12, 80),
              }}
              className="absolute z-20 pointer-events-none max-w-xs bg-[#090B14]/95 border border-white/20 rounded-xl px-3.5 py-2.5 shadow-xl"
            >
              <div className="text-[11px] font-mono-tabular text-[#22D3EE]">{hoveredNode.node.category}</div>
              <div className="font-display font-semibold text-sm text-white">{hoveredNode.node.label}</div>
              <p className="text-xs text-slate-300 mt-1 line-clamp-2">{hoveredNode.node.summary}</p>
            </div>
          )}
        </div>
      ) : (
        <SvgExplainerFallback
          episode={episode}
          selectedNodeId={selectedNodeId}
          onSelectNode={(id) => setSelectedNodeId(id)}
        />
      )}

      {/* Collapsible Bottom Control Dock (Zero Center Occlusion) */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-[min(920px,94%)] flex flex-col items-center">
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="mb-1.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-t-lg text-xs font-medium bg-[#111526]/95 border border-white/15 text-slate-200 hover:text-white transition-colors"
        >
          {dockCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {dockCollapsed ? 'Show Explorer Dock' : 'Hide Controls'}
        </button>

        {!dockCollapsed && (
          <div className="w-full bg-[#111526]/95 border border-white/15 rounded-2xl p-3.5 shadow-2xl space-y-3">
            {/* Selected Concept Summary + Jump to Chapter */}
            {selectedNode && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2.5 border-b border-white/10">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-[#C4B5FD]">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: selectedNode.color }}
                    />
                    <span className="font-medium">{selectedNode.category}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-slate-300">
                      {connectedEdges.length} connections
                    </span>
                  </div>
                  <div className="font-display font-semibold text-sm text-white truncate mt-0.5">
                    {selectedNode.label}
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5 line-clamp-2">{selectedNode.summary}</p>
                </div>

                {onJumpToChapter && (
                  <button
                    type="button"
                    onClick={() => onJumpToChapter(selectedNode.chapterId)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-[#6D28D9] to-[#BE185D] text-white hover:opacity-95 transition-opacity shrink-0 whitespace-nowrap"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Hear in Episode
                  </button>
                )}
              </div>
            )}

            {/* Node Picker Strip + Camera Controls */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1 sm:pb-0">
                {scene3D.nodes.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    aria-pressed={selectedNodeId === node.id}
                    onClick={() => {
                      setSelectedNodeId(node.id);
                      cameraActionRef.current.focusNodeId = node.id;
                    }}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 border ${
                      selectedNodeId === node.id
                        ? 'bg-[#6D28D9] border-[#C4B5FD] text-white'
                        : 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10'
                    }`}
                  >
                    {node.label}
                  </button>
                ))}
              </div>

              {renderMode === '3d' && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      cameraActionRef.current.zoomDelta = -2.2;
                    }}
                    className="p-2 rounded-lg bg-white/5 border border-white/10 hover:border-[#22D3EE] text-slate-200"
                    aria-label="Zoom in"
                    title="Zoom in"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      cameraActionRef.current.zoomDelta = 2.2;
                    }}
                    className="p-2 rounded-lg bg-white/5 border border-white/10 hover:border-[#22D3EE] text-slate-200"
                    aria-label="Zoom out"
                    title="Zoom out"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-pressed={autoRotate}
                    onClick={() => setAutoRotate((v) => !v)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border whitespace-nowrap ${
                      autoRotate
                        ? 'bg-[#22D3EE]/15 border-[#22D3EE]/50 text-[#22D3EE]'
                        : 'bg-white/5 border-white/10 text-slate-200'
                    }`}
                    title="Toggle auto-orbit"
                  >
                    <Compass className="w-3.5 h-3.5" />
                    Orbit
                  </button>
                  <button
                    type="button"
                    aria-pressed={showLabels}
                    onClick={() => setShowLabels((v) => !v)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border whitespace-nowrap ${
                      showLabels
                        ? 'bg-[#8B5CF6]/20 border-[#8B5CF6]/60 text-[#C4B5FD]'
                        : 'bg-white/5 border-white/10 text-slate-200'
                    }`}
                    title="Toggle 3D concept labels"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Labels
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      cameraActionRef.current.resetOverview = true;
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-slate-200 hover:border-white/30 whitespace-nowrap"
                    title="Reset overview camera"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const SvgExplainerFallback: React.FC<{
  episode: Episode;
  selectedNodeId: string;
  onSelectNode: (id: string) => void;
}> = ({ episode, selectedNodeId, onSelectNode }) => {
  const { nodes, edges } = episode.scene3D;
  const project = (pos: [number, number, number]) => ({
    x: 450 + pos[0] * 48,
    y: 260 - pos[1] * 44 + pos[2] * 14,
  });

  const posMap = new Map(nodes.map((n) => [n.id, project(n.position)]));

  return (
    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#090B14] via-[#12162B] to-[#1A1333]">
      <svg
        viewBox="0 0 900 540"
        className="w-full h-full max-w-4xl"
        role="img"
        aria-label={`Interactive 2D schematic for ${episode.scene3D.title}`}
      >
        <defs>
          <radialGradient id="cozyGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#090B14" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="450" cy="260" r="240" fill="url(#cozyGlow)" />

        {edges.map((edge) => {
          const p1 = posMap.get(edge.from);
          const p2 = posMap.get(edge.to);
          if (!p1 || !p2) return null;
          return (
            <g key={edge.id}>
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke="#64748B"
                strokeOpacity="0.55"
                strokeWidth="2"
                strokeDasharray="6 4"
              />
              <text
                x={(p1.x + p2.x) / 2}
                y={(p1.y + p2.y) / 2 - 6}
                fill="#94A3B8"
                fontSize="10"
                textAnchor="middle"
              >
                {edge.label}
              </text>
            </g>
          );
        })}

        {nodes.map((node) => {
          const pt = posMap.get(node.id) || { x: 450, y: 260 };
          const isSelected = node.id === selectedNodeId;
          const r = (node.role === 'core' ? 28 : 20) * (isSelected ? 1.18 : 1);
          return (
            <g
              key={node.id}
              role="button"
              tabIndex={0}
              aria-label={`Select concept ${node.label}`}
              onClick={() => onSelectNode(node.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectNode(node.id);
                }
              }}
              className="cursor-pointer focus:outline-none"
            >
              <circle
                cx={pt.x}
                cy={pt.y}
                r={r + 6}
                fill={node.color}
                fillOpacity={isSelected ? 0.35 : 0.12}
              />
              <circle
                cx={pt.x}
                cy={pt.y}
                r={r}
                fill={node.color}
                stroke={isSelected ? '#FFFFFF' : '#E2E8F0'}
                strokeWidth={isSelected ? 3 : 1.5}
              />
              <text
                x={pt.x}
                y={pt.y + r + 18}
                fill="#F8FAFC"
                fontSize="12"
                fontWeight={isSelected ? '700' : '500'}
                textAnchor="middle"
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
