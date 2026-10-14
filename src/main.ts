import './style.css';
import { REGIONS, SPECIES, PHASES, species, region, type RegionId } from './data';
import type { GameView, Command } from './engine';
import { registerGameTools } from './webmcp';
import { gameUrls } from './urls';

const urls = gameUrls(location.origin, import.meta.env.BASE_URL, import.meta.env.VITE_BACKEND_ORIGIN || location.origin);

const app = document.querySelector<HTMLDivElement>('#app')!;
let game: GameView | null = null;
let session: { code: string; id: string; token: string } | null = null;
let socket: WebSocket | null = null;
let selected: RegionId = 'forest';
let connected = false;
let busy = false;
let logTab = 'clue';
let draft = '';
let recipient = 'all';
let chosenRole = '';
let reconnectTimer = 0;
let retry = 0;
let lastPhase = '';
let sound = localStorage.getItem('foodchain-sound') !== 'off';
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const avatar = (id: string, cls = '') => `<div class="animal-art ${cls}" style="--col:${SPECIES.findIndex(s => s.id === id) % 4};--row:${Math.floor(SPECIES.findIndex(s => s.id === id) / 4)}" role="img" aria-label="${species(id).name}"></div>`;
const nameOf = (id?: string) => game?.players.find(p => p.id === id)?.name || '荒野';
const btn = (text: string, action: string, cls = '', disabled = false, attrs = '') => `<button class="${cls}" data-action="${action}" ${disabled ? 'disabled' : ''} ${attrs}>${text}</button>`;
function toast(message: string) { const t = document.querySelector('#toast')!; t.textContent = message; t.classList.add('visible'); setTimeout(() => t.classList.remove('visible'), 4000); }
function chime() { if (!sound) return; try { const a = new AudioContext(); const o = a.createOscillator(); const gain = a.createGain(); o.type = 'sine'; o.frequency.value = 440; o.connect(gain); gain.connect(a.destination); gain.gain.setValueAtTime(0.035, a.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.3); o.start(); o.stop(a.currentTime + 0.3); o.onended = () => { void a.close(); }; } catch { /* sound is optional */ } }
function header() {
  return `<header class="topbar"><a class="brand" href="${urls.home}" aria-label="食物链首页"><img src="${urls.asset('favicon.svg')}" alt=""/><span>食物链<small>THE FOOD CHAIN</small></span></a><nav>${btn('生存手册', 'rules', 'nav-btn')}${btn('动物图鉴', 'animals', 'nav-btn')}</nav><div class="top-actions">${game ? `<span class="connection ${connected ? 'online' : ''}">${connected ? '已连接' : '重连中'}</span>${btn('房间 ' + game.code, 'copy', 'room-code')}` : '<span class="edition">荒野纪事 <b>01</b></span>'}${btn(sound ? '♫' : '♪', 'sound', 'icon-button', false, 'aria-label="切换音效"')}${game ? btn('离开', 'leave', 'nav-btn') : ''}</div></header>`;
}
function map(home = false) {
  const me = game?.me;
  const lines = REGIONS.flatMap((r,i) => r.adjacent.filter(a => REGIONS.findIndex(x => x.id === a) > i).map(a => { const q = region(a); return `<line x1="${r.x}" y1="${r.y}" x2="${q.x}" y2="${q.y}"/>`; })).join('');
  return `<section class="map ${home ? 'home-map' : ''}" aria-label="六地区荒野地图"><div class="map-image"></div><div class="map-shade"></div><div class="map-heading"><span class="eyebrow">THE WILDS</span><h2>${home ? '七夜荒野' : '荒野地图'}</h2><p>${home ? '在每一道足迹里，寻找生存的可能。' : esc(game?.event)}</p></div><span class="compass" aria-hidden="true">N<br>✧</span><svg class="map-paths" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>${REGIONS.map(r => {
    const traces = game?.traces[r.id];
    const current = !home && me?.location === r.id && game?.phase !== 'talk' && game?.phase !== 'drop';
    const available = game?.resources[r.id] ?? (['forest','river','meadow','shrub'].includes(r.id) ? 1 : 0);
    return `<button class="region-pin ${selected === r.id ? 'selected' : ''} ${current ? 'current' : ''}" data-region="${r.id}" style="left:${r.x}%;top:${r.y}%" aria-label="${r.name}，草食资源 ${available} 份${current ? '，你在这里' : ''}" aria-pressed="${selected === r.id}"><span class="pin-symbol">${r.icon}</span><span class="pin-label">${r.name}${current ? '<i>你在这里</i>' : ''}<small>${available ? `<b class="resource-leaf">✦</b> ${available} 份食物` : '无草食资源'}${traces ? ` · ${traces.length} 道痕迹` : ''}</small></span></button>`;
  }).join('')}<div class="map-legend"><span><i class="line-key"></i> 可通行路线</span><span><i class="dot-key"></i> ${home ? '选择地区了解地形' : '点击地区查看信息'}</span>${!home ? '<span>痕迹 ≠ 实时位置</span>' : ''}</div></section>`;
}
function home() {
  const invitation = new URLSearchParams(location.search).get('room') || '';
  return `${header()}<main class="home-layout"><div class="world-preview">${map(true)}<div class="animal-ribbon"><span>荒野居民<small>8 种隐藏身份</small></span>${SPECIES.map(s => `<button data-animal="${s.id}" aria-label="了解${s.name}">${avatar(s.id)}<span>${s.name}</span></button>`).join('')}</div></div><aside class="entry-panel"><span class="eyebrow gold">SURVIVE THE SEVENTH NIGHT</span><h1>每一个秘密，<br>都关乎生存。</h1><p class="intro">成为荒野中的一种动物。在七个回合里寻找食物、隐藏踪迹，决定该相信谁。</p><div class="game-facts"><span>8 位居民</span><span>7 个回合</span><span>多人生存博弈</span></div><label class="field-label" for="nickname">你的荒野代号</label><input id="nickname" maxlength="12" autocomplete="nickname" placeholder="给自己起一个名字" value="${esc(localStorage.getItem('foodchain-name') || '林间旅人')}"/><label class="field-label" for="practice-role">练习身份</label><select id="practice-role"><option value="">随机身份 · 保持未知</option>${SPECIES.map(s => `<option value="${s.id}" ${chosenRole === s.id ? 'selected' : ''}>${s.name} · ${s.title}</option>`).join('')}</select>${btn(busy ? '正在进入荒野…' : '开始单人练习 <span>↗</span>', 'solo', 'primary large', busy)}<p class="under-button">与 7 位电脑玩家对局 · 随时推进回合</p><div class="divider"><span>和朋友一起</span></div>${btn('创建联机房间', 'create', 'secondary large', busy)}<form id="join-form" class="join-form"><input id="room-input" aria-label="六位房间码" maxlength="6" placeholder="输入 6 位房间码" value="${esc(invitation)}" pattern="[A-Za-z0-9]{6}" required/><button class="secondary" ${busy ? 'disabled' : ''}>加入</button></form><div class="entry-note"><span>◇</span><p>身份只有你知道。<br>活到第七夜，即为生存赢家。</p></div></aside></main><footer class="page-footer"><span>食物链 · 荒野生存博弈</span><span>戴上耳机，与荒野保持联系</span><button data-action="rules">第一次来？阅读生存手册 ↗</button></footer>`;
}
function lobby() {
  return `${header()}<main class="lobby-layout">${map(true)}<aside class="entry-panel"><span class="eyebrow gold">BEFORE THE FIRST NIGHT</span><h1>等待同伴入林</h1><p class="intro">分享房间码邀请朋友。未满的席位会在开始时由电脑玩家补齐。</p><button class="invite-code" data-action="copy" aria-label="复制邀请链接">${esc(game!.code)} <small>点击复制邀请链接 ↗</small></button><div class="lobby-players">${Array.from({ length: 8 },(_,i) => { const p = game!.players[i]; return `<div><span class="seat-number">${String(i + 1).padStart(2,'0')}</span><strong>${p ? esc(p.name) : '等待加入'}</strong><small>${p ? p.bot ? '电脑' : p.id === game!.host ? '房主' : '玩家' : '空席'}</small></div>`; }).join('')}</div>${game!.host === session!.id ? btn('开始七夜旅程', 'start', 'primary large', !connected) : '<p class="wait-text">等待房主开始游戏…</p>'}<p class="under-button">进入后随机分配身份 · 最多 8 人</p></aside></main>`;
}
function character() {
  const p = game!.me!; const s = species(p.animal);
  return `<section class="character-card"><div class="character-portrait">${avatar(s.id)}<span class="secret-label">◇ 仅你可见</span><div class="identity-caption"><span>${s.title}</span><h2>${s.name}</h2></div></div><div class="character-body"><div class="stat-label"><span class="hp">♥ 生命</span><strong>${p.hp}<small> / ${s.hp}</small></strong></div><div class="stat-track hp">${Array.from({length:s.hp},(_,i)=>`<i class="${i < p.hp ? 'filled' : ''}"></i>`).join('')}</div><div class="stat-label"><span class="sp">ϟ 体力</span><strong>${p.sp}<small> / ${s.sp}</small></strong></div><div class="stat-track sp">${Array.from({length:s.sp},(_,i)=>`<i class="${i < p.sp ? 'filled' : ''}"></i>`).join('')}</div><div class="hunger"><span>饥饿周期</span><b>${p.fed ? '本回合已进食' : `${p.hunger} / ${s.hunger} 回合`}</b></div><div class="skill-description"><span>${s.skill} <small>· 1 SP</small></span><p>${s.skillText}</p></div><p class="diet">${s.diet === 'hunt' ? '可捕食：' + s.prey.map(id=>species(id).name).join('、') : s.diet === 'scavenge' ? '食腐 +4 SP · 采食 +2 SP' : '地图采食 +3 SP'}</p></div></section>`;
}
function roster() {
  return `<section class="roster"><div class="section-title"><h3>荒野居民</h3><span>${game!.players.filter(p => p.alive).length} / 8 存活</span></div>${game!.players.map(p => `<button class="player-row ${p.id === session!.id ? 'self' : ''} ${!p.alive ? 'dead' : ''}" data-player="${p.id}" aria-label="查看 ${esc(p.name)} 的信息"><span class="seat-number">${String(p.seat).padStart(2,'0')}</span><span class="player-info"><b>${esc(p.name)} ${p.id === session!.id ? '<small>你</small>' : ''}</b><small>${p.animal ? species(p.animal).name : '身份未知'}${p.bot ? ' · 电脑' : ''}${p.drop ? ` · 投放${region(p.drop).short}` : ''}</small></span><span class="ready-symbol">${!p.alive ? '†' : p.ready ? '✓' : '·'}</span></button>`).join('')}</section>`;
}
function phaseStrip() {
  const current = PHASES.findIndex(p => p.id === game!.phase);
  return `<div class="round-bar"><div class="round-count"><span>ROUND</span><b>${String(game!.round).padStart(2,'0')}</b><small>/ 07</small></div><div class="phase-strip">${PHASES.map((p,i)=>`<div class="phase ${i === current ? 'active' : i < current ? 'done' : ''}"><i>${i < current ? '✓' : String(i+1).padStart(2,'0')}</i><span>${p.name}</span></div>`).join('')}</div><div class="phase-timer" id="timer">${game!.deadline ? '—' : '自由推进'}</div></div>`;
}
function actionPanel() {
  const g = game!; const p = g.me!; const s = species(p.animal); const r = region(selected);
  const phase = PHASES.find(x => x.id === g.phase)!;
  const disabled = !p.alive || p.ready || !connected;
  let controls = '';
  if (g.phase === 'talk') controls = `<div class="voice-card"><span class="voice-orb">◉</span><div><strong>公共语音营地</strong><small>${g.players.filter(p=>p.voice).length} 人参与 · 90 秒 · 不录音、不转写</small></div>${btn(p.voice ? '离开语音' : '加入语音', 'voice', 'secondary', disabled)}</div>`;
  if (g.phase === 'drop') controls = `<div class="decision-line"><div><small>当前选择</small><strong>${p.drop ? region(p.drop).name : '尚未选择地区'}</strong></div>${btn('投放到' + r.short, 'drop', 'secondary', disabled)}</div>`;
  if (g.phase === 'action') controls = `<div class="action-buttons">${btn('↗ 移动到' + r.short, 'move', 'secondary', disabled || p.actions === 0 || !(region(p.location).adjacent as readonly string[]).includes(selected))}${btn('◇ 躲藏', 'hide', 'secondary', disabled || p.actions === 0)}${btn('◈ ' + s.skill, 'skill', 'secondary', disabled || p.actions === 0 || p.skillUsed)}${btn('≋ 尖叫', 'scream', 'secondary', disabled || p.actions === 0)}</div><p class="action-cost">剩余 ${p.actions} 次行动 · 每次 1 SP ${p.sp === 0 ? '<b class="danger">· 再行动将透支 1 HP</b>' : ''}${s.id === 'crow' ? ' · 俯瞰目标：' + r.name : s.id === 'rabbit' ? ' · 疾跃前请先选择相邻地区' : ''}</p>`;
  if (g.phase === 'traces') controls = `<div class="trace-detail"><span class="trace-icon">⌁</span><div><strong>${r.name}的痕迹</strong><p>${g.traces[selected] === null ? '超出视野。移动到附近，或利用渡鸦的俯瞰能力。' : g.traces[selected]?.length ? g.traces[selected]!.map(id => esc(nameOf(id))).join('、') + ' 曾在这里经过。' : '没有发现足迹，也可能有人抹除了痕迹。'}</p></div></div>`;
  if (g.phase === 'call') {
    const caller = g.players[g.callIndex]; const call = g.call;
    controls = `<div class="call-panel"><strong>${call ? `${esc(nameOf(call.from))} → ${esc(nameOf(call.to))}` : `轮到 ${esc(caller?.name)} 选择通话`}</strong><p>${call?.accepted ? '通话中 · 30 秒 · 不录音、不转写' : call ? '等待对方接受。拒绝不消耗通话机会。' : '每人每回合仅一次；成功接通后，双方机会均被消耗。'}</p>${call ? call.to === p.id && !call.accepted ? `${btn('接受通话', 'accept-call', 'primary')}${btn('婉拒', 'reject-call', 'secondary')}` : [call.from,call.to].includes(p.id) ? btn('结束通话', 'hangup', 'secondary') : '' : caller?.id === p.id ? `<select id="call-target" aria-label="通话对象"><option value="">选择通话对象</option>${g.players.filter(q => !q.bot && q.id !== p.id && q.alive && !q.called).map(q => `<option value="${q.id}">${esc(q.name)}</option>`).join('')}</select>${btn('邀请通话', 'call', 'secondary')}` : ''}</div>`;
  }
  if (g.phase === 'food') {
    const choices = s.diet === 'hunt' ? [['hunt','捕食','命中后 +3 SP']] : s.diet === 'scavenge' ? [['scavenge','食腐','遗骸 +4 SP'],['forage','采食','草食 +2 SP']] : [['forage','采食','草食 +3 SP']];
    choices.push(['skip','放弃进食','不消耗体力']);
    controls = `<div class="food-choices">${choices.map(([id,label,desc]) => `<button data-food="${id}" class="food-choice ${p.food === id ? 'chosen' : ''}" ${disabled ? 'disabled' : ''}><strong>${label}</strong><small>${desc}</small></button>`).join('')}</div>${s.diet === 'hunt' ? `<select id="hunt-target" aria-label="捕食目标" ${disabled ? 'disabled' : ''}><option value="">机会捕食 · 随机命中同地区可捕食对象</option>${g.players.filter(q=>q.id !== p.id && q.alive).map(q=>`<option value="${q.id}" ${p.target === q.id ? 'selected' : ''}>指定 ${esc(q.name)}</option>`).join('')}</select>` : ''}<p class="action-cost">${s.diet === 'hunt' ? '躲藏不影响捕食。指定目标不在食谱中会落空。' : `本地区草食剩余 ${g.resources[p.location]} 份，遗骸 ${g.bodies.filter(b=>b.location===p.location).length} 份。`} 行动即消耗 1 SP 并向同地区玩家暴露。</p>`;
  }
  if (g.phase === 'settle') controls = `<div class="settlement-summary"><div><span>${p.fed ? '✦' : '◌'}</span><strong>${p.fed ? '本回合成功进食' : '本回合未进食'}</strong></div><p>${p.alive ? `你仍然活着。剩余 ${p.hp} HP、${p.sp} SP。` : '你已离开食物链，可以继续推进并观察最终结局。'}${g.round === 7 ? '下一步揭晓全部身份与得分。' : '查看右侧记录，为下一回合做好准备。'}</p></div>`;
  const canReady = !connected || (p.alive && p.ready) || (p.alive && g.phase === 'drop' && !p.drop) || (p.alive && g.phase === 'food' && !p.food) || (g.phase === 'call' && (g.players[g.callIndex]?.id !== p.id || !!g.call));
  const readyText = !p.alive ? '继续观战 →' : p.ready ? '已准备 · 等待其他玩家' : g.phase === 'drop' ? '锁定投放 →' : g.phase === 'food' ? '锁定食物行动 →' : g.phase === 'settle' ? g.round === 7 ? '查看最终结算 →' : '进入下一回合 →' : g.phase === 'call' ? '跳过通话 →' : g.phase === 'action' ? '结束行动 →' : '我准备好了 →';
  return `<section class="action-panel"><div class="action-heading"><div><span class="eyebrow">${String(PHASES.findIndex(x=>x.id===g.phase)+1).padStart(2,'0')} / YOUR NEXT MOVE</span><h2>${phase.name}</h2></div><span class="location-chip">⌖ ${region(p.location).name}</span></div><p class="phase-hint">${!p.alive ? '你已进入观战，无法再行动或交流。' : phase.hint}</p>${p.alive ? controls : ''}<div class="action-footer"><span>${g.mode === 'solo' ? '练习模式 · 由你掌握节奏' : '全部准备或倒计时结束后推进'}</span>${btn(readyText, 'ready', 'primary', canReady)}</div></section>`;
}
function messages() {
  const g = game!; const p = g.me!;
  const logs = g.log.filter(l => logTab === 'chat' ? ['public','private'].includes(l.kind) : !['public','private'].includes(l.kind));
  return `<aside class="message-panel"><div class="message-tabs"><button data-logtab="clue" class="${logTab==='clue'?'active':''}">观察记录</button><button data-logtab="chat" class="${logTab==='chat'?'active':''}">消息往来</button></div><div class="log-feed" id="log-feed" role="log" aria-live="polite">${logs.length ? logs.map(l=>`<article class="log-entry ${l.kind}"><div><span>${l.kind==='private' ? `${esc(nameOf(l.from))} → ${esc(nameOf(l.to))}` : l.kind==='public' ? esc(nameOf(l.from)) + ' · 公开' : l.kind==='clue' ? '局部线索' : '荒野记录'}</span><small>R${l.round}</small></div><p>${esc(l.text)}</p></article>`).join('') : '<div class="empty-log"><span>⌁</span><p>荒野暂时安静。<br>每一次行动都会留下信息。</p></div>'}</div><form id="message-form" class="message-compose"><div class="compose-meta"><label for="recipient">发送给</label><select id="recipient"><option value="all" ${recipient==='all'?'selected':''}>所有人 · 公开</option>${g.players.filter(q=>q.id !== p.id && q.alive).map(q=>`<option value="${q.id}" ${recipient===q.id?'selected':''}>${esc(q.name)} · 私信</option>`).join('')}</select></div><textarea id="message-text" rows="2" placeholder="一句真话，或一个试探…" aria-label="消息内容" ${!p.alive?'disabled':''}>${esc(draft)}</textarea><div class="compose-footer"><small>公开 ${1-p.publicCount}/1 · 私信 ${5-p.privateCount}/5</small><button class="send-button" ${!p.alive || !connected ? 'disabled' : ''}>发送 ↗</button></div></form><div class="privacy-note">书面消息留存于本局。赤狐可能窃听私信。</div></aside>`;
}
function finishView() {
  const g = game!; const p = g.me!;
  const ranking = [...g.players].sort((a,b)=>(Number(b.alive)-Number(a.alive)) || (b.score!-a.score!));
  return `${header()}<main class="end-screen"><span class="eyebrow gold">AFTER THE SEVENTH NIGHT</span><h1>${p.alive ? '你听见了第八日的风。' : '荒野记得你的足迹。'}</h1><p>${p.alive ? '你成功活过七个回合，获得生存胜利。' : '你未能活到最后。每一次选择，都为下一次生存留下了经验。'}</p><div class="end-score">${avatar(p.animal)}<div><small>你的身份 · ${species(p.animal).name}</small><strong>${p.score} <span>分</span></strong><p>${p.meals} 次进食 · ${p.hunts} 次成功捕食</p></div></div><div class="ranking"><div class="ranking-head"><span>席位 / 玩家</span><span>真实身份</span><span>结局</span><span>得分</span></div>${ranking.map(q=>`<div class="ranking-row ${q.id===p.id?'self':''}"><span><b>${String(q.seat).padStart(2,'0')}</b> ${esc(q.name)}${q.id===p.id?' · 你':''}</span><span>${species(q.animal!).name}</span><span class="${q.alive?'survived':'muted'}">${q.alive?'生存胜利':'离开荒野'}</span><strong>${q.score}</strong></div>`).join('')}</div><p class="score-rule">得分 = 存活 10 + 剩余 HP ×2 + 进食 ×2 + 捕食 ×3 + 推理正确 ×2 − 推理错误（最低 0）</p><div class="end-actions">${btn('再入荒野', 'leave', 'primary')}${btn('下载本局复盘', 'download', 'secondary')}${btn('查看观察记录', 'review', 'secondary')}</div></main>`;
}
function render() {
  const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  const focusId = active?.id; const caret = active?.selectionStart;
  const oldScroll = document.querySelector('#log-feed')?.scrollTop ?? 99999;
  app.innerHTML = !game ? home() : game.phase === 'lobby' ? lobby() : game.phase === 'finished' ? finishView() : `${header()}<main class="play-layout">${phaseStrip()}<aside class="left-sidebar">${character()}${roster()}</aside><div class="center-stage">${map()}${actionPanel()}</div>${messages()}</main>`;
  if (focusId) { const input = document.getElementById(focusId) as HTMLInputElement; if (input) { input.focus({preventScroll:true}); if (caret != null && ['text','textarea'].includes(input.type)) input.setSelectionRange(caret,caret); } }
  const feed = document.querySelector('#log-feed'); if (feed) feed.scrollTop = oldScroll > 0 ? 99999 : oldScroll;
  updateTimer();
}
function updateTimer() { const el = document.querySelector('#timer'); if (el && game) { const secs = game.deadline ? Math.max(0,Math.ceil((game.deadline-Date.now())/1000)) : 0; el.textContent = game.deadline ? `${String(Math.floor(secs/60)).padStart(2,'0')}:${String(secs%60).padStart(2,'0')}` : '自由推进'; el.classList.toggle('urgent',!!game.deadline && secs<=10); } }
setInterval(updateTimer, 1000);
function send(cmd: Command) { if (socket?.readyState !== WebSocket.OPEN) { toast('正在重新连接，请稍候。'); return; } socket.send(JSON.stringify(cmd)); }
async function api(path: string, data: object) { const res = await fetch(urls.api(path),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)}); const body = await res.json() as {code:string;id:string;token:string;error?:string}; if (!res.ok) throw Error(body.error || '暂时无法连接，请稍后重试。'); return body; }
async function enter(mode: 'solo'|'online'|'join', code?: string) {
  if (busy) return;
  const name = (document.querySelector<HTMLInputElement>('#nickname')?.value || '林间旅人').trim();
  localStorage.setItem('foodchain-name',name);
  chosenRole = document.querySelector<HTMLSelectElement>('#practice-role')?.value || '';
  busy = true; render();
  try { session = await api(mode==='join' ? `/api/rooms/${code?.toUpperCase()}/join` : '/api/rooms',{name,mode}); sessionStorage.setItem('foodchain-session',JSON.stringify(session)); history.replaceState(null,'',`?room=${session!.code}`); connect(mode==='solo'); }
  catch(e) { toast((e as Error).message); } finally { busy=false; render(); }
}
function connect(autoStart = false) {
  if (!session) return;
  clearTimeout(reconnectTimer);
  const ws = new WebSocket(urls.socket(session.code, session.id, session.token)); socket=ws;
  ws.onopen = () => { if(socket!==ws)return;connected=true; retry=0; render(); if(autoStart) send({type:'start',animal:chosenRole}); };
  ws.onmessage = e => { if(socket!==ws)return;try { const message = JSON.parse(e.data); if(message.type==='state') { game=message.state; const phaseChanged=lastPhase!==`${game!.round}:${game!.phase}`;if(phaseChanged) { if(lastPhase) chime(); lastPhase=`${game!.round}:${game!.phase}`; if(game!.me) selected=game!.me!.location; } render();if(phaseChanged&&game!.phase==='finished')window.scrollTo({top:0,behavior:'instant'}); void syncVoice(); } else if(message.type==='error') toast(message.message); else if(message.type==='signal') void receiveSignal(message.from,message.signal); } catch { toast('收到异常数据，正在重新同步。'); } };
  ws.onclose = e => { if (socket!==ws) return; connected=false; stopVoice(); render(); if(e.code===4001 || e.code===4004) { toast(e.reason || '会话已失效，请重新加入。'); return; } if(session) reconnectTimer=window.setTimeout(()=>connect(),Math.min(15000,1000*2**retry++)); };
  ws.onerror=()=>{ connected=false; };
}
function leave() { if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'leave'}));socket?.close(); socket=null; session=null; game=null; connected=false; lastPhase=''; clearTimeout(reconnectTimer); sessionStorage.removeItem('foodchain-session'); history.replaceState(null,'',urls.home); stopVoice(); render();window.scrollTo({top:0,behavior:'instant'}); }
function dialog(title: string, content: string) {
  document.querySelector('dialog')?.remove(); const d=document.createElement('dialog'); d.innerHTML=`<div class="dialog-top"><h2>${title}</h2><button aria-label="关闭" class="icon-button">×</button></div><div class="dialog-content">${content}</div>`;document.body.append(d);d.querySelector('button')!.onclick=()=>d.close();d.addEventListener('click',e=>{if(e.target===d)d.close();});d.addEventListener('close',()=>d.remove());d.showModal();
}
function rules() { dialog('生存手册', `<p class="dialog-intro">七个回合后，所有仍存活的动物共同获得生存胜利。你的动物身份只对自己可见，死亡或终局时才揭晓。</p><div class="rule-grid"><section><h3>01 · 生存资源</h3><p>生命归零即死亡。食物只恢复体力，绝不恢复生命。体力为 0 时继续行动：失去 1 HP，体力恢复至上限的一半（向上取整），再支付本次 1 SP。若因此死亡，行动失败。</p></section><section><h3>02 · 七段回合</h3><p>90 秒交流 → 秘密投放 → 2 次行动 → 痕迹观察 → 依次通话 → 食物获取 → 饥饿结算。联机全员准备可提前推进，倒计时结束也会推进。单人练习由你控制节奏。</p></section><section><h3>03 · 痕迹与位置</h3><p>初始投放在全员锁定后公开，后续移动只留下出发地与目的地的痕迹。你只能查看当前及相邻地区。躲藏消除当前地区足迹，但不能抵挡捕食。痕迹每回合清空。</p></section><section><h3>04 · 食物与饥饿</h3><p>每回合有 4 / 3 / 2 份草食资源（第 1–2 / 3–5 / 6–7 回合）。获取食物消耗 1 SP，无论成败，只向同地区玩家暴露行动者。按席位轮换先手结算。灰狼每 1 回合未进食扣 1 HP，渡鸦每 3 回合，其他动物每 2 回合；达到周期后每回合继续扣 1 HP，只有进食才能重置饥饿。</p></section><section><h3>05 · 捕食与遗骸</h3><p>捕食只能命中同地区、食谱中的动物，灰狼伤害为 2，其他捕食者为 1。机会捕食随机选一个合格目标，指定目标不满足条件就落空。命中即进食，无需击杀。死亡产生一份遗骸，保留到之后第 2 回合结束。</p></section><section><h3>06 · 交流与秘密</h3><p>每回合可发送 5 条私信、1 条公开消息，每条最多 50 字，额度不累积。赤狐能读取涉及同地区玩家的一条历史私信。公共语音自愿参加，不录音、不转写；未加入者无法听见。私下通话按席位发起，接受后双方各用一次机会，通话 30 秒。电脑玩家不参与语音。</p></section><section><h3>07 · 推理笔记</h3><p>点击玩家为其身份做标记。只有你能看见，七回合结算时每个正确判断 +2 分、错误 −1 分。死亡后不能修改。分数用于比较表现，存活本身就是胜利。</p></section><section><h3>08 · 断线与观战</h3><p>同一标签页刷新会重新连接。联机超时未投放将自动选择地区，未选进食则放弃。死亡玩家仍只看到自己的局部线索，无法行动、发言或语音。房间与文字记录保留 24 小时后清除。</p></section></div><p class="rule-note">本版已补全原始设计中留空的动物、地图、战斗、通话和胜利数值。联网语音采用浏览器点对点连接；网络阻止连接时仍可使用书面消息。</p>`); }
function animals(id?:string) { dialog(id ? species(id).name : '动物图鉴', `<div class="animal-grid">${SPECIES.filter(s=>!id || s.id===id).map(s=>`<article>${avatar(s.id)}<h3>${s.name}<small>${s.title}</small></h3><p>HP ${s.hp} · SP ${s.sp} · 饥饿 ${s.hunger} 回合</p><b>${s.skill}</b><p>${s.skillText}</p><small>${s.diet==='hunt'?'食谱：'+s.prey.map(a=>species(a).name).join('、'):s.diet==='scavenge'?'遗骸恢复 4 SP，草食恢复 2 SP。':'草食恢复 3 SP。'}</small></article>`).join('')}</div>`); }
function playerInfo(id:string) { const p=game!.players.find(p=>p.id===id)!; const own=game!.me!; dialog(`${p.seat} 号 · ${esc(p.name)}`, `<p>${p.animal?'已知身份：'+species(p.animal).name:'他的身份仍然未知。结合痕迹、进食与交流，记下你的判断。'}</p>${p.drop?`<p>本回合公开投放：${region(p.drop).name}。他之后可能已经移动。</p>`:''}${p.id!==own.id && p.alive && own.alive ? `<label class="field-label" for="guess">我的身份推理 · 仅你可见</label><select id="guess"><option value="">暂不判断</option>${SPECIES.map(s=>`<option value="${s.id}" ${own.guesses[id]===s.id?'selected':''}>${s.name}</option>`).join('')}</select><p class="muted">最终正确 +2 分，错误 −1 分。</p>`:''}`);document.querySelector('#guess')?.addEventListener('change',e=>send({type:'guess',target:id,animal:(e.target as HTMLSelectElement).value})); }
app.addEventListener('click',e=>{
  if((e.target as HTMLElement).closest('a.brand')&&game){e.preventDefault();app.querySelector<HTMLButtonElement>('[data-action="leave"]')?.click();return;}
  const el=(e.target as HTMLElement).closest<HTMLElement>('button');if(!el || el.hasAttribute('disabled'))return;
  if(el.dataset.region){selected=el.dataset.region as RegionId;render();return;}
  if(el.dataset.animal){animals(el.dataset.animal);return;}
  if(el.dataset.player){playerInfo(el.dataset.player);return;}
  if(el.dataset.logtab){logTab=el.dataset.logtab;render();document.querySelector('#log-feed')?.scrollTo(0,99999);return;}
  if(el.dataset.food){send({type:'food',choice:el.dataset.food,target:document.querySelector<HTMLSelectElement>('#hunt-target')?.value});return;}
  const action=el.dataset.action;
  if(action==='solo'||action==='create'){void enter(action==='solo'?'solo':'online');return;}
  if(action==='rules')rules();if(action==='animals')animals();if(action==='leave'){
    if(game && game.phase!=='finished' && game.phase!=='lobby'){dialog('离开这场对局？','<p>离开后这局仍会继续。你可以留在此页继续游戏，或返回首页开始新对局。</p><button class="primary" id="confirm-leave">返回首页</button>');document.querySelector('#confirm-leave')!.addEventListener('click',()=>{document.querySelector('dialog')?.close();leave();});}else leave();
  }
  if(action==='copy')void navigator.clipboard.writeText(urls.invite(game!.code)).then(()=>toast('邀请链接已复制，发给朋友即可加入。')).catch(()=>toast(`房间码：${game!.code}`));
  if(action==='sound'){sound=!sound;localStorage.setItem('foodchain-sound',sound?'on':'off');render();if(sound)chime();}
  if(action==='start'||action==='ready'||action==='hide'||action==='scream'||action==='hangup')send({type:action});
  if(action==='drop'||action==='move'||action==='skill')send({type:action,region:selected});
  if(action==='call')send({type:'call',target:document.querySelector<HTMLSelectElement>('#call-target')?.value});
  if(action==='accept-call')void startMicrophone().then(()=>send({type:'call-answer',accept:true})).catch(err=>toast(err.message));
  if(action==='reject-call')send({type:'call-answer',accept:false});
  if(action==='voice') { if(game!.me!.voice){send({type:'voice',joined:false});stopVoice();}else void startMicrophone().then(()=>send({type:'voice',joined:true})).catch(err=>toast(err.message)); }
  if(action==='review')dialog('本局观察记录',game!.log.map(l=>`<article class="log-entry"><small>第 ${l.round} 回合 · ${l.kind==='private'?'私信':l.kind==='public'?'公开消息':'观察记录'}</small><p>${esc(l.text)}</p></article>`).join(''));
  if(action==='download'){const blob=new Blob([JSON.stringify({game:'食物链',room:game!.code,players:game!.players,observations:game!.log},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`食物链-${game!.code}-复盘.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
});
app.addEventListener('submit',e=>{e.preventDefault();if((e.target as HTMLElement).id==='join-form')void enter('join',document.querySelector<HTMLInputElement>('#room-input')!.value.trim());if((e.target as HTMLElement).id==='message-form'){if(!draft.trim())return;if([...draft.trim()].length>50){toast('消息最多 50 个字。');return;}send({type:'message',target:recipient,text:draft});draft='';logTab='chat';render();}});
app.addEventListener('input',e=>{if((e.target as HTMLElement).id==='message-text')draft=(e.target as HTMLTextAreaElement).value;});
app.addEventListener('change',e=>{const t=e.target as HTMLSelectElement;if(t.id==='recipient')recipient=t.value;if(t.id==='hunt-target'&&game?.me?.food==='hunt')send({type:'food',choice:'hunt',target:t.value});if(t.id==='practice-role')chosenRole=t.value;});

// Voice is peer-to-peer. Only SDP/ICE signaling passes through the server; no audio is recorded.
let mic: MediaStream | null = null;
const peers = new Map<string,RTCPeerConnection>();
const remoteAudio = new Map<string,HTMLAudioElement>();
const pendingIce = new Map<string,RTCIceCandidateInit[]>();
async function startMicrophone() { if(!navigator.mediaDevices?.getUserMedia)throw Error('当前浏览器不支持麦克风，请使用最新版浏览器并通过 HTTPS 打开。');if(!mic){try{mic=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});}catch{throw Error('无法使用麦克风。请允许麦克风权限，或继续使用书面消息。');}} }
function closePeer(id:string){peers.get(id)?.close();peers.delete(id);remoteAudio.get(id)?.remove();remoteAudio.delete(id);pendingIce.delete(id);}
function stopVoice(){for(const id of peers.keys())closePeer(id);mic?.getTracks().forEach(t=>t.stop());mic=null;}
function voicePartners():string[]{if(!game?.me || !game.me.alive)return[];if(game.phase==='talk'&&game.me.voice)return game.players.filter(p=>p.voice&&p.id!==session?.id&&p.alive).map(p=>p.id);const c=game.call;if(game.phase==='call'&&c?.accepted&&[c.from,c.to].includes(session!.id))return[c.from===session!.id?c.to:c.from];return[];}
function signal(id:string,data:object){socket?.send(JSON.stringify({type:'signal',target:id,signal:data}));}
function newPeer(id:string){const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.cloudflare.com:3478'},{urls:'stun:stun.l.google.com:19302'}]});peers.set(id,pc);mic?.getTracks().forEach(t=>pc.addTrack(t,mic!));pc.onicecandidate=e=>{if(e.candidate)signal(id,{candidate:e.candidate.toJSON()});};pc.ontrack=e=>{let a=remoteAudio.get(id);if(!a){a=document.createElement('audio');a.autoplay=true;document.body.append(a);remoteAudio.set(id,a);}a.srcObject=e.streams[0];void a.play().catch(()=>toast('请点击页面允许播放语音。'));};pc.onconnectionstatechange=()=>{if(pc.connectionState==='failed')toast('语音未能穿透当前网络，请使用书面消息。');};return pc;}
async function syncVoice(){const partners=voicePartners();for(const id of peers.keys())if(!partners.includes(id))closePeer(id);const participating=game?.phase==='talk'&&game.me?.voice||game?.phase==='call'&&game.call?.accepted&&[game.call.from,game.call.to].includes(session?.id||'');if(!participating){stopVoice();return;}if(!mic){try{await startMicrophone();}catch(e){toast((e as Error).message);return;}}for(const id of partners){if(!peers.has(id)&&session!.id<id){const pc=newPeer(id);try{await pc.setLocalDescription(await pc.createOffer());signal(id,{description:pc.localDescription});}catch{closePeer(id);}}}}
async function receiveSignal(id:string,data:{description?:RTCSessionDescriptionInit;candidate?:RTCIceCandidateInit}){if(!voicePartners().includes(id))return;try{await startMicrophone();let pc=peers.get(id);if(!pc)pc=newPeer(id);if(data.description){await pc.setRemoteDescription(data.description);for(const candidate of pendingIce.get(id)||[])await pc.addIceCandidate(candidate);pendingIce.delete(id);if(data.description.type==='offer'){await pc.setLocalDescription(await pc.createAnswer());signal(id,{description:pc.localDescription});}}else if(data.candidate){if(pc.remoteDescription)await pc.addIceCandidate(data.candidate);else pendingIce.set(id,[...(pendingIce.get(id)||[]),data.candidate]);}}catch{toast('语音连接暂未建立，可以继续使用书面消息。');}}
window.addEventListener('beforeunload',()=>stopVoice());
try{session=JSON.parse(sessionStorage.getItem('foodchain-session')||'null');}catch{sessionStorage.removeItem('foodchain-session');}
render();if(session)connect();
registerGameTools(()=>game,id=>{selected=id as RegionId;render();});
