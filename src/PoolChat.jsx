import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Trash2 } from 'lucide-react';

// A simple chat wall for a pool. Anyone who's claimed their identity can post as themselves;
// admin can delete any message. Messages are expected to already be sorted oldest-first.
export default function PoolChat({ messages, isAdmin, myId, myName, onPost, onDelete, accent = '#8A9A90' }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    if (open && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [open, messages.length]);

  const post = () => {
    const text = draft.trim();
    if (!text || !myId) return;
    onPost(text);
    setDraft('');
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-40 flex items-center gap-1.5 px-3 py-2 rounded-full font-head text-xs uppercase tracking-wide"
        style={{ background: '#1C2823', border: `1px solid ${accent}`, color: accent, boxShadow: '0 4px 14px rgba(0,0,0,0.5)' }}
      >
        <MessageCircle size={14} />
        Chat{messages.length > 0 ? ` (${messages.length})` : ''}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0" style={{ background: '#0F1614cc' }}>
          <div className="w-full max-w-md rounded flex flex-col" style={{ background: '#1C2823', border: '1px solid #2A3830', maxHeight: '80vh' }}>
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #2A3830' }}>
              <div className="font-head text-sm uppercase tracking-wide flex items-center gap-2" style={{ color: accent }}>
                <MessageCircle size={14} /> Pool Chat
              </div>
              <button onClick={() => setOpen(false)} style={{ color: '#5C6862' }}><X size={18} /></button>
            </div>

            <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5" style={{ minHeight: '200px' }}>
              {messages.length === 0 ? (
                <div className="font-mono text-xs text-center py-6" style={{ color: '#5C6862' }}>No messages yet — be the first to say something.</div>
              ) : (
                messages.map(m => (
                  <div key={m.id} className="group">
                    <div className="flex items-baseline gap-2">
                      <span className="font-head text-xs" style={{ color: '#F0EDE4' }}>{m.authorName}</span>
                      <span className="font-mono text-[9px]" style={{ color: '#5C6862' }}>
                        {new Date(m.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                      {isAdmin && (
                        <button onClick={() => onDelete(m.id)} className="ml-auto opacity-60 hover:opacity-100" style={{ color: '#C1443A' }} title="Delete message">
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                    <div className="font-mono text-xs mt-0.5" style={{ color: '#8A9A90', wordBreak: 'break-word' }}>{m.text}</div>
                  </div>
                ))
              )}
            </div>

            <div className="px-4 py-3" style={{ borderTop: '1px solid #2A3830' }}>
              {!myId ? (
                <div className="font-mono text-xs" style={{ color: '#5C6862' }}>
                  Claim your name above (under "Returning member?") to post.
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && post()}
                    placeholder={`Posting as ${myName}…`}
                    className="flex-1 px-3 py-2 rounded outline-none font-mono text-xs"
                    style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4' }}
                  />
                  <button onClick={post} disabled={!draft.trim()} className="p-2 rounded" style={{ background: draft.trim() ? accent : '#2A3830', color: '#0F1614' }}>
                    <Send size={14} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
