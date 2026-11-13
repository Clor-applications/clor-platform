import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';

// Use the website's existing photography from website/public/people.
// This is a source composition: render to MP4/WebM before embedding on clor.in.
const CARDS = [
  ['Books', 'hero-books-soft-1400.webp', '#232A66'],
  ['People', 'people-hr-1400.webp', '#C93F28'],
  ['Payroll', 'payroll-payslip-1120.webp', '#0079BF'],
  ['Attendance', 'attendance-reader-1400.webp', '#854D0E'],
];
const reveal = (frame, start) => Math.max(0, Math.min(1, (frame - start) / 18));
export default function PhotoHero() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{background:'linear-gradient(115deg,#f8fafc,#fff4ec)',color:'#16223b',fontFamily:'Plus Jakarta Sans, Arial, sans-serif',overflow:'hidden'}}>
      <AbsoluteFill style={{opacity:.5,backgroundImage:'linear-gradient(#c7d2e442 1px,transparent 1px),linear-gradient(90deg,#c7d2e442 1px,transparent 1px)',backgroundSize:'44px 44px',transform:'perspective(900px) rotateX(25deg) scale(1.15)'}}/>
      <div style={{position:'absolute',top:79,left:108,zIndex:2}}>
        <div style={{fontSize:25,color:'#c64e17',fontWeight:800,letterSpacing:5}}>CLOR APPLICATIONS</div>
        <div style={{fontSize:78,fontWeight:790,letterSpacing:-5,lineHeight:1.08,marginTop:17}}>Your business. Better connected.</div>
      </div>
      <div style={{position:'absolute',left:105,right:105,top:277,bottom:130,display:'flex',gap:21}}>
        {CARDS.map(([name,file,color],i) => {
          const t = reveal(frame,18+i*17);
          return (
            <div key={name} style={{flex:1,minWidth:0,padding:10,borderRadius:20,background:'#fff',border:'1px solid #e5eaf1',boxShadow:'0 25px 60px #18243c26',opacity:t,transform:`translateY(${interpolate(t,[0,1],[80,0],{easing:Easing.out(Easing.cubic)})}px)`}}>
              <div style={{height:'82%',overflow:'hidden',borderRadius:13,background:'#eff2f6'}}>
                <Img src={staticFile('people/'+file)} style={{width:'100%',height:'100%',objectFit:'cover',objectPosition:'center'}} />
              </div>
              <div style={{fontSize:24,fontWeight:790,padding:'17px 12px 5px',color}}>CLOR {name}</div>
            </div>
          );
        })}
      </div>
      <div style={{position:'absolute',bottom:49,left:108,fontSize:23,fontWeight:650,color:'#647189'}}>Accounts. People. Payroll. Attendance.</div>
    </AbsoluteFill>
  );
}
