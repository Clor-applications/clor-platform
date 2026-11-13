# clor.in hero video (HyperFrames)

The 15-second loop on the clor.in home page: the People, Attendance, Payroll
and Books screens fill in one after another. Sample figures match the site's
drawn screens (website/src/components/Windows.jsx).

- Edit `index.html`. Preview: `npx hyperframes preview`.
- Render and copy to the site:

```
npx hyperframes render --format mp4 --crf 24 -o out/clor-hero.mp4
npx hyperframes render --format webm --crf 34 -o out/clor-hero.webm
ffmpeg -i out/clor-hero.mp4 -vf "select=eq(n\,100)" -frames:v 1 out/poster.png
```

Put `clor-hero.mp4`, `clor-hero.webm` and the poster (as
`clor-hero-poster.webp`) in `website/public/hero/`.
