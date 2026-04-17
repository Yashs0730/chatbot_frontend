import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./App.css";
// ─── helpers ──────────────────────────────────────────────────────────────────
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

const createSession = () => ({
  id: uid(),
  title: "New Chat",
  messages: [],
  createdAt: Date.now(),
});

// ─── localStorage helpers ─────────────────────────────────────────────────────
const STORAGE_KEY = "chatSessions";
const ACTIVE_KEY = "chatActiveId";

const loadSessions = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (_) { }
  return [createSession()];
};

const saveSession = (sessions) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch (_) { }
};

const loadActiveId = (sessions) => {
  try {
    const id = localStorage.getItem(ACTIVE_KEY);
    if (id && sessions.find((s) => s.id === id)) return id;
  } catch (_) { }
  return sessions[0]?.id;
};

// ─── App ──────────────────────────────────────────────────────────────────────
const App = () => {
  const [sessions, setSessions] = useState(loadSessions);
  const [activeId, setActiveId] = useState(() => loadActiveId(loadSessions()));
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const bottomRef = useRef(null);

  const logoUrl = "triazine.jpeg";

  // ── Persist sessions to localStorage on every change ─────────────────────
  useEffect(() => {
    saveSession(sessions);
  }, [sessions]);

  // ── Persist activeId to localStorage ─────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem(ACTIVE_KEY, activeId); } catch (_) { }
  }, [activeId]);

  // ── Keep activeId in sync if sessions shrink ─────────────────────────────
  useEffect(() => {
    if (sessions.length > 0 && !sessions.find((s) => s.id === activeId)) {
      setActiveId(sessions[0].id);
    }
  }, [sessions, activeId]);

  // ── Scroll to bottom on new messages ────────────────────────────────────
  const activeSession = sessions.find((s) => s.id === activeId) || sessions[0];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeSession?.messages, isTyping]);

  // ── session helpers ───────────────────────────────────────────────────────
  const updateSession = (id, updater) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updater(s) } : s))
    );
  };

  const appendMessage = (sessionId, msg) => {
    updateSession(sessionId, (s) => ({ messages: [...s.messages, msg] }));
  };

  // ── New Chat ───────────────────────────────────────────────────────────────
  const startNewChat = () => {
    const session = createSession();
    setSessions((prev) => [session, ...prev]);
    setActiveId(session.id);
    setInput("");
  };

  // ── Delete session ─────────────────────────────────────────────────────────
  const deleteSession = (e, sessionId) => {
    e.stopPropagation(); // don't trigger the row's onClick
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== sessionId);
      // If we deleted the active session, switch to the first remaining one
      // (or create a brand-new session if nothing is left)
      if (sessionId === activeId) {
        if (next.length > 0) {
          setActiveId(next[0].id);
        } else {
          const fresh = createSession();
          setActiveId(fresh.id);
          return [fresh];
        }
      }
      return next;
    });
  };

  // ── Send message ───────────────────────────────────────────────────────────
  const sendMessage = async () => {
    if (!input.trim() || isTyping) return;

    const currentInput = input;
    const sessionId = activeSession.id;

    const MAX_HISTORY = 10;
    const history = [
      ...activeSession.messages.slice(-MAX_HISTORY).map((m) => ({
        role: m.sender === "user" ? "user" : "assistant",
        content: m.text,
      })),
      { role: "user", content: currentInput },
    ];

    const userMsg = { id: uid(), sender: "user", text: currentInput };
    appendMessage(sessionId, userMsg);

    if (activeSession.messages.length === 0) {
      updateSession(sessionId, () => ({
        title:
          currentInput.length > 40
            ? currentInput.slice(0, 40) + "…"
            : currentInput,
      }));
    }

    setInput("");
    setIsTyping(true);
    setIsLoading(true);

    try {
      const res = await axios.post("http://127.0.0.1:8000/api/chat/", {
        message: currentInput,
        history,
        session_id: sessionId,
      });

      const botReply = res?.data?.response;
      if (!botReply) throw new Error("Invalid response from server");

      setIsLoading(false);
      startTypingEffect(sessionId, botReply);
    } catch (err) {
      setIsLoading(false);
      setIsTyping(false);
      appendMessage(sessionId, {
        id: uid(),
        sender: "bot",
        text: "I'm having trouble connecting right now. Please try again.",
      });
    }
  };

  // ── Typing effect ──────────────────────────────────────────────────────────
  const startTypingEffect = (sessionId, fullText) => {
    const botMsgId = uid();
    appendMessage(sessionId, { id: botMsgId, sender: "bot", text: "" });

    let index = 0;
    let current = "";
    const interval = setInterval(() => {
      current += fullText[index];
      index++;
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const msgs = s.messages.map((m) =>
            m.id === botMsgId ? { ...m, text: current } : m
          );
          return { ...s, messages: msgs };
        })
      );
      if (index === fullText.length) {
        clearInterval(interval);
        setIsTyping(false);
      }
    }, 10);
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  const messages = activeSession?.messages || [];

  return (
    <div style={styles.layout}>
      {/* ── SIDEBAR ── */}
      <aside
        className={`sidebar ${sidebarOpen ? "sidebar--open" : "sidebar--closed"}`}
        style={styles.sidebar}
      >
        {/* Toggle button — always visible on the right edge of sidebar */}
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarOpen((o) => !o)}
          title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
          {sidebarOpen ? "‹" : "›"}
        </button>

        {/* Sidebar contents — hidden when collapsed */}
        <div className="sidebar-content">
          <button
            className="new-chat-btn"
            onClick={startNewChat}
            title="Start a new chat"
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>New Chat</span>
            </div>
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity: 0.4 }}>
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <div style={styles.historySection}>
            <div style={styles.historyLabel}>Chats</div>

            {sessions.length === 0 ? (
              <div style={styles.historyEmpty}>No chats yet</div>
            ) : (
              sessions.map((session) => {
                const isActive = session.id === activeId;
                return (
                  <div
                    key={session.id}
                    className="history-item-row"
                    style={{
                      ...styles.historyItem,
                      backgroundColor: isActive ? "#E9ECEF" : "transparent",
                      fontWeight: isActive ? "600" : "500",
                      color: isActive ? "#111" : "#444",
                    }}
                    onClick={() => {
                      setActiveId(session.id);
                      setInput("");
                    }}
                    title={session.title}
                  >
                    <span style={styles.historyIcon}></span>
                    <span style={styles.historyText}>{session.title}</span>
                    <button
                      className="delete-chat-btn"
                      onClick={(e) => deleteSession(e, session.id)}
                      title="Delete chat"
                      aria-label="Delete chat"
                    >
                      🗑
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main style={styles.main}>
        <header style={styles.header}>
          <div style={styles.modelSelector}>Assistant ▾</div>
          <div style={styles.userIcon}>D</div>
        </header>

        <section style={styles.chatWindow}>
          {messages.length === 0 && (
            <div style={styles.welcomeContainer}>
              <img src={logoUrl} style={styles.largeLogo} alt="Logo" />
              <h1 style={styles.welcomeTitle}>How can I help you today?</h1>
            </div>
          )}

          <div style={styles.messageContainer}>
            {messages.map((msg) => {
              const isUser = msg.sender === "user";
              return (
                <div key={msg.id} style={{ ...styles.msgRow, justifyContent: isUser ? "flex-end" : "flex-start" }}>
                  {!isUser && (
                    <img src={logoUrl} style={styles.miniBotLogo} alt="Bot" />
                  )}
                  <div style={{
                    ...styles.msgBubble,
                    maxWidth: isUser ? "75%" : "100%",
                    backgroundColor: isUser ? "#2B6BF3" : "#ffffff",
                    color: isUser ? "#ffffff" : "#1d1d1f",
                    boxShadow: isUser ? "0 4px 14px rgba(43, 107, 243, 0.25)" : "0 4px 14px rgba(0,0,0,0.06)",
                    borderBottomRightRadius: isUser ? "4px" : "18px",
                    borderBottomLeftRadius: !isUser ? "4px" : "18px",
                  }}>
                    <div style={{ fontWeight: "700", fontSize: "12px", marginBottom: "6px", opacity: 0.85 }}>
                      {isUser ? "You" : "Assistant"}
                    </div>
                    <div style={{ overflowX: "auto" }} className={!isUser ? "markdown-body" : ""}>
                      {isUser ? (
                        msg.text
                      ) : (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.text}
                        </ReactMarkdown>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Loading dots */}
            {isLoading && activeSession.id === activeId && (
              <div style={{ ...styles.msgRow, justifyContent: "flex-start" }}>
                <img src={logoUrl} style={styles.miniBotLogo} alt="Bot" />
                <div style={{
                  ...styles.msgBubble,
                  backgroundColor: "#ffffff",
                  boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
                  borderBottomLeftRadius: "4px",
                }}>
                  <div style={styles.loaderDots}>
                    <span style={{ ...styles.dot, animationDelay: "0s" }} />
                    <span style={{ ...styles.dot, animationDelay: "0.2s" }} />
                    <span style={{ ...styles.dot, animationDelay: "0.4s" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </section>

        {/* ── INPUT ── */}
        <footer style={styles.footer}>
          <div style={styles.inputContainer}>
            <button className="plus-btn" aria-label="Add attachment" title="Add attachment">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <input
              style={styles.input}
              placeholder="Ask anything..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            />
            <div style={styles.inputRightIcons}>
              <button className="mic-btn" aria-label="Use microphone" title="Use microphone">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" fill="currentColor" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <line x1="12" y1="19" x2="12" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
              <button
                onClick={sendMessage}
                className={`send-btn ${input ? 'send-btn-active' : 'send-btn-inactive'}`}
                aria-label="Send message"
                title="Send message"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ transform: input ? 'scale(1.05)' : 'scale(1)', transition: '0.2s' }}>
                  <path d="M12 19V5M12 5L5 12M12 5L19 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
          <div style={styles.disclaimer}>
            AI can make mistakes. Please verify important information.
          </div>
        </footer>
      </main>
    </div>
  );
};

// ─── styles ───────────────────────────────────────────────────────────────────
const styles = {
  layout: {
    display: "flex",
    height: "100vh",
    backgroundColor: "#F4F7F9",
    color: "#1d1d1f",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  sidebar: {
    backgroundColor: "#f9f9f9",
    borderRight: "1px solid #e5e5e5",
    overflowY: "auto",
    position: "relative",
  },
  historySection: { marginTop: "20px", flex: 1, overflowY: "auto" },
  historyLabel: {
    fontSize: "12px",
    color: "#888",
    padding: "0 10px 12px 10px",
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  historyEmpty: {
    padding: "10px",
    fontSize: "13px",
    color: "#bbb",
    fontStyle: "italic",
  },
  historyItem: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "12px 14px",
    fontSize: "14px",
    borderRadius: "10px",
    cursor: "pointer",
    transition: "all 0.15s ease",
    marginBottom: "4px",
  },
  historyIcon: { fontSize: "14px", flexShrink: 0 },
  historyText: {
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    position: "relative",
  },
  header: {
    padding: "16px 24px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "rgba(255, 255, 255, 0.6)",
    backdropFilter: "blur(12px)",
    borderBottom: "1px solid rgba(0,0,0,0.04)",
    zIndex: 10,
  },
  modelSelector: {
    fontWeight: "600",
    color: "#555",
    cursor: "pointer",
    fontSize: "18px",
  },
  userIcon: {
    width: "32px",
    height: "32px",
    backgroundColor: "#007bff",
    color: "#fff",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: "bold",
    fontSize: "14px",
  },
  chatWindow: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  welcomeContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    marginTop: "10vh",
  },
  largeLogo: {
    width: "80px",
    height: "80px",
    borderRadius: "50%",
    marginBottom: "20px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
  },
  welcomeTitle: { fontSize: "24px", fontWeight: "600", color: "#222" },
  messageContainer: { width: "100%", maxWidth: "100%", padding: "20px 4%" },
  msgRow: { display: "flex", width: "100%", marginBottom: "24px", gap: "12px", alignItems: "flex-end" },
  msgBubble: {
    padding: "14px 18px",
    borderRadius: "18px",
    fontSize: "15px",
    lineHeight: "1.6",
    position: "relative",
  },
  miniBotLogo: { width: "34px", height: "34px", borderRadius: "50%", flexShrink: "0" },
  loaderRow: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "28px" },
  loaderDots: { display: "flex", gap: "6px", alignItems: "center", padding: "6px" },
  dot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    backgroundColor: "#bbb",
    animation: "dotBounce 1.2s infinite ease-in-out",
  },
  footer: {
    padding: "12px 20px 16px 20px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    background: "rgba(255, 255, 255, 0.8)",
    backdropFilter: "blur(20px)",
    borderTop: "1px solid rgba(0,0,0,0.04)",
    zIndex: 10,
  },
  inputContainer: {
    width: "100%",
    maxWidth: "850px",
    display: "flex",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: "32px",
    padding: "8px 14px",
    gap: "12px",
    boxShadow: "0 8px 30px rgba(0,0,0,0.06)",
    border: "1px solid rgba(0,0,0,0.05)",
  },
  input: {
    flex: 1,
    border: "none",
    background: "transparent",
    outline: "none",
    fontSize: "16px",
    padding: "8px",
    color: "#1d1d1f",
  },
  inputRightIcons: { display: "flex", gap: "12px", alignItems: "center" },
  disclaimer: { fontSize: "12px", color: "#999", marginTop: "8px" },
};

export default App;