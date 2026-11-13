# clor.in hero video

The 15-second loop on the clor.in home page: the four CLOR screens fill in one
after another along People, Attendance, Payroll and Books. Sample figures match
the ones the site draws (website/src/components/Windows.jsx).

- Edit: `src/Hero.tsx`. Preview: `npm run dev`.
- Render and copy to the site:

```
npx remotion render ClorHero out/clor-hero.mp4 --codec=h264 --crf=24
npx remotion render ClorHero out/clor-hero.webm --codec=vp9 --crf=34
npx remotion still ClorHero out/poster.png --frame=100
```

Then put `clor-hero.mp4`, `clor-hero.webm` and the poster (as
`clor-hero-poster.webp`) in `website/public/hero/`.
