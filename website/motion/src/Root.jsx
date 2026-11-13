import React from 'react';
import { AbsoluteFill, Composition, Easing, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from 'remotion';

const ITEMS = [
  { label: 'Books', line: 'GST accounting & invoicing', tint: '#232A66', glyph: '₹' },
  { label: 'People', line: 'Employee records & leave', tint: '#C93F28', glyph: '◉' },
  { label: 'Payroll', line: 'Salary & statutory workflows', tint: '#0079BF', glyph: '≡' },
  { label: 'Attendance', line: 'Reader & mobile check-ins', tint: '#B45309', glyph: '◷' },
];
const BG = '#101a30';
const font = "'Plus Jakarta Sans', 'Inter', Arial, sans-serif";
const clamp = (n) => Math.max(0, Math.min(1, n));

const Card = ({ item, index, frame, fps }) => {
  const t = clamp((frame - index * 12) / 40);
  const y = interpolate(t, [0, 1], [130, 0], { easing: Easing.out(Easing.cubic) });
  return <div style={{ width: 408, height: 338, borderRadius: 25, padding: 32, background: '#fff', boxShadow: '0 30px 90px #0004', transform: `translateY(${y}px)`, opacity: t, borderTop: `6px solid ${item.tint}`, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
    <div style={{ width: 74, height: 74, borderRadius: 20, background: item.tint, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 42 }}>{item.glyph}</div>
    <div><div style={{ color: '#12213c', fontWeight: 780, fontSize: 43 }}>CLOR {item.label}</div><div style={{ color: '#61718b', fontSize: 24, marginTop: 8 }}>{item.line}</div></div>
  </div>;
};

export const ConnectedSuite = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = clamp((frame - 215) / 55);
  return <AbsoluteFill style={{ background: `radial-gradient(ellipse at 80% 20%,#293451,${BG} 60%)`, color: '#fff', padding: '118px 100px', fontFamily: font, overflow: 'hidden' }}>
    <div style={{ opacity: 1 - fade }}>
      <div style={{ fontSize: 25, fontWeight: 800, letterSpacing: 5, color: '#ff9b69' }}>THE CONNECTED CLOR SUITE</div>
      <div style={{ fontWeight: 800, letterSpacing: -5, fontSize: 86, lineHeight: 1.1, margin: '28px 0 60px' }}>One workspace. Different jobs.</div>
      <div style={{ display: 'flex', gap: 24 }}>{ITEMS.map((item, index) => <Card item={item} index={index} frame={frame} fps={fps} key={item.label} />)}</div>
    </div>
    <AbsoluteFill style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', textAlign: 'center', opacity: fade, padding: 100 }}>
      <div><div style={{ color: '#ff8a54', fontSize: 45, fontWeight: 760, letterSpacing: 3 }}>CLOR</div><div style={{ fontSize: 91, fontWeight: 800, lineHeight: 1.15, letterSpacing: -5, maxWidth: 1500 }}>Your business, connected.</div></div>
    </AbsoluteFill>
  </AbsoluteFill>;
};

export const ClorHero = () => {
  const frame = useCurrentFrame();
  const {fps}=useVideoConfig();
  const intro=spring({frame, fps, config:{damping:200}});
  const y=interpolate(intro,[0,1],[80,0]);
  const progress=clamp((frame-75)/85);
  return <AbsoluteFill style={{background:'linear-gradient(135deg,#fafcff,#fcece4)',color:'#142139',fontFamily:font,display:'flex',justifyContent:'center',padding:110,overflow:'hidden'}}>
    <div style={{position:'absolute',right:-200,top:-300,width:1000,height:1000,borderRadius:'50%',border:'2px solid #fdbd9b',boxShadow:'0 0 0 70px #ff540008,0 0 0 150px #ff540006'}}/>
    <div style={{opacity:intro,transform:`translateY(${y}px)`,zIndex:1}}>
      <div style={{color:'#d2531e',fontSize:28,fontWeight:750,letterSpacing:6}}>CLOR APPLICATIONS</div>
      <div style={{fontSize:110,fontWeight:790,letterSpacing:-8,lineHeight:1.04,marginTop:20,maxWidth:1600}}>Accounts. People. Payroll. Attendance.</div>
      <div style={{fontSize:46,color:'#667389',marginTop:42}}>Built to work together.</div>
      <div style={{marginTop:80,height:10,borderRadius:30,background:'#e8eaf0',overflow:'hidden',maxWidth:900}}><div style={{height:'100%',width:`${progress*100}%`,background:'#ff5400'}}/></div>
    </div>
  </AbsoluteFill>;
};

export const MotionRoot = () => <>
  <Composition id="ConnectedSuite" component={ConnectedSuite} width={1920} height={1080} fps={30} durationInFrames={270}/>
  <Composition id="ClorHero" component={ClorHero} width={1920} height={1080} fps={30} durationInFrames={210}/>
</>;
