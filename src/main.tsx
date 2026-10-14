import { render } from 'preact';
import type { RegionId } from './game/data';
import { boot, getState, select } from './client/store';
import { registerGameTools } from './client/webmcp';
import { App } from './ui/App';
import './ui/styles.css';

render(<App />, document.getElementById('app')!);
boot();
registerGameTools(
  () => getState().view,
  id => select(id as RegionId),
);
