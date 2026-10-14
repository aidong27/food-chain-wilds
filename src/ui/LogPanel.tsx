import { Fragment } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { RULES } from '../game/data';
import type { GameView, ViewEntry } from '../game/view';
import { send, setChatOpen, toast, useApp } from '../client/store';
import { PlayerFace, RoundDivider, byRound, entryTone, playerById, seatName } from './common';
import { Icon, entryIcon } from './icons';

const QUICK = ['你是什么动物？', '你今晚去哪？', '你觉得谁是捕食者？', '我是…'];

const isChat = (l: ViewEntry) => l.kind === 'public' || l.kind === 'private';

/** Keeps a feed on its newest line unless the reader scrolled up on purpose. */
function usePinnedScroll(count: number, active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [count, active]);
  const onScroll = (e: Event) => {
    const el = e.currentTarget as HTMLDivElement;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  return { ref, onScroll, pin: () => void (pinned.current = true) };
}

function Bubble({ view, entry: l }: { view: GameView; entry: ViewEntry }) {
  const me = view.me!;
  const mine = l.from === me.id;
  const from = playerById(view, l.from);
  const priv = l.kind === 'private';
  const head = mine
    ? priv
      ? `私信 → ${seatName(view, l.to)}`
      : '你 · 公开'
    : `${seatName(view, l.from)}${priv ? (l.to === me.id ? ' · 私信给你' : ` → ${seatName(view, l.to)}`) : ''}`;
  return (
    <article class={`bubble ${l.kind} ${mine ? 'mine' : ''}`}>
      {!mine && from && <PlayerFace view={view} player={from} />}
      <div class="bubble-body">
        <header>
          {priv && <Icon name="private" size={11} />}
          {head}
        </header>
        <p>{l.text}</p>
      </div>
    </article>
  );
}

export function ChatPanel({ view, active }: { view: GameView; active: boolean }) {
  const { connected } = useApp();
  const me = view.me!;
  const entries = view.log.filter(isChat);
  const feed = usePinnedScroll(entries.length, active);
  const [draft, setDraft] = useState('');
  const [recipient, setRecipient] = useState('all');
  const text = useRef<HTMLTextAreaElement>(null);
  const living = view.players.filter(q => q.id !== me.id && q.alive);

  useEffect(() => {
    if (!active) return;
    setChatOpen(true);
    return () => setChatOpen(false);
  }, [active]);

  useEffect(() => {
    if (recipient !== 'all' && !living.some(q => q.id === recipient)) setRecipient('all');
  }, [living.length]);

  // Drafts handed over from elsewhere, e.g. the tutorial; nothing is sent until you press send.
  useEffect(() => {
    const fill = (e: Event) => {
      const { to, text: draft } = (e as CustomEvent<{ to: string; text: string }>).detail;
      setRecipient(to);
      setDraft(draft);
    };
    window.addEventListener('compose', fill);
    return () => window.removeEventListener('compose', fill);
  }, []);

  const submit = () => {
    const message = draft.trim();
    if (!message) return;
    if ([...message].length > RULES.messageLength) return toast(`消息最多 ${RULES.messageLength} 个字。`);
    // Keep the draft when the quota is already spent, instead of losing it to a server error.
    if (recipient === 'all' && me.publicCount >= RULES.publicMessages) return toast('本回合公开消息额度已用完，可以改发私信。');
    if (recipient !== 'all' && me.privateCount >= RULES.privateMessages) return toast(`本回合 ${RULES.privateMessages} 条私信已用完。`);
    send({ type: 'message', target: recipient, text: message });
    setDraft('');
    feed.pin();
  };

  const left = recipient === 'all' ? RULES.publicMessages - me.publicCount : RULES.privateMessages - me.privateCount;
  const quota = recipient === 'all' ? `公开 ${left}/${RULES.publicMessages}` : `私信 ${left}/${RULES.privateMessages}`;
  const length = [...draft.trim()].length;

  return (
    <div class="tab-body chat-body" hidden={!active} role="tabpanel" aria-label="消息往来" data-tut="chat">
      <div class="feed" ref={feed.ref} onScroll={feed.onScroll} role="log" aria-live="polite">
        {entries.length ? (
          byRound(entries).map(group => (
            <Fragment key={group.round}>
              <RoundDivider round={group.round} />
              {group.entries.map(l => (
                <Bubble key={l.id} view={view} entry={l} />
              ))}
            </Fragment>
          ))
        ) : (
          <div class="empty-feed">
            <Icon name="public" size={28} />
            <p>
              营地里还很安静。
              <br />
              先开口，或者问问别人是什么动物。
            </p>
          </div>
        )}
      </div>
      <form
        class="composer"
        data-tut="composer"
        onSubmit={e => {
          e.preventDefault();
          submit();
        }}
      >
        <div class="composer-top">
          <label class="sr-only" for="recipient">
            发送给
          </label>
          <select id="recipient" value={recipient} onChange={e => setRecipient((e.target as HTMLSelectElement).value)}>
            <option value="all">所有人 · 公开</option>
            {living.map(q => (
              <option key={q.id} value={q.id}>
                {q.seat}号 {q.name} · 私信
              </option>
            ))}
          </select>
          <span class={`quota ${left <= 0 ? 'spent' : ''}`}>{quota}</span>
        </div>
        <div class="quick">
          {QUICK.map(q => (
            <button
              type="button"
              key={q}
              disabled={!me.alive}
              onClick={() => {
                setDraft(q === '我是…' ? '我是' : q);
                text.current?.focus();
              }}
            >
              {q}
            </button>
          ))}
        </div>
        <div class="composer-input">
          <textarea
            id="message-text"
            ref={text}
            rows={1}
            placeholder={me.alive ? '一句真话，或一个试探…' : '观战中无法发言'}
            aria-label="消息内容"
            disabled={!me.alive}
            value={draft}
            onInput={e => setDraft((e.target as HTMLTextAreaElement).value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button class="send-btn" aria-label="发送" disabled={!me.alive || !connected || !draft.trim()}>
            <Icon name="send" size={19} />
          </button>
        </div>
        <div class="composer-foot">
          <span>书面消息留存于本局，赤狐可能窃听私信。</span>
          <span class={length > RULES.messageLength ? 'quota spent' : ''}>
            {length}/{RULES.messageLength}
          </span>
        </div>
      </form>
    </div>
  );
}

export function JournalPanel({ view, active }: { view: GameView; active: boolean }) {
  const entries = view.log.filter(l => !isChat(l));
  const feed = usePinnedScroll(entries.length, active);
  return (
    <div class="tab-body" hidden={!active} role="tabpanel" aria-label="观察记录">
      <div class="feed" ref={feed.ref} onScroll={feed.onScroll} role="log" aria-live="polite">
        {entries.length ? (
          byRound(entries).map(group => (
            <Fragment key={group.round}>
              <RoundDivider round={group.round} />
              {group.entries.map(l => (
                <article key={l.id} class={`jentry ${entryTone(l)}`}>
                  <span class="jicon">
                    <Icon name={entryIcon(l)} size={15} />
                  </span>
                  <p>{l.text}</p>
                </article>
              ))}
            </Fragment>
          ))
        ) : (
          <div class="empty-feed">
            <Icon name="clue" size={28} />
            <p>
              荒野暂时安静。
              <br />
              每一次行动都会留下线索。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
