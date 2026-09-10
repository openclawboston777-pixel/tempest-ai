// VoiceSession: browser client for xAI/Grok realtime Speech-to-Speech
// over WebSocket streaming raw PCM audio (24kHz).
//
// Adds: user + assistant transcripts, full-session audio recording (mic +
// assistant playback mixed), proactive greeting, and end-of-session upload
// of the recording and transcript log to the backend.

interface VoiceToken {
  token: string;
  model?: string;
  instructions?: string;
  voice?: string;
  tools?: ChatTool[];
}

interface ChatTool {
  type: string;
  function?: {
    name: string;
    description?: string;
    parameters?: unknown;
  };
}

interface RealtimeTool {
  type: string;
  name: string;
  description?: string;
  parameters?: unknown;
}

interface RealtimeEvent {
  type: string;
  delta?: string;
  text?: string;
  transcript?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  error?: { message?: string };
}

export interface TranscriptEntry {
  role: "user" | "ai";
  text: string;
  ts: number;
}

export interface VoiceSessionOpts {
  onTranscript?: (role: "user" | "ai", text: string) => void;
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk) as number[]);
  }
  return btoa(binary);
}

function bytesFromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function makeSessionId(): string {
  try {
    const c = (globalThis as unknown as { crypto?: Crypto }).crypto;
    if (c && typeof c.randomUUID === "function") {
      return c.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return "sess-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

export class VoiceSession {
  private backendUrl: string;
  private container: HTMLElement;
  private statusEl: HTMLElement;
  private btn: HTMLElement | null = null;
  private opts: VoiceSessionOpts;

  private active = false;
  private stopped = false;

  private sessionId: string = makeSessionId();
  private transcript: TranscriptEntry[] = [];

  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private ws: WebSocket | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private proc: ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;

  private dest: MediaStreamAudioDestinationNode | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  private nextTime = 0;

  // Transcript accumulators.
  private userTurnText = "";
  private userTurnEmitted = false;
  private aiTurnText = "";
  private aiTurnEmitted = false;

  constructor(backendUrl: string, container: HTMLElement, opts?: VoiceSessionOpts) {
    this.backendUrl = backendUrl;
    this.container = container;
    this.opts = opts || {};

    let statusEl = container.querySelector<HTMLElement>(".tw-voice-status");
    if (!statusEl) {
      statusEl = document.createElement("div");
      statusEl.className = "tw-voice-status";
      container.appendChild(statusEl);
    }
    this.statusEl = statusEl;
  }

  private setStatus(text: string): void {
    try {
      this.statusEl.textContent = text;
    } catch {
      /* ignore */
    }
  }

  private emitTranscript(role: "user" | "ai", text: string): void {
    const clean = (text || "").trim();
    if (!clean) {
      return;
    }
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    const last = this.transcript[this.transcript.length - 1];
    if (
      last &&
      last.role === role &&
      (norm(clean) === norm(last.text) ||
        norm(clean).startsWith(norm(last.text)) ||
        norm(last.text).startsWith(norm(clean)))
    ) {
      // Same turn: merge partial/duplicate transcription into one clean entry.
      if (clean.length >= last.text.length) last.text = clean;
      last.ts = Date.now();
      return;
    }
    this.transcript.push({ role, text: clean, ts: Date.now() });
    // Voice transcript is stored to S3 only — intentionally NOT rendered in the chat UI.
  }

  private flushUserTurn(): void {
    if (this.userTurnEmitted) {
      return;
    }
    const text = this.userTurnText.trim();
    if (!text) {
      this.userTurnText = "";
      return;
    }
    this.userTurnEmitted = true;
    this.emitTranscript("user", text);
    this.userTurnText = "";
    this.userTurnEmitted = false;
  }

  private flushAiTurn(): void {
    if (this.aiTurnEmitted) {
      return;
    }
    const text = this.aiTurnText.trim();
    if (!text) {
      this.aiTurnText = "";
      return;
    }
    this.aiTurnEmitted = true;
    this.emitTranscript("ai", text);
    this.aiTurnText = "";
    this.aiTurnEmitted = false;
  }

  toggle(btn?: HTMLElement): void {
    if (btn) {
      this.btn = btn;
    }
    if (this.active) {
      this.stop();
    } else {
      void this.start();
    }
  }

  async startProactive(btn?: HTMLElement): Promise<void> {
    if (btn) {
      this.btn = btn;
      btn.classList.add("tw-voice-active");
    }
    await this.start();
    // Ema greets first; send once the socket is open + session.update flushed.
    try {
      const ws = this.ws;
      if (!ws || this.stopped) {
        return;
      }
      const sendGreeting = (): void => {
        try {
          if (this.stopped || ws.readyState !== WebSocket.OPEN) {
            return;
          }
          ws.send(
            JSON.stringify({
              type: "response.create",
              response: {
                instructions:
                  "Warmly greet the customer in one short sentence and ask how you can help.",
              },
            }),
          );
        } catch {
          /* ignore */
        }
      };
      if (ws.readyState === WebSocket.OPEN) {
        sendGreeting();
      } else {
        const prev = ws.onopen;
        ws.onopen = (e: Event): void => {
          try {
            if (typeof prev === "function") {
              (prev as (this: WebSocket, ev: Event) => unknown).call(ws, e);
            }
          } catch {
            /* ignore */
          }
          sendGreeting();
        };
      }
    } catch {
      /* ignore */
    }
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.active = true;
    this.sessionId = makeSessionId();
    this.transcript = [];
    this.chunks = [];
    this.userTurnText = "";
    this.userTurnEmitted = false;
    this.aiTurnText = "";
    this.aiTurnEmitted = false;

    if (this.btn) {
      this.btn.classList.add("tw-voice-active");
    }

    try {
      this.setStatus("Connecting…");

      const resp = await fetch(`${this.backendUrl}/voice-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const tokenData = (await resp.json()) as VoiceToken;
      const token = tokenData.token;
      const model = tokenData.model || "grok-voice-latest";
      const instructions = tokenData.instructions || "";
      const chatTools = tokenData.tools || [];

      // Mic access.
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        this.setStatus("Voice error: mic permission");
        this.stop();
        return;
      }

      if (this.stopped) {
        this.stop();
        return;
      }

      // Audio context (mic tap counts as user gesture).
      const AudioCtxCtor: typeof AudioContext =
        (window as unknown as { AudioContext: typeof AudioContext }).AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioCtxCtor({ sampleRate: 24000 });
      await this.audioCtx.resume();
      this.nextTime = this.audioCtx.currentTime;

      // Recording destination (mic + assistant playback are both routed here).
      try {
        this.dest = this.audioCtx.createMediaStreamDestination();
      } catch {
        this.dest = null;
      }

      // Open WebSocket with token in subprotocol.
      const ws = new WebSocket(
        `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(model)}`,
        [`xai-client-secret.${token}`],
      );
      ws.binaryType = "arraybuffer";
      this.ws = ws;

      const convertedTools: RealtimeTool[] = chatTools
        .filter((t: ChatTool): boolean => !!t.function)
        .map((t: ChatTool): RealtimeTool => ({
          type: "function",
          name: t.function!.name,
          description: t.function!.description,
          parameters: t.function!.parameters,
        }));

      ws.onopen = (): void => {
        try {
          if (this.stopped || ws.readyState !== WebSocket.OPEN) {
            return;
          }
          ws.send(
            JSON.stringify({
              type: "session.update",
              session: {
                voice: tokenData.voice || "eve",
                instructions,
                turn_detection: { type: "server_vad" },
                audio: {
                  input: {
                    format: { type: "audio/pcm", rate: 24000 },
                    transcription: { model: "grok-transcribe" },
                  },
                  output: { format: { type: "audio/pcm", rate: 24000 } },
                },
                tools: convertedTools,
                tool_choice: "auto",
              },
            }),
          );

          const audioCtx = this.audioCtx!;
          const src = audioCtx.createMediaStreamSource(this.stream!);
          const proc = audioCtx.createScriptProcessor(4096, 1, 1);
          src.connect(proc);
          const sink = audioCtx.createGain();
          sink.gain.value = 0;
          proc.connect(sink);
          sink.connect(audioCtx.destination);

          // Mic also feeds the recorder mix.
          if (this.dest) {
            try {
              src.connect(this.dest);
            } catch {
              /* ignore */
            }
          }

          this.src = src;
          this.proc = proc;
          this.sink = sink;

          this.startRecorder();

          proc.onaudioprocess = (e: AudioProcessingEvent): void => {
            if (ws.readyState !== WebSocket.OPEN) {
              return;
            }
            const f32 = e.inputBuffer.getChannelData(0);
            const pcm = new Int16Array(f32.length);
            for (let i = 0; i < f32.length; i++) {
              const s = Math.max(-1, Math.min(1, f32[i]));
              pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            const b64 = base64FromBytes(new Uint8Array(pcm.buffer));
            ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b64 }));
          };

          this.setStatus("Listening…");
        } catch (err) {
          this.handleError(err);
        }
      };

      ws.onmessage = (ev: MessageEvent): void => {
        void this.onMessage(ev);
      };

      ws.onerror = (): void => {
        if (!this.stopped) {
          this.setStatus("Voice error: connection");
        }
      };

      ws.onclose = (): void => {
        if (!this.stopped) {
          this.setStatus("Voice ended");
          this.stop();
        }
      };
    } catch (err) {
      this.handleError(err);
    }
  }

  private startRecorder(): void {
    try {
      const dest = this.dest;
      if (!dest || typeof MediaRecorder === "undefined") {
        return;
      }
      let recorder: MediaRecorder;
      try {
        if (
          typeof MediaRecorder.isTypeSupported === "function" &&
          MediaRecorder.isTypeSupported("audio/webm")
        ) {
          recorder = new MediaRecorder(dest.stream, { mimeType: "audio/webm" });
        } else {
          recorder = new MediaRecorder(dest.stream);
        }
      } catch {
        recorder = new MediaRecorder(dest.stream);
      }
      recorder.ondataavailable = (e: BlobEvent): void => {
        if (e.data && e.data.size > 0) {
          this.chunks.push(e.data);
        }
      };
      recorder.start(1000);
      this.recorder = recorder;
    } catch {
      this.recorder = null;
    }
  }

  private async onMessage(ev: MessageEvent): Promise<void> {
    try {
      if (typeof ev.data !== "string") {
        return; // ignore binary frames
      }
      const event = JSON.parse(ev.data) as RealtimeEvent;
      switch (event.type) {
        case "response.output_audio.delta":
        case "response.audio.delta": {
          if (event.delta) {
            this.schedulePlayback(event.delta);
            this.setStatus("Ema is speaking…");
          }
          break;
        }

        // ---- User speech transcription ----
        case "conversation.item.input_audio_transcription.updated":
        case "conversation.item.input_audio_transcription.delta": {
          const t = event.transcript || event.text || event.delta || "";
          if (event.type.endsWith(".delta") && event.delta) {
            this.userTurnText += event.delta;
          } else if (t) {
            this.userTurnText = t;
          }
          this.userTurnEmitted = false;
          break;
        }
        case "conversation.item.input_audio_transcription.completed": {
          const t = event.transcript || event.text || "";
          if (t) {
            this.userTurnText = t;
          }
          this.flushUserTurn();
          break;
        }

        // ---- Assistant speech transcription ----
        case "response.output_audio_transcript.delta":
        case "response.audio_transcript.delta": {
          if (event.delta) {
            this.aiTurnText += event.delta;
            this.aiTurnEmitted = false;
          }
          break;
        }
        case "response.output_audio_transcript.done":
        case "response.audio_transcript.done": {
          const t = event.transcript || event.text || "";
          if (t) {
            this.aiTurnText = t;
          }
          this.flushAiTurn();
          break;
        }
        case "response.done": {
          this.flushAiTurn();
          break;
        }

        case "input_audio_buffer.speech_started": {
          this.setStatus("Listening…");
          break;
        }
        case "input_audio_buffer.speech_stopped": {
          break;
        }
        case "response.function_call_arguments.done": {
          if (event.name === "get_products") {
            this.setStatus("Thinking…");
            const q = ((): string => {
              try {
                return (JSON.parse(event.arguments || "{}") as { query?: string }).query || "";
              } catch {
                return "";
              }
            })();
            const res = await (
              await fetch(`${this.backendUrl}/tool/get-products`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: q }),
              })
            ).json();
            const ws = this.ws;
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "conversation.item.create",
                  item: {
                    type: "function_call_output",
                    call_id: event.call_id,
                    output: JSON.stringify(res),
                  },
                }),
              );
              ws.send(JSON.stringify({ type: "response.create" }));
            }
          }
          break;
        }
        case "error": {
          const msg = (event.error && event.error.message) || "unknown";
          this.setStatus("Voice error: " + msg);
          // eslint-disable-next-line no-console
          console.error("Voice error event:", event.error);
          break;
        }
        default:
          break;
      }
    } catch (err) {
      this.handleError(err);
    }
  }

  private schedulePlayback(b64: string): void {
    const audioCtx = this.audioCtx;
    if (!audioCtx) {
      return;
    }
    const bytes = bytesFromBase64(b64);
    const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const len = int16.length;
    if (len === 0) {
      return;
    }
    const buf = audioCtx.createBuffer(1, len, 24000);
    const channel = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      channel[i] = int16[i] / 32768;
    }
    const source = audioCtx.createBufferSource();
    source.buffer = buf;
    source.connect(audioCtx.destination);
    if (this.dest) {
      try {
        source.connect(this.dest);
      } catch {
        /* ignore */
      }
    }
    const startAt = Math.max(audioCtx.currentTime, this.nextTime);
    source.start(startAt);
    this.nextTime = startAt + buf.duration;
  }

  private handleError(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    this.setStatus("Voice error: " + msg);
    this.stop();
  }

  private finalizeRecording(): void {
    const recorder = this.recorder;
    this.recorder = null;
    const sessionId = this.sessionId;
    const chunks = this.chunks;
    this.chunks = [];

    const upload = (blob: Blob): void => {
      try {
        if (!blob || blob.size === 0) {
          return;
        }
        void fetch(`${this.backendUrl}/session/audio?sessionId=${encodeURIComponent(sessionId)}`, {
          method: "POST",
          headers: { "Content-Type": "audio/webm" },
          body: blob,
        }).catch((): void => {
          /* ignore */
        });
      } catch {
        /* ignore */
      }
    };

    if (!recorder) {
      if (chunks.length > 0) {
        upload(new Blob(chunks, { type: "audio/webm" }));
      }
      return;
    }

    try {
      recorder.ondataavailable = (e: BlobEvent): void => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };
      recorder.onstop = (): void => {
        upload(new Blob(chunks, { type: "audio/webm" }));
      };
      if (recorder.state !== "inactive") {
        recorder.stop();
      } else {
        upload(new Blob(chunks, { type: "audio/webm" }));
      }
    } catch {
      try {
        upload(new Blob(chunks, { type: "audio/webm" }));
      } catch {
        /* ignore */
      }
    }
  }

  private uploadLog(): void {
    try {
      const payload = {
        sessionId: this.sessionId,
        transcript: this.transcript,
        meta: { channel: "voice" },
      };
      void fetch(`${this.backendUrl}/session/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch((): void => {
        /* ignore */
      });
    } catch {
      /* ignore */
    }
  }

  stop(): void {
    const wasActive = this.active || !!this.recorder || this.transcript.length > 0;
    this.stopped = true;
    this.active = false;

    // Flush any pending partial transcripts before finalizing.
    try {
      this.flushUserTurn();
      this.flushAiTurn();
    } catch {
      /* ignore */
    }

    // Best-effort finalization (never blocks teardown).
    try {
      this.finalizeRecording();
    } catch {
      /* ignore */
    }
    try {
      if (wasActive) {
        this.uploadLog();
      }
    } catch {
      /* ignore */
    }

    if (this.proc) {
      this.proc.onaudioprocess = null;
      try {
        this.proc.disconnect();
      } catch {
        /* ignore */
      }
      this.proc = null;
    }
    if (this.src) {
      try {
        this.src.disconnect();
      } catch {
        /* ignore */
      }
      this.src = null;
    }
    if (this.sink) {
      try {
        this.sink.disconnect();
      } catch {
        /* ignore */
      }
      this.sink = null;
    }
    if (this.dest) {
      try {
        this.dest.disconnect();
      } catch {
        /* ignore */
      }
      this.dest = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
      this.stream = null;
    }
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    if (this.audioCtx) {
      const ctx = this.audioCtx;
      this.audioCtx = null;
      // Delay close slightly so the recorder can flush its final chunk.
      setTimeout((): void => {
        try {
          void ctx.close();
        } catch {
          /* ignore */
        }
      }, 250);
    }

    this.setStatus("");
    if (this.btn) {
      this.btn.classList.remove("tw-voice-active");
    }
  }
}
