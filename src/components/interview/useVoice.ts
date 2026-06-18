"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// Browser-native voice (Web Speech API). Client-only; no server, no keys.
// Recognition is Chrome/Edge/Safari; where it's missing the caller falls back
// to typed answers. Synthesis is broadly supported but voices vary per OS.

// ── Minimal Web Speech typings (not in lib.dom for SpeechRecognition) ───────
interface SRAlternative { transcript: string }
interface SRResult { isFinal: boolean; 0: SRAlternative }
interface SRResultList { length: number; [i: number]: SRResult }
interface SREvent { resultIndex: number; results: SRResultList }
interface SRErrorEvent { error: string }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SRCtor = new () => SpeechRecognitionLike;

function getSRCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface VoiceOption {
  id: string;
  label: string;
  network: boolean;
}

// Default ms of silence AFTER the candidate has spoken before we treat the turn
// as finished. Generous on purpose — a short thinking pause must not submit.
const DEFAULT_SILENCE_MS = 5000;
// How many times we'll transparently restart a recognizer that ended on its own
// (browser session timeout / hiccup) before giving up. Reset whenever the
// candidate actually speaks, so this only caps *consecutive silent* restarts.
const MAX_RESTARTS = 8;

// Turn a SpeechRecognition error code into something the candidate can act on.
function describeSRError(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked. Click the mic/site icon in your browser's address bar, allow the microphone, then try Start answering again.";
    case "audio-capture":
      return "No microphone was found. Plug one in (or check your input device) and try again.";
    case "network":
      return "Your browser couldn't reach its speech-recognition service. This is common on Edge and Chromium browsers (Brave, Arc, Opera) and behind VPNs/proxies. Use Google Chrome for voice, or switch to typing your answers below.";
    default:
      return `Speech recognition error: ${code}.`;
  }
}

