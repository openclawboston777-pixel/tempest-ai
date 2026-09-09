export const STYLES = `
:host {
  --coral: #C94F3D;
  --coral-dark: #b8442f;
  --ai-bubble: #F1F1F3;
  --text: #1d1d1f;
  --white: #FFFFFF;
  --shadow: 0 4px 14px rgba(0,0,0,.14);
  --panel-shadow: 0 18px 50px rgba(0,0,0,.22);
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

*, *::before, *::after { box-sizing: border-box; }

.tw-root {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 2147483000;
}

@media (max-width: 600px) {
  .tw-root {
    right: 18px;
    bottom: calc(18px + env(safe-area-inset-bottom));
  }
}

/* ---------- Idle bubble ---------- */
.tw-bubble {
  position: relative;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  border: none;
  padding: 0;
  cursor: pointer;
  background: var(--coral);
  box-shadow: var(--shadow);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: tw-breathe 2.5s ease-in-out infinite;
  transition: opacity .2s ease, transform .2s ease;
  -webkit-tap-highlight-color: transparent;
}
.tw-bubble svg { width: 24px; height: 24px; display: block; }

.tw-bubble::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: var(--coral);
  z-index: -1;
  animation: tw-halo 2s ease-out infinite;
}

@keyframes tw-breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.06); }
}
@keyframes tw-halo {
  0% { transform: scale(1); opacity: .18; }
  100% { transform: scale(1.8); opacity: 0; }
}

.tw-hidden { opacity: 0; pointer-events: none; transform: scale(.6); }

@media (prefers-reduced-motion: reduce) {
  .tw-bubble { animation: none; }
  .tw-bubble::after { animation: none; opacity: 0; }
}

/* ---------- Panel ---------- */
.tw-panel {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 360px;
  height: 70vh;
  max-height: 600px;
  background: var(--white);
  border-radius: 22px;
  box-shadow: var(--panel-shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform-origin: bottom right;
  opacity: 0;
  transform: scale(.2);
  pointer-events: none;
  transition: opacity .3s cubic-bezier(0.22,1,0.36,1),
              transform .3s cubic-bezier(0.22,1,0.36,1);
}
.tw-panel.tw-open {
  opacity: 1;
  transform: scale(1);
  pointer-events: auto;
}

@media (max-width: 600px) {
  .tw-panel {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 55vh;
    max-height: none;
    border-radius: 24px 24px 0 0;
    transform-origin: bottom center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .tw-panel { transition: opacity .2s ease; transform: none; }
  .tw-panel.tw-open { transform: none; }
}

/* ---------- Header ---------- */
.tw-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid #efefef;
  flex-shrink: 0;
}
.tw-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--coral);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.tw-avatar svg { width: 16px; height: 16px; display: block; }
.tw-title { display: flex; flex-direction: column; line-height: 1.2; flex: 1; min-width: 0; }
.tw-name { font-size: 15px; font-weight: 600; color: var(--text); letter-spacing: -0.01em; }
.tw-status { font-size: 11px; color: #6b6b70; display: flex; align-items: center; gap: 5px; }
.tw-dot { width: 7px; height: 7px; border-radius: 50%; background: #2ecc71; display: inline-block; }
.tw-close {
  border: none;
  background: transparent;
  cursor: pointer;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #86868b;
  flex-shrink: 0;
  transition: background .15s ease, color .15s ease;
}
.tw-close:hover { background: #f1f1f3; color: #1d1d1f; }
.tw-close svg { width: 16px; height: 16px; }

/* ---------- Messages ---------- */
.tw-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  scroll-behavior: smooth;
}
.tw-messages::-webkit-scrollbar { width: 6px; }
.tw-messages::-webkit-scrollbar-thumb { background: #dcdcdc; border-radius: 3px; }

.tw-msg {
  max-width: 82%;
  padding: 10px 14px;
  border-radius: 18px;
  font-size: 14px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-wrap: break-word;
  animation: tw-msg-in .2s ease;
}
@keyframes tw-msg-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.tw-msg.ai { align-self: flex-start; background: var(--ai-bubble); color: var(--text); border-bottom-left-radius: 6px; }
.tw-msg.user { align-self: flex-end; background: var(--coral); color: var(--white); border-bottom-right-radius: 6px; }
.tw-msg.error { align-self: flex-start; background: #fdecea; color: #b8442f; font-size: 13px; }

.tw-typing { display: inline-flex; gap: 4px; align-items: center; }
.tw-typing span {
  width: 6px; height: 6px; border-radius: 50%; background: #b5b5ba;
  animation: tw-blink 1.2s infinite ease-in-out;
}
.tw-typing span:nth-child(2) { animation-delay: .2s; }
.tw-typing span:nth-child(3) { animation-delay: .4s; }
@keyframes tw-blink { 0%, 80%, 100% { opacity: .3; } 40% { opacity: 1; } }

/* ---------- Footer / Input ---------- */
.tw-footer {
  padding: 12px 14px calc(12px + env(safe-area-inset-bottom));
  border-top: 1px solid #efefef;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tw-input-row { display: flex; align-items: center; gap: 8px; }
.tw-input {
  flex: 1;
  border: 1px solid #e3e3e6;
  background: #f7f7f8;
  border-radius: 999px;
  padding: 11px 16px;
  font-size: 14px;
  color: var(--text);
  outline: none;
  transition: border-color .15s ease, background .15s ease;
  font-family: inherit;
}
.tw-input:focus { border-color: var(--coral); background: #fff; }
.tw-input::placeholder { color: #a0a0a6; }

.tw-send {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: none;
  background: var(--coral);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background .15s ease, transform .1s ease, opacity .15s ease;
}
.tw-send:hover { background: var(--coral-dark); }
.tw-send:active { transform: scale(.92); }
.tw-send:disabled { opacity: .5; cursor: default; }
.tw-send svg { width: 18px; height: 18px; }

.tw-talk {
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid #e3e3e6;
  background: #fff;
  color: var(--coral);
  font-size: 13px;
  font-weight: 500;
  padding: 7px 14px;
  border-radius: 999px;
  cursor: pointer;
  font-family: inherit;
  transition: background .15s ease;
}
.tw-talk:hover { background: #faf3f1; }
.tw-talk svg { width: 15px; height: 15px; }
`;
