import React from "react";
import { Composition } from "remotion";
import { FPS, Hero, TOTAL } from "./Hero";

export const RemotionRoot: React.FC = () => {
  return <Composition id="ClorHero" component={Hero} durationInFrames={TOTAL} fps={FPS} width={1200} height={720} />;
};
