import { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useScroll, Html } from '@react-three/drei';
import * as THREE from 'three';
import gsap from 'gsap';
import { useStore } from '../store/useStore';

const PALETTE = {
  bg: '#0F131A',
  accent: '#FFB454',
  accentDim: '#6B5330',
  ok: '#5FD98A',
  warn: '#E8685D',
  text: '#E8EBEF',
  textDim: '#8B95A5'
};

function generateFibonacciSphere(samples: number, radius: number) {
  const points = [];
  const phi = Math.PI * (3 - Math.sqrt(5)); // golden angle
  for (let i = 0; i < samples; i++) {
    const y = 1 - (i / (samples - 1)) * 2; // y goes from 1 to -1
    const r = Math.sqrt(1 - y * y); // radius at y
    const theta = phi * i; // golden angle increment
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    points.push(x * radius, y * radius, z * radius);
  }
  return new Float32Array(points);
}

// Generate the arced curve between two points
function getArcCurve(p1: THREE.Vector3, p2: THREE.Vector3, height: number = 2) {
  const mid = p1.clone().lerp(p2, 0.5);
  mid.y += height; // arc upwards
  return new THREE.QuadraticBezierCurve3(p1, mid, p2);
}

export function PeerLink() {
  const groupRef = useRef<THREE.Group>(null);
  
  // Nodes
  const node1Ref = useRef<THREE.Mesh>(null);
  const node2Ref = useRef<THREE.Mesh>(null);
  const mat1Ref = useRef<THREE.MeshStandardMaterial>(null);
  const mat2Ref = useRef<THREE.MeshStandardMaterial>(null);
  
  // Beam
  const beamRef = useRef<THREE.Mesh>(null);
  const beamMatRef = useRef<THREE.MeshStandardMaterial>(null);
  
  // Particles
  const particlesRef = useRef<THREE.Points>(null);

  const scroll = useScroll();
  const status = useStore(state => state.connectionStatus);
  const transfer = useStore(state => state.transfer);
  
  const [hasBurst, setHasBurst] = useState(false);
  const { scene } = useThree();

  // 3000 points for desktop tier
  const particlePositions = useMemo(() => generateFibonacciSphere(3000, 5), []);
  
  // Curve for the beam
  const p1 = useMemo(() => new THREE.Vector3(-2, 0, 0), []);
  const p2 = useMemo(() => new THREE.Vector3(2, 0, 0), []);
  const curve = useMemo(() => getArcCurve(p1, p2, 1.5), [p1, p2]);
  const tubeGeom = useMemo(() => new THREE.TubeGeometry(curve, 64, 0.03, 8, false), [curve]);

  const tl = useMemo(() => gsap.timeline({ paused: true }), []);

  useEffect(() => {
    if (!groupRef.current) return;

    tl.clear();
    
    // Initial State (Hero) - scaled down, sitting at top
    tl.set(groupRef.current.position, { x: 0, y: 1.5, z: 0 })
      .set(groupRef.current.rotation, { x: 0, y: 0, z: 0 })
      .set(groupRef.current.scale, { x: 0.6, y: 0.6, z: 0.6 });

    // Scroll Progress 1 (Bottom/App mode)
    tl.to(groupRef.current.position, {
      x: 0, y: 0, z: 0,
      ease: 'power2.inOut'
    }, 0)
    .to(groupRef.current.rotation, {
      x: 0, y: Math.PI, z: 0, // 180 spin
      ease: 'power1.inOut'
    }, 0)
    .to(groupRef.current.scale, {
      x: 1.2, y: 1.2, z: 1.2,
      ease: 'back.out(1.7)'
    }, 0);

  }, [tl]);

  // Handle Transfer Overrides and Burst
  useEffect(() => {
    if (!groupRef.current || !beamMatRef.current || !mat2Ref.current || !node2Ref.current) return;

    if (status !== 'idle') {
      // Force mesh to center for app usage
      gsap.to(groupRef.current.position, { x: 0, y: 0, z: 0, duration: 1, ease: 'power3.out' });
      gsap.to(groupRef.current.scale, { x: 1.2, y: 1.2, z: 1.2, duration: 1, ease: 'power3.out' });
      
      // Beam animates in at full glow when connected
      gsap.to(beamMatRef.current, { emissiveIntensity: 2, opacity: 1, duration: 1 });
    } else {
      // Idle state: faint/no beam
      gsap.to(beamMatRef.current, { emissiveIntensity: 0, opacity: 0.1, duration: 1 });
    }

    if (transfer.stage === 'complete' && !hasBurst) {
      setTimeout(() => setHasBurst(true), 0);
      // Burst Animation
      const burstTl = gsap.timeline();
      
      // Flash beam and receiving node (node2)
      burstTl.to(mat2Ref.current, { emissiveIntensity: 10, duration: 0.2, ease: 'power2.out' })
             .to(beamMatRef.current, { emissiveIntensity: 8, duration: 0.2, ease: 'power2.out' }, '<')
             .to(node2Ref.current.scale, { x: 1.5, y: 1.5, z: 1.5, duration: 0.2 }, '<')
             // Bounce back
             .to(mat2Ref.current, { emissiveIntensity: 2, duration: 0.6 }, '>')
             .to(beamMatRef.current, { emissiveIntensity: 2, duration: 0.6 }, '<')
             .to(node2Ref.current.scale, { x: 1, y: 1, z: 1, duration: 0.6, ease: 'bounce.out' }, '<');
    }

    if (status === 'idle') {
      setTimeout(() => setHasBurst(false), 0);
    }
  }, [status, transfer.stage, hasBurst]);

  useFrame((state, delta) => {
    if (!groupRef.current || !beamMatRef.current || !mat2Ref.current || !particlesRef.current || !node2Ref.current) return;

    // Ambient particle rotation
    particlesRef.current.rotation.y += delta * 0.05;
    particlesRef.current.rotation.x += delta * 0.02;

    if (status === 'idle') {
      const targetProgress = scroll.offset;
      const currentProgress = tl.progress();
      tl.progress(THREE.MathUtils.lerp(currentProgress, targetProgress, 0.1));
      
      // Reset colors to accentDim
      mat2Ref.current.emissive.lerp(new THREE.Color(PALETTE.accentDim), 0.1);
      beamMatRef.current.emissive.lerp(new THREE.Color(PALETTE.accentDim), 0.1);
      
    } else {
      // Constant slow spin while connected
      groupRef.current.rotation.y += delta * 0.2;

      if (transfer.stage === 'transferring' && transfer.fileSize) {
        const progress = transfer.bytesTransferred / transfer.fileSize;
        
        // Target receiving node (node2)
        const targetScale = 1.0 + (Math.sin(state.clock.elapsedTime * 15) * 0.1) + (progress * 0.3);
        node2Ref.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.2);

        // Color shift from accentDim to accent based on progress
        const startColor = new THREE.Color(PALETTE.accentDim);
        const endColor = new THREE.Color(PALETTE.accent);
        const currentColor = startColor.clone().lerp(endColor, progress);
        
        mat2Ref.current.emissive.copy(currentColor);
        beamMatRef.current.emissive.copy(currentColor);
        
        // Also pulse the beam
        beamMatRef.current.emissiveIntensity = 2 + (Math.sin(state.clock.elapsedTime * 10) * 0.5);
      }
    }
  });

  // DEV-ONLY DEBUG HOOK
  useEffect(() => {
    // Check url or env
    const isDev = import.meta.env.DEV;
    if (!isDev) return;
    
    // We delay slightly to let the scene mount fully
    const timeout = setTimeout(() => {
      console.log('=== PEERLINK DEBUG HOOK ===');
      
      let nodeCount = 0;
      const bloomObjects: any[] = [];
      
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          if (obj.userData?.isNode) {
            nodeCount++;
            const mat = obj.material as THREE.MeshStandardMaterial;
            console.log(`Node ${nodeCount} | Color: #${mat.color.getHexString()} | Emissive: #${mat.emissive.getHexString()}`);
          }
          if (obj.userData?.isBeam) {
            const mat = obj.material as THREE.MeshStandardMaterial;
            console.log(`Beam | Color: #${mat.color.getHexString()} | Emissive: #${mat.emissive.getHexString()}`);
          }
          
          // Check if object relies on bloom. We do this via toneMapped=false and emissive intensity
          const mat = obj.material as THREE.MeshStandardMaterial;
          if (mat && mat.toneMapped === false && mat.emissiveIntensity > 1) {
            bloomObjects.push(obj.name || obj.uuid);
          }
        }
        if (obj instanceof THREE.Points && obj.userData?.isParticles) {
          console.log(`Particle System | Point Count: ${obj.geometry.attributes.position.count}`);
        }
      });
      
      console.log(`Total Nodes: ${nodeCount}`);
      console.log(`Objects hitting Bloom (emissive > 1 & toneMapped=false):`, bloomObjects);
      console.log('===========================');
    }, 1000);
    
    return () => clearTimeout(timeout);
  }, [scene]);

  return (
    <group ref={groupRef}>
      
      {/* Particle Field */}
      <points ref={particlesRef} userData={{ isParticles: true }}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[particlePositions, 3]}
          />
        </bufferGeometry>
        <pointsMaterial 
          size={0.02} 
          color={PALETTE.textDim}
          transparent 
          opacity={0.3} 
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={true} // ensure this doesn't bloom
        />
      </points>

      {/* Node 1: "This device" */}
      <mesh ref={node1Ref} position={p1} userData={{ isNode: true }} name="Node1">
        <sphereGeometry args={[0.3, 32, 32]} />
        <meshStandardMaterial 
          ref={mat1Ref}
          color={PALETTE.bg}
          emissive={PALETTE.accent}
          emissiveIntensity={2}
          toneMapped={false}
        />
        <Html position={[0, -0.6, 0]} center className="pointer-events-none">
          <div className="text-[var(--color-text)] font-mono text-xs whitespace-nowrap bg-[var(--color-bg)]/80 px-2 py-1 rounded border border-[var(--color-text-dim)]/30 backdrop-blur-sm">
            This device
          </div>
        </Html>
      </mesh>

      {/* Node 2: "Peer" */}
      <mesh ref={node2Ref} position={p2} userData={{ isNode: true }} name="Node2">
        <sphereGeometry args={[0.3, 32, 32]} />
        <meshStandardMaterial 
          ref={mat2Ref}
          color={PALETTE.bg}
          emissive={PALETTE.accentDim} // starts dim
          emissiveIntensity={2}
          toneMapped={false}
        />
        <Html position={[0, -0.6, 0]} center className="pointer-events-none">
          <div className="text-[var(--color-text)] font-mono text-xs whitespace-nowrap bg-[var(--color-bg)]/80 px-2 py-1 rounded border border-[var(--color-text-dim)]/30 backdrop-blur-sm">
            Peer
          </div>
        </Html>
      </mesh>

      {/* Connecting Beam */}
      <mesh ref={beamRef} geometry={tubeGeom} userData={{ isBeam: true }} name="Beam">
        <meshStandardMaterial 
          ref={beamMatRef}
          color={PALETTE.bg}
          emissive={PALETTE.accentDim} // starts dim
          emissiveIntensity={0} // completely off when idle
          transparent
          opacity={0.1}
          toneMapped={false}
        />
      </mesh>

    </group>
  );
}
