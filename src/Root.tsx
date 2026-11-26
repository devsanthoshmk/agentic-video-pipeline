import {Composition} from 'remotion';
import {Demo} from './Demo';

export const Root = () => (
  <Composition
    id="Demo"
    component={Demo}
    width={1280}
    height={720}
    fps={30}
    durationInFrames={150}
  />
);
