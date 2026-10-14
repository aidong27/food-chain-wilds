import { useEffect } from 'preact/hooks';
import type { PhaseId } from '../game/data';
import { leave, toggleSound, urls, useApp } from '../client/store';
import { copyInvite, numeral } from './common';
import { DialogHost, confirmLeave, showBestiary, showRules } from './dialogs';
import { Finish } from './Finish';
import { Home, Lobby } from './Home';
import { Icon, phaseIcon } from './icons';
import { Play } from './Play';
import { Tutorial } from './Tutorial';

function TopBar({ overHero }: { overHero: boolean }) {
  const { view, connected, sound, link } = useApp();
  return (
    <header class={`topbar ${overHero ? 'over-hero' : ''}`}>
      <a
        class="brand"
        href={urls.home}
        aria-label="食物链首页"
        onClick={e => {
          if (!link) return;
          e.preventDefault();
          confirmLeave();
        }}
      >
        <img src={urls.asset('favicon.svg')} alt="" width={34} height={34} />
        <span>
          <b>食物链</b>
          <small>荒野生存博弈</small>
        </span>
      </a>
      <span class="spacer" />
      <nav>
        <button class="btn quiet" onClick={showRules} aria-label="生存手册">
          <Icon name="rules" size={17} />
          <span class="label-text">生存手册</span>
        </button>
        <button class="btn quiet" onClick={() => showBestiary()} aria-label="动物图鉴">
          <Icon name="bestiary" size={17} />
          <span class="label-text">动物图鉴</span>
        </button>
      </nav>
      <div class="top-actions">
        {view?.mode === 'online' && view.phase === 'lobby' && (
          <>
            <span class={`conn ${connected ? 'on' : ''}`} role="status" aria-label={connected ? '已连接' : '重连中'}>
              <Icon name={connected ? 'online' : 'offline'} size={15} />
              <span class="label-text" aria-hidden="true">
                {connected ? '已连接' : '重连中'}
              </span>
            </span>
            <button class="room-code" onClick={() => copyInvite(view.code)} title="复制邀请链接">
              {view.code}
              <Icon name="copy" size={14} />
            </button>
          </>
        )}
        <button class="icon-btn" onClick={toggleSound} aria-label={sound ? '关闭音效' : '开启音效'} aria-pressed={sound}>
          <Icon name={sound ? 'soundOn' : 'soundOff'} />
        </button>
        {link && (
          <button class="btn quiet" onClick={confirmLeave} aria-label="离开">
            <Icon name="leave" size={17} />
            <span class="label-text">离开</span>
          </button>
        )}
      </div>
    </header>
  );
}

function Toast() {
  const { toast } = useApp();
  return (
    <div id="toast" class={toast ? 'visible' : ''} role="status" aria-live="polite">
      {toast?.text}
    </div>
  );
}

/** A new night takes the whole screen for a moment; later phases only announce themselves. */
function Banner() {
  const { banner, view } = useApp();
  if (!banner) return null;
  const phase = view?.phase;
  if (banner.kind === 'phase') {
    return (
      <div class="phase-pill" key={banner.id} aria-hidden="true">
        {phase && phase !== 'lobby' && phase !== 'finished' && <Icon name={phaseIcon(phase as PhaseId)} size={18} />}
        <strong>{banner.title}</strong>
      </div>
    );
  }
  return (
    <div class="phase-banner" key={banner.id} aria-hidden="true">
      <div>
        <Icon name="round" size={30} />
        <strong>{view ? `第${numeral(view.round)}夜` : banner.title}</strong>
        <span>{banner.detail}</span>
      </div>
    </div>
  );
}

function Flash() {
  const { flash } = useApp();
  return flash ? <div class={`screen-flash ${flash.kind}`} key={flash.id} aria-hidden="true" /> : null;
}

function Connecting() {
  return (
    <main class="connecting">
      <div class="card connecting-card">
        <span class="spinner" aria-hidden="true" />
        <h2 class="brush">正在进入荒野…</h2>
        <p class="muted">连接房间中。若长时间没有响应，可以返回首页重试；单人练习不需要网络。</p>
        <button class="btn ghost" onClick={leave}>
          返回首页
        </button>
      </div>
    </main>
  );
}

export function App() {
  const { view, link } = useApp();
  const screen = !view
    ? link
      ? 'connecting'
      : 'home'
    : view.phase === 'lobby'
      ? 'lobby'
      : view.phase === 'finished'
        ? 'finished'
        : 'play';
  useEffect(() => {
    if (screen === 'finished') window.scrollTo({ top: 0 });
  }, [screen]);
  return (
    <>
      {screen !== 'play' && <TopBar overHero={screen === 'home'} />}
      {screen === 'home' && <Home />}
      {screen === 'connecting' && <Connecting />}
      {screen === 'lobby' && <Lobby />}
      {screen === 'play' && <Play />}
      {screen === 'finished' && <Finish />}
      {screen === 'play' && <Tutorial />}
      <Flash />
      <Toast />
      <Banner />
      <DialogHost />
    </>
  );
}