export function useVoice() {
  const srCtorRef = useRef<SRCtor | null>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalRef = useRef<string>("");
  const onFinalRef = useRef<((text: string) => void) | null>(null);
  const onInterimRef = useRef<((text: string) => void) | null>(null);
  // Endpointing state machine. endReason marks a DELIBERATE stop (a sustained
  // pause after speech, or the user tapping Done); only those submit. Any other
  // end while wantListening is true is an unexpected browser timeout → restart.
  const endReasonRef = useRef<"silence" | "manual" | null>(null);
  const wantListeningRef = useRef(false);
  const restartCountRef = useRef(0);
  const bargeInRef = useRef(false);
  const autoEndpointRef = useRef(true);
  const silenceMsRef = useRef(DEFAULT_SILENCE_MS);

  const [recognitionSupported, setRecognitionSupported] = useState(false);
  const [recognitionChecked, setRecognitionChecked] = useState(false); // detection has run
  const [synthesisSupported, setSynthesisSupported] = useState(false);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voiceId, setVoiceId] = useState<string>("");
  const [rate, setRate] = useState(1);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const voiceObjsRef = useRef<Record<string, SpeechSynthesisVoice>>({});

  useEffect(() => {
    srCtorRef.current = getSRCtor();
    setRecognitionSupported(!!srCtorRef.current);
    setRecognitionChecked(true);
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      synthRef.current = window.speechSynthesis;
      setSynthesisSupported(true);
    }
  }, []);

  // Load + keep the voice list fresh (it populates asynchronously).
  useEffect(() => {
    const synth = synthRef.current;
    if (!synth) return;
    const load = () => {
      const all = synth.getVoices().filter((v) => /en[-_]/i.test(v.lang));
      if (!all.length) return;
      const objs: Record<string, SpeechSynthesisVoice> = {};
      const opts: VoiceOption[] = all.map((v) => {
        const id = `${v.name}|${v.lang}`;
        objs[id] = v;
        return { id, label: `${v.name} (${v.lang})`, network: !v.localService };
      });
      voiceObjsRef.current = objs;
      setVoices(opts);
      setVoiceId((cur) => {
        if (cur && objs[cur]) return cur;
        const preferred = all.find((v) => /natural|google|samantha|aria|jenny|online/i.test(v.name));
        return preferred ? `${preferred.name}|${preferred.lang}` : opts[0].id;
      });
    };
    load();
    synth.onvoiceschanged = load;
    return () => {
      synth.onvoiceschanged = null;
    };
  }, [synthesisSupported]);

  const cancelSpeech = useCallback(() => {
    synthRef.current?.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string) =>
      new Promise<void>((resolve) => {
        const synth = synthRef.current;
        if (!synth || !text) {
          resolve();
          return;
        }
        synth.cancel();

        // Edge/Chrome pause utterances longer than ~15s; a periodic resume()
        // keeps long lines playing. Only armed for long text to avoid the
        // resume-restarts-from-start quirk on short lines.
        let keepAlive: ReturnType<typeof setInterval> | null = null;
        const stopKeepAlive = () => {
          if (keepAlive) clearInterval(keepAlive);
          keepAlive = null;
        };
        const finish = () => {
          stopKeepAlive();
          setSpeaking(false);
          resolve();
        };

        const speakWith = (v: SpeechSynthesisVoice | undefined, isRetry: boolean) => {
          const u = new SpeechSynthesisUtterance(text);
          if (v) u.voice = v;
          u.rate = rate;
          u.onend = finish;
          u.onerror = (ev) => {
            stopKeepAlive();
            const err = (ev as unknown as { error?: string }).error ?? "";
            // "canceled"/"interrupted" = we (or the next turn) stopped it — not a
            // real failure. Anything else with a cloud voice (Edge's "Online
            // (Natural)") often is: retry once with a LOCAL voice so audio plays.
            if (!isRetry && err !== "canceled" && err !== "interrupted") {
              const local = synth
                .getVoices()
                .filter((x) => /en[-_]/i.test(x.lang))
                .find((x) => x.localService);
              if (local && local !== v) {
                speakWith(local, true);
                return;
              }
            }
            finish();
          };
          setSpeaking(true);
          synth.speak(u);
          if (text.length > 140) {
            keepAlive = setInterval(() => {
              try {
                synth.resume();
              } catch {
                /* ignore */
              }
            }, 8000);
          }
        };

        speakWith(voiceObjsRef.current[voiceId], false);
      }),
    [voiceId, rate]
  );

  const stopListening = useCallback(() => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    // A user-driven stop is a deliberate end → it should submit what we have.
    endReasonRef.current = "manual";
    recogRef.current?.stop();
  }, []);

  // Discard the current listening turn WITHOUT submitting (e.g. the user
  // switched to typing mid-answer). endReason stays null so onend doesn't fire
  // onFinal, and wantListening is cleared so it doesn't auto-restart.
  const abortListening = useCallback(() => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    endReasonRef.current = null;
    wantListeningRef.current = false;
    recogRef.current?.abort();
    setListening(false);
  }, []);

  // (Re)create and start a recognizer. Used for the initial listen AND for the
  // transparent restarts that keep a turn alive across the browser's own quiet
  // timeouts — so pausing to think never ends your answer.
  const startRecognizer = useCallback(() => {
    const Ctor = srCtorRef.current;
    if (!Ctor) return;

    const prev = recogRef.current;
    if (prev) {
      prev.onstart = prev.onresult = prev.onerror = prev.onend = null;
      try {
        prev.abort();
      } catch {
        /* ignore */
      }
      recogRef.current = null;
    }

    const r = new Ctor();
    r.lang = "en-US";
    r.continuous = true;
    r.interimResults = true;

    r.onstart = () => {
      setListening(true);
      setLastError(null);
    };

    r.onresult = (e: SREvent) => {
      if (bargeInRef.current && synthRef.current?.speaking) cancelSpeech();
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalRef.current += t;
        else interim += t;
      }
      const spoken = `${finalRef.current} ${interim}`.trim();
      onInterimRef.current?.(spoken);
      if (spoken) restartCountRef.current = 0; // real audio → reset the silent-restart cap

      // Only arm the "pause → submit" timer once the candidate has actually said
      // something, and only in auto-endpoint mode. A pause BEFORE they start (or
      // when auto-submit is off) never submits.
      if (autoEndpointRef.current && spoken) {
        if (silenceTimer.current) clearTimeout(silenceTimer.current);
        silenceTimer.current = setTimeout(() => {
          endReasonRef.current = "silence";
          try {
            r.stop();
          } catch {
            /* ignore */
          }
        }, silenceMsRef.current);
      }
    };

    r.onerror = (e: SRErrorEvent) => {
      // no-speech / aborted are benign: the browser just closed a quiet window.
      // onend decides whether to keep listening or finalize.
      if (e.error === "no-speech" || e.error === "aborted") return;
      wantListeningRef.current = false;
      setListening(false);
      setLastError(describeSRError(e.error));
    };

    r.onend = () => {
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      const reason = endReasonRef.current;
      endReasonRef.current = null;

      // Deliberate end (sustained pause after speech, or the user tapped Done).
      if (reason === "silence" || reason === "manual") {
        wantListeningRef.current = false;
        setListening(false);
        const text = finalRef.current.trim();
        if (text) onFinalRef.current?.(text);
        return;
      }

      // Unexpected end while we still intend to listen (browser timed out a
      // quiet window / transient hiccup): keep the turn alive by restarting,
      // so a thinking pause is never submitted as a finished answer.
      if (wantListeningRef.current && restartCountRef.current < MAX_RESTARTS) {
        restartCountRef.current += 1;
        startRecognizer();
        return;
      }

      // Out of consecutive silent restarts: stop, but do NOT auto-submit.
      setListening(false);
    };

    recogRef.current = r;
    try {
      r.start();
    } catch {
      /* already started */
    }
  }, [cancelSpeech]);

  // Begin a listening turn. onFinal fires only on a deliberate end.
  // autoEndpoint:false = manual mode (submit only when stopListening() is called).
  const listen = useCallback(
    (opts: {
      onFinal: (text: string) => void;
      onInterim?: (text: string) => void;
      bargeIn?: boolean;
      autoEndpoint?: boolean;
      silenceMs?: number;
    }) => {
      if (!srCtorRef.current) return;
      onFinalRef.current = opts.onFinal;
      onInterimRef.current = opts.onInterim ?? null;
      bargeInRef.current = !!opts.bargeIn;
      autoEndpointRef.current = opts.autoEndpoint !== false;
      silenceMsRef.current = opts.silenceMs ?? DEFAULT_SILENCE_MS;
      finalRef.current = "";
      endReasonRef.current = null;
      wantListeningRef.current = true;
      restartCountRef.current = 0;
      setLastError(null);
      startRecognizer();
    },
    [startRecognizer]
  );

  const clearError = useCallback(() => setLastError(null), []);

  // Tidy up on unmount.
  useEffect(() => {
    return () => {
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      recogRef.current?.abort();
      synthRef.current?.cancel();
    };
  }, []);

  return {
    recognitionSupported,
    recognitionChecked,
    synthesisSupported,
    voices,
    voiceId,
    setVoiceId,
    rate,
    setRate,
    speaking,
    listening,
    lastError,
    clearError,
    speak,
    cancelSpeech,
    listen,
    stopListening,
    abortListening,
  };
}
