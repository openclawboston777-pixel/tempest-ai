// VoiceSession: browser client for xAI/Grok realtime Speech-to-Speech
// over WebSocket streaming raw PCM audio (24kHz).

interface VoiceToken {
  token: string;
  model?: string;
  instructions?: string;
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
  name?: string;
  call_id?: string;
  arguments?: string;
  error?: { message?: string };
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

export class VoiceSession {
  private backendUrl: string;
  private container: HTMLElement;
  private statusEl: HTMLElement;
  private btn: HTMLElement | null = null;

  private active = false;
  private stopped = false;

  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private ws: WebSocket | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private proc: ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;

  private nextTime = 0;

  constructor(backendUrl: string, container: HTMLElement) {
    this.backendUrl = backendUrl;
    this.container = container;

    let statusEl = container.querySelector<HTMLElement>(".tw-voice-status");
    if (!statusEl) {
      statusEl = document.createElement("div");
      statusEl.className = "tw-voice-status";
      container.appendChild(statusEl);
    }
    this.statusEl = statusEl;
  }

  private setStatus(text: string): void {
    this.statusEl.textContent = text;
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

  async start(): Promise<void> {
    this.stopped = false;
    this.active = true;
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
                voice: ((tokenData as any).voice as string) || "eve",
                instructions,
                turn_detection: { type: "server_vad" },
                audio: {
                  input: { format: { type: "audio/pcm", rate: 24000 } },
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

          this.src = src;
          this.proc = proc;
          this.sink = sink;

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
        case "input_audio_buffer.speech_started": {
          this.setStatus("Listening…");
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
    const startAt = Math.max(audioCtx.currentTime, this.nextTime);
    source.start(startAt);
    this.nextTime = startAt + buf.duration;
  }

  private handleError(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    this.setStatus("Voice error: " + msg);
    this.stop();
  }

  stop(): void {
    this.stopped = true;
    this.active = false;

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
      try {
        void this.audioCtx.close();
      } catch {
        /* ignore */
      }
      this.audioCtx = null;
    }

    this.setStatus("");
    if (this.btn) {
      this.btn.classList.remove("tw-voice-active");
    }
  }
}
