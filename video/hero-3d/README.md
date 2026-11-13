# clor.in hero clip, 3D (HyperFrames + Three.js)

10-second loop behind the home page headline: the People, Attendance, Payroll
and Books screens float in depth and an orange line lights each in turn, the
month-end run. Screens are drawn on canvas from the site's sample figures.

- Edit `index.html`. Preview: `npx hyperframes preview`.
- Render and copy to the site:

```
npx hyperframes render --format mp4 --crf 26 -o out/clor-hero-3d.mp4
npx hyperframes render --format webm --crf 36 -o out/clor-hero-3d.webm
ffmpeg -ss 7.9 -i out/clor-hero-3d.mp4 -frames:v 1 out/poster.png
cp out/clor-hero-3d.mp4 out/clor-hero-3d.webm ../../website/public/hero/
```

Save `out/poster.png` as `website/public/hero/clor-hero-3d-poster.webp`.
