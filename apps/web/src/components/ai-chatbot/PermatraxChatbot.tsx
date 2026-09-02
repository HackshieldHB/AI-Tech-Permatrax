'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import Link from 'next/link';
import { apiGet, apiPost } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

type Citation = {
  title: string;
  module: string;
  sourceUri: string | null;
  chunkId: string;
  score: number;
};

type ChatResponse = {
  conversationId: string;
  messageId: string;
  answer: string;
  citations: Citation[];
  grounded: boolean;
  refusal: boolean;
  intent: string;
  sticker?: string | null;
  proposedAction?: { action: string; label: string; href: string } | null;
};

type UiMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  proposedAction?: ChatResponse['proposedAction'];
  sticker?: string | null;
  at?: string;
};

const FALLBACK_CAPABILITY_CARD = [
  'Kartu kemampuan PAI',
  '',
  'Bisa:',
  '• Fakta live: Finance Project, Stok, Cash Operation, Visit Request, Purchase Request (jumlah, ranking, cari kode/nama, filter status/SITE/SEGMENT, PIC).',
  '• 5-why terbatas: angka DB (budget vs realisasi, material/jasa, status cash/cluster) lalu berhenti di unknown.',
  '• Cara pakai / letak menu jika ada di knowledge, sesuai Active Module.',
  '',
  'Tidak bisa:',
  '• Akar masalah cerita / 5-why lengkap (audit, komentar, invoice line, timeline BA) — PAI tidak mengarang Why4–5.',
  '• Opini hukum atau data di luar role Anda.',
  '• PII (email, telepon, NIK) dan angka yang tidak ada di tool/database.',
  '',
  'Kalau tidak tahu: tolak 1–2 kalimat + arahkan ke menu modul — bukan dump Guide.',
].join('\n');

const SUGGESTIONS = [
  'Apa saja yang bisa kamu lakukan?',
  'Berapa total budget project aktif?',
  'Top 10 budget terbesar',
  'Approval dana yang pending?',
];

const QUICK_EMOJIS = ['👍', '🔥', '😂', '😮', '😢', '👏'];

function firstName(name?: string | null): string {
  if (!name?.trim()) return 'teman';
  return name.trim().split(/\s+/)[0];
}

function FabIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M6 6l12 12M18 6L6 18"
          stroke="#fff"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg width="30" height="30" viewBox="0 0 64 64" aria-hidden focusable="false">
      <defs>
        <linearGradient id="paiFab" x1="8" y1="6" x2="56" y2="58">
          <stop offset="0" stopColor="#FF6B6B" />
          <stop offset="0.5" stopColor="#D85BCB" />
          <stop offset="1" stopColor="#6D4AFF" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#paiFab)" />
      <path
        d="M22 16h13.5c7.2 0 12.5 4.7 12.5 11.6 0 6.9-5.3 11.6-12.5 11.6H30V48h-8V16Zm8 16.4h5c2.9 0 4.8-1.9 4.8-4.8 0-2.9-1.9-4.8-4.8-4.8h-5v9.6Z"
        fill="#fff"
      />
    </svg>
  );
}

function Avatar({ label }: { label: string }) {
  return (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: '50%',
        flexShrink: 0,
        background: 'linear-gradient(135deg,#0084FF,#00C6FF)',
        color: '#fff',
        fontSize: 11,
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {label}
    </div>
  );
}

