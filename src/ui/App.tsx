import { useEffect } from 'preact/hooks';
import { leave, toggleSound, urls, useApp } from '../client/store';
import { DialogHost, confirmLeave, showBestiary, showRules } from './dialogs';
import { Finish } from './Finish';
import { Home, HomeFooter, Lobby, copyInvite } from './Home';
import { Play } from './Play';

const DIFFICULTY_NAME = { easy: '入门', normal: '标准', hard: '老练' } as const;

function TopBar() {
  const { view, connected, sound, link } = useApp();
  return (
    <header class="topbar">
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
        <img src={urls.asset('favicon.svg')} alt="" width={43} height={43} />
        <span>
          食物链<small>THE FOOD CHAIN</small>
        </span>
      </a>
      <nav>
        <button class="nav-btn" onClick={showRules}>
          生存手册
        </button>
        <button class="nav-btn" onClick={() => showBestiary()}>
          动物图鉴
        </button>
      </nav>
      <div class="top-actions">
        {view?.mode === 'solo' && <span class="mode-chip">单人练习 · {DIFFICULTY_NAME[view.difficulty]}</span>}
        {view?.mode === 'online' && (
          <>
            <span class={`connection ${connected ? 'online' : ''}`}>{connected ? '已连接' : '重连中'}</span>
            <button class="room-code" onClick={() => copyInvite(view.code)}>
              房间 {view.code}
            </button>
          </>
        )}
        {!view && link === null && (
          <span class="edition">
            荒野纪事 <b>02</b>
          </span>
        )}
        <button class="icon-button" onClick={toggleSound} aria-label={sound ? '关闭音效' : '开启音效'} aria-pressed={sound}>
          {sound ? '♫' : '♪'}
        </button>
        {link && (
          <button class="nav-btn" onClick={confirmLeave}>
            离开
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

function Banner() {
  const { banner } = useApp();
  if (!banner) return null;
  return (
    <div class="phase-banner" key={banner.id} aria-hidden="true">
      <strong>{banner.title}</strong>
      <span>{banner.detail}</span>
    </div>
  );
}

function Connecting() {
  return (
    <main class="connecting">
      <div class="panel">
        <span class="spinner" aria-hidden="true" />
        <h2>正在进入荒野…</h2>
        <p>连接房间中。若长时间没有响应，可以返回首页重试；单人练习不需要网络。</p>
        <button class="secondary" onClick={leave}>
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
      <TopBar />
      {screen === 'home' && (
        <>
          <Home />
          <HomeFooter />
        </>
      )}
      {screen === 'connecting' && <Connecting />}
      {screen === 'lobby' && <Lobby />}
      {screen === 'play' && <Play />}
      {screen === 'finished' && <Finish />}
      <Toast />
      <Banner />
      <DialogHost />
    </>
  );
}
