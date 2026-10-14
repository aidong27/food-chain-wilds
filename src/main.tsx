import { render } from 'preact';
import type { RegionId } from './game/data';
import { boot, getState, select } from './client/store';
import { registerGameTools } from './client/webmcp';
import { App } from './ui/App';
import './ui/styles/base.css';
import './ui/styles/map.css';
import './ui/styles/play.css';
import './ui/styles/screens.css';
import './ui/styles/tutorial.css';

render(<App />, document.getElementById('app')!);
boot();
registerGameTools(
  () => getState().view,
  id => select(id as RegionId),
);
