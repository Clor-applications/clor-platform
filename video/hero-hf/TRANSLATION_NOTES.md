# Translation notes: Remotion to HyperFrames

Ported from the Remotion composition `ClorHero` (1200 x 720, 30 fps, 450 frames)
on 13 Nov 2026, so the clor.in hero video needs no Remotion company licence.
HyperFrames is Apache-2.0.

- **Timing.** The Remotion version was pure frame math (no state). It is ported
  one to one in `index.html`: `interpolate` (clamped), `Easing.bezier(0.65, 0,
  0.35, 1)` and `Easing.out(Easing.cubic)` are reimplemented, and a single paused
  GSAP tween drives a frame counter whose `onUpdate` sets every style. Any seek
  lands on the exact frame.
- **Fonts.** `@remotion/google-fonts` Plus Jakarta Sans became a local
  `assets/jakarta.woff2` (the same variable font the site uses), so renders do
  not depend on the network.
- **Icons.** Phosphor and Lucide React icons were rendered once to SVG
  (`assets/icons.json`) and inlined.
- **Lint.** One advisory (`nested_structure_needs_subcomposition`): the scene
  is one clip with nested markup. It affects only the Studio timeline view.
- **Fidelity.** SSIM against the Remotion render: mean 0.957, lowest frame
  0.943 (threshold 0.90 for data-driven count-up work). Differences are text
  antialiasing and encoder noise; frames compared side by side match.
