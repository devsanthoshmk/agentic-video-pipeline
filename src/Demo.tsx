import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

export const Demo = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const reveal = spring({frame, fps, config: {damping: 18}});
  const drift = interpolate(frame, [0, durationInFrames - 1], [-110, 110]);
  return (
    <AbsoluteFill style={{background: '#111b19', color: '#fff8e6', fontFamily: 'sans-serif', overflow: 'hidden'}}>
      <div style={{position: 'absolute', width: 580, height: 580, borderRadius: '50%', background: '#254b40', top: 60, right: -135, transform: `translateX(${drift}px)`}} />
      <div style={{position: 'absolute', left: 84, top: 75, fontSize: 23, letterSpacing: 6, color: '#b7eb9d'}}>FIELD NOTES / 01</div>
      <div style={{position: 'absolute', left: 78, top: 205, opacity: Math.min(1, reveal), transform: `translateY(${(1 - reveal) * 50}px)`}}>
        <div style={{fontSize: 124, fontWeight: 800, lineHeight: 0.96, letterSpacing: -7}}>Make it<br />move.</div>
        <div style={{fontSize: 30, marginTop: 35}}>A motion study, built frame by frame.</div>
      </div>
      <div style={{position: 'absolute', left: 84, right: 84, bottom: 65, height: 4, background: '#42635a'}}>
        <div style={{height: '100%', width: `${100 * frame / (durationInFrames - 1)}%`, background: '#b7eb9d'}} />
      </div>
    </AbsoluteFill>
  );
};