function TypingBubble() {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
      <Avatar label="P" />
      <div style={styles.bubbleAi}>
        <div style={{ display: 'flex', gap: 4, padding: '2px 4px' }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: '#8A8D91',
                animation: `msgDot 1.2s ease-in-out ${i * 0.16}s infinite`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function PermatraxChatbot() {
  const user = useAuthStore((s) => s.user);
  const name = firstName(user?.name);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [greeted, setGreeted] = useState(false);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(true);
  const [capabilityCard, setCapabilityCard] = useState(FALLBACK_CAPABILITY_CARD);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const welcome = useMemo<UiMessage>(
    () => ({
      id: 'welcome',
      role: 'assistant',
      sticker: '👋',
      content: `Hai ${name}! Aku PAI 💬\nAsisten fakta live PermaTrax — bukan analis 5-why cerita.\n\nKartu kemampuan ada di atas chat. Tanya jumlah, ranking, kode project, atau cara menu.`,
      at: new Date().toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    }),
    [name],
  );

  useEffect(() => {
    if (open && !greeted) {
      setMessages([welcome]);
      setGreeted(true);
    }
  }, [open, greeted, welcome]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, open, busy]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void apiGet<{ capabilityCard?: string }>('/ai/health')
      .then((h) => {
        if (h.capabilityCard?.includes('Kartu kemampuan PAI')) {
          setCapabilityCard(h.capabilityCard);
        }
      })
      .catch(() => {
        /* keep fallback card */
      });
  }, [open]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setInput('');
      setEmojiOpen(false);
      setBusy(true);
      const now = new Date().toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
      });
      setMessages((prev) => [
        ...prev,
        { id: `u-${Date.now()}`, role: 'user', content: trimmed, at: now },
      ]);
      try {
        const res = await apiPost<ChatResponse>('/ai/chat', {
          message: trimmed,
          conversationId,
        });
        setConversationId(res.conversationId);
        setMessages((prev) => [
          ...prev,
          {
            id: res.messageId,
            role: 'assistant',
            content: res.answer,
            citations: res.citations,
            proposedAction: res.proposedAction,
            sticker: res.sticker,
            at: new Date().toLocaleTimeString('id-ID', {
              hour: '2-digit',
              minute: '2-digit',
            }),
          },
        ]);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: 'assistant',
            sticker: '😵',
            content:
              err instanceof Error
                ? `PAI offline bentar: ${err.message}`
                : 'PAI lagi error. Coba kirim ulang ya.',
            at: now,
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy, conversationId],
  );

  const rate = async (messageId: string, rating: number) => {
    try {
      await apiPost('/ai/feedback', { messageId, rating });
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <style>{`
        @keyframes msgDot {
          0%, 80%, 100% { transform: translateY(0); opacity: .4; }
          40% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>

      {/* FAB */}
      <button
        type="button"
        aria-label="Buka PAI Messenger"
        onClick={() => setOpen((v) => !v)}
        style={{
          position: 'fixed',
          right: 18,
          bottom: 18,
          zIndex: 10000,
          width: 56,
          height: 56,
          borderRadius: '50%',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          background: open ? '#0084FF' : 'transparent',
          boxShadow: '0 8px 24px rgba(0,132,255,0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <FabIcon open={open} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="PAI Messenger"
          style={{
            position: 'fixed',
            right: 18,
            bottom: 84,
            zIndex: 10000,
            width: 'min(400px, calc(100vw - 24px))',
            height: 'min(640px, calc(100vh - 100px))',
            borderRadius: 16,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            background: '#fff',
            boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
            border: '1px solid #E4E6EB',
            fontFamily:
              'Segoe UI, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
          }}
        >
          {/* Messenger header */}
          <div
            style={{
              height: 56,
              padding: '0 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              borderBottom: '1px solid #E4E6EB',
              background: '#fff',
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                overflow: 'hidden',
                background: 'linear-gradient(135deg,#FF6B6B,#6D4AFF)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ color: '#fff', fontWeight: 800, fontSize: 13 }}>
                PAI
              </span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 650,
                  color: '#050505',
                  lineHeight: 1.2,
                }}
              >
                PAI
              </div>
              <div style={{ fontSize: 12, color: '#0084FF' }}>
                Fakta live · bukan 5-why cerita
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                border: 'none',
                background: '#F0F2F5',
                color: '#050505',
                cursor: 'pointer',
                fontSize: 18,
              }}
            >
              ×
            </button>
          </div>

          <div
            style={{
              borderBottom: '1px solid #E4E6EB',
              background: '#F7F9FC',
              padding: '8px 12px 10px',
            }}
          >
            <button
              type="button"
              onClick={() => setCardOpen((v) => !v)}
              aria-expanded={cardOpen}
              style={{
                width: '100%',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                textAlign: 'left',
                padding: 0,
                fontSize: 13,
                fontWeight: 650,
                color: '#050505',
              }}
            >
              Kartu kemampuan PAI {cardOpen ? '▾' : '▸'}
            </button>
            {cardOpen && (
              <pre
                style={{
                  margin: '8px 0 0',
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'inherit',
                  fontSize: 11.5,
                  lineHeight: 1.45,
                  color: '#4B4F56',
                }}
              >
                {capabilityCard.replace(/^Kartu kemampuan PAI\n\n/, '')}
              </pre>
            )}
          </div>

          {/* Chat area — Messenger grey wallpaper vibe */}
          <div
            ref={listRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '12px 10px 8px',
              background: '#F0F2F5',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {messages.map((m) => {
              const isUser = m.role === 'user';
              return (
                <div
                  key={m.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: isUser ? 'flex-end' : 'flex-start',
                    gap: 4,
                  }}
                >
                  {/* Telegram-like sticker above bubble */}
                  {!isUser && m.sticker && (
                    <div
                      style={{
                        fontSize: 44,
                        lineHeight: 1,
                        marginLeft: 36,
                        marginBottom: 2,
                        filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.08))',
                        userSelect: 'none',
                      }}
                      aria-hidden
                    >
                      {m.sticker}
                    </div>
                  )}

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-end',
                      gap: 8,
                      maxWidth: '86%',
                      flexDirection: isUser ? 'row-reverse' : 'row',
                    }}
                  >
                    {!isUser && <Avatar label="P" />}
                    <div>
                      <div
                        style={
                          isUser ? styles.bubbleUser : styles.bubbleAi
                        }
                      >
                        {m.content}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: '#8A8D91',
                          marginTop: 3,
                          textAlign: isUser ? 'right' : 'left',
                          paddingInline: 4,
                        }}
                      >
                        {m.at}
                      </div>
                    </div>
                  </div>

                  {!isUser && m.citations && m.citations.length > 0 && (
                    <div
                      style={{
                        marginLeft: 36,
                        fontSize: 11,
                        color: '#65676B',
                      }}
                    >
                      sumber:{' '}
                      {m.citations.slice(0, 2).map((c) =>
                        c.sourceUri ? (
                          <Link
                            key={c.chunkId}
                            href={c.sourceUri}
                            style={{ color: '#0084FF', marginRight: 6 }}
                          >
                            {c.title}
                          </Link>
                        ) : (
                          <span key={c.chunkId} style={{ marginRight: 6 }}>
                            {c.title}
                          </span>
                        ),
                      )}
                    </div>
                  )}

                  {!isUser && m.proposedAction && (
                    <Link
                      href={m.proposedAction.href}
                      style={{
                        marginLeft: 36,
                        fontSize: 12,
                        color: '#0084FF',
                        fontWeight: 600,
                      }}
                    >
                      {m.proposedAction.label} →
                    </Link>
                  )}

                  {!isUser &&
                    m.id !== 'welcome' &&
                    !m.id.startsWith('err-') && (
                      <div
                        style={{
                          marginLeft: 36,
                          display: 'flex',
                          gap: 4,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => rate(m.id, 5)}
                          style={styles.react}
                          title="Like"
                        >
                          👍
                        </button>
                        <button
                          type="button"
                          onClick={() => rate(m.id, 1)}
                          style={styles.react}
                          title="Dislike"
                        >
                          👎
                        </button>
                      </div>
                    )}
                </div>
              );
            })}

            {busy && <TypingBubble />}
          </div>

          {/* Quick replies */}
          {messages.length <= 2 && (
            <div
              style={{
                padding: '8px 10px',
                display: 'flex',
                gap: 6,
                overflowX: 'auto',
                background: '#fff',
                borderTop: '1px solid #E4E6EB',
              }}
            >
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy}
                  onClick={() => send(s)}
                  style={{
                    flexShrink: 0,
                    border: '1px solid #0084FF',
                    background: '#fff',
                    color: '#0084FF',
                    borderRadius: 18,
                    padding: '7px 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Emoji tray */}
          {emojiOpen && (
            <div
              style={{
                display: 'flex',
                gap: 6,
                padding: '8px 12px',
                background: '#fff',
                borderTop: '1px solid #E4E6EB',
              }}
            >
              {QUICK_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    setInput((v) => v + e);
                    inputRef.current?.focus();
                  }}
                  style={{
                    width: 36,
                    height: 36,
                    border: 'none',
                    borderRadius: 10,
                    background: '#F0F2F5',
                    fontSize: 20,
                    cursor: 'pointer',
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          )}

          {/* Composer — Messenger style */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 10px 12px',
              background: '#fff',
              borderTop: '1px solid #E4E6EB',
            }}
          >
            <button
              type="button"
              onClick={() => setEmojiOpen((v) => !v)}
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                border: 'none',
                background: '#F0F2F5',
                cursor: 'pointer',
                fontSize: 18,
              }}
              title="Emoji"
            >
              😊
            </button>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Aa"
              disabled={busy}
              style={{
                flex: 1,
                height: 38,
                borderRadius: 20,
                border: 'none',
                background: '#F0F2F5',
                padding: '0 14px',
                fontSize: 14,
                color: '#050505',
                outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                border: 'none',
                background: busy || !input.trim() ? '#E4E6EB' : '#0084FF',
                color: '#fff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-label="Kirim"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </form>
        </div>
      )}
    </>
  );
}

const styles: Record<string, CSSProperties> = {
  // Telegram-ish bubbles on Messenger palette
  bubbleUser: {
    padding: '9px 12px',
    borderRadius: '18px 18px 4px 18px',
    background: '#0084FF',
    color: '#fff',
    fontSize: 14,
    lineHeight: 1.45,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    boxShadow: '0 1px 1px rgba(0,0,0,0.06)',
  },
  bubbleAi: {
    padding: '9px 12px',
    borderRadius: '18px 18px 18px 4px',
    background: '#fff',
    color: '#050505',
    fontSize: 14,
    lineHeight: 1.45,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    boxShadow: '0 1px 1px rgba(0,0,0,0.06)',
    border: '1px solid #E4E6EB',
  },
  react: {
    border: 'none',
    background: '#fff',
    borderRadius: 12,
    padding: '2px 7px',
    fontSize: 12,
    cursor: 'pointer',
    boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
  },
};
