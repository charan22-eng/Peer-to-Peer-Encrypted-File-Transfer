import { Canvas } from '@react-three/fiber';
import { ScrollControls, Scroll } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { PeerLink } from './PeerLink';
import { Interface } from './Interface';

export function Scene() {
  return (
    <div id="canvas-container">
      <Canvas camera={{ position: [0, 0, 10], fov: 35 }}>
        <color attach="background" args={['#0A0A0A']} />
        
        {/* Basic Lighting */}
        <ambientLight intensity={0.2} />
        <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={1} />
        
        {/* Lenis Scroll Wrapper */}
        <ScrollControls pages={3} damping={0.1}>
          
          {/* 
            By placing the PeerLink on layer 1 (or relying on emissive > 1), 
            we restrict what blooms. Here we use luminanceThreshold > 1 
            so that only highly emissive objects bloom, protecting UI/background.
          */}
          <PeerLink />

          <Scroll html>
            <Interface />
          </Scroll>

        </ScrollControls>

        {/* Post-Processing */}
        <EffectComposer>
          <Bloom 
            luminanceThreshold={1.0} 
            mipmapBlur 
            intensity={1.5} 
          />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
