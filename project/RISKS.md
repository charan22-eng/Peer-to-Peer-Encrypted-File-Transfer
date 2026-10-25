# Risks Log

- **Performance**: Heavy 3D scene (particles, bloom, parallax) needs to run at 60fps on mid-tier hardware. Fallbacks for mobile are strictly required.
- **Architecture**: Separating WebRTC real logic from the 3D visual component safely.
- **State management**: Ensuring 3D scene correctly reads from the shared Zustand store instead of keeping isolated state.
