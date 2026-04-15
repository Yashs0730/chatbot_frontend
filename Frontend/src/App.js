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

  const logoUrl =
    "https://media.licdn.com/dms/image/v2/C4D0BAQEi4cevcx6xiw/company-logo_200_200/company-logo_200_200/0/1631309511072?e=1775692800&v=beta&t=v1PznnHXLPzTf9j8FEIrkdZVmuT_MoagvasKkC_kDk8";

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
            style={styles.newChatBtn}
            onClick={startNewChat}
            title="Start a new chat"
          >
            <span style={styles.newChatIcon}></span>
            <span style={{ fontWeight: "600", fontSize: "14px" }}>New Chat</span>
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
                      backgroundColor: isActive ? "#ececec" : "transparent",
                      fontWeight: isActive ? "600" : "normal",
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
            {messages.map((msg) => (
              <div key={msg.id} style={styles.msgRow}>
                <div style={styles.msgText}>
                  <div style={styles.msgHeader}>
                    <img
                      src={msg.sender === "user" ? "" : logoUrl}
                      style={
                        msg.sender === "user"
                          ? { display: "none" }
                          : styles.miniBotLogo
                      }
                      alt=""
                    />
                    <strong style={{ fontSize: "14px" }}>
                      {msg.sender === "user" ? "You" : "Assistant"}
                    </strong>
                  </div>
                  <div
                    style={{ marginTop: "8px", overflowX: "auto" }}
                    className="markdown-body"
                  >
                    {msg.sender === "user" ? (
                      msg.text
                    ) : (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.text}
                      </ReactMarkdown>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Loading dots */}
            {isLoading && activeSession.id === activeId && (
              <div style={styles.loaderRow}>
                <img src={logoUrl} style={styles.miniBotLogo} alt="" />
                <div style={styles.loaderDots}>
                  <span style={{ ...styles.dot, animationDelay: "0s" }} />
                  <span style={{ ...styles.dot, animationDelay: "0.2s" }} />
                  <span style={{ ...styles.dot, animationDelay: "0.4s" }} />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </section>

        {/* ── INPUT ── */}
        <footer style={styles.footer}>
          <div style={styles.inputContainer}>
            <button style={styles.plusBtn}>+</button>
            <input
              style={styles.input}
              placeholder="Ask anything..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            />
            <div style={styles.inputRightIcons}>
              <button style={styles.iconBtn}>🎤</button>
              <button
                onClick={sendMessage}
                style={{
                  ...styles.sendBtn,
                  backgroundColor: input ? "#000" : "#e5e5e5",
                }}
              >
                ↑
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
    backgroundColor: "#fff",
    color: "#000",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  sidebar: {
    backgroundColor: "#f9f9f9",
    borderRight: "1px solid #e5e5e5",
    overflowY: "auto",
    position: "relative",
  },
  newChatBtn: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "10px 14px",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "14px",
    transition: "background 0.2s",
    background: "none",
    border: "none",
    width: "100%",
    textAlign: "left",
    color: "#222",
  },
  newChatIcon: { fontSize: "16px" },
  historySection: { marginTop: "20px", flex: 1, overflowY: "auto" },
  historyLabel: {
    fontSize: "11px",
    color: "#999",
    padding: "0 10px 8px 10px",
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
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
    gap: "8px",
    padding: "9px 10px",
    fontSize: "13px",
    borderRadius: "8px",
    cursor: "pointer",
    color: "#333",
    transition: "background 0.15s",
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
    padding: "15px 20px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "#fff",
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
  messageContainer: { width: "100%", maxWidth: "720px", padding: "20px" },
  msgRow: { marginBottom: "32px", fontSize: "16px", lineHeight: "1.6" },
  msgText: {},
  msgHeader: { display: "flex", alignItems: "center", gap: "10px" },
  miniBotLogo: { width: "24px", height: "24px", borderRadius: "50%" },
  loaderRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "28px",
  },
  loaderDots: { display: "flex", gap: "5px", alignItems: "center" },
  dot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    backgroundColor: "#aaa",
    animation: "dotBounce 1.2s infinite ease-in-out",
  },
  footer: {
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    background: "#fff",
  },
  inputContainer: {
    width: "100%",
    maxWidth: "720px",
    display: "flex",
    alignItems: "center",
    backgroundColor: "#f4f4f4",
    borderRadius: "26px",
    padding: "10px 16px",
    gap: "12px",
  },
  input: {
    flex: 1,
    border: "none",
    background: "transparent",
    outline: "none",
    fontSize: "16px",
    padding: "8px",
  },
  plusBtn: {
    background: "none",
    border: "1px solid #ccc",
    width: "28px",
    height: "28px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "20px",
    cursor: "pointer",
    color: "#666",
  },
  iconBtn: { background: "none", border: "none", fontSize: "20px", cursor: "pointer" },
  inputRightIcons: { display: "flex", gap: "12px", alignItems: "center" },
  sendBtn: {
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    border: "none",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition: "0.3s",
  },
  disclaimer: { fontSize: "12px", color: "#999", marginTop: "14px" },
};

export default App;