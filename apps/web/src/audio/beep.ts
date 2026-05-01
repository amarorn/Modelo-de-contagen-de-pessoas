/**
 * Beep via Web Audio (sem assets). Uso:
 *   await beep()                    // tom padrao (880Hz, 180ms)
 *   await beep({ kind: "cap" })     // 2 tons rapidos (pessoa com bone)
 *   await beep({ kind: "car" })     // tom longo grave (carro de cor-alvo)
 *
 * Browsers exigem gesto do usuario (click/keypress) antes de criar AudioContext.
 * Por isso `primeAudio()` deve ser chamado num click handler qualquer uma vez.
 */

type BeepKind = "default" | "cap" | "car";

let ctx: AudioContext | null = null;
let primed = false;

export function primeAudio(): void {
  if (primed) return;
  try {
    const AudioCtx =
      (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    ctx = new AudioCtx();
    if (ctx.state === "suspended") void ctx.resume();
    primed = true;
  } catch {
    /* user gesto ausente; tentar de novo depois */
  }
}

function getCtx(): AudioContext | null {
  if (!ctx) primeAudio();
  if (ctx && ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(ac: AudioContext, freq: number, durationMs: number, when = 0, gain = 0.18): void {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  g.gain.value = 0;
  osc.connect(g);
  g.connect(ac.destination);
  const start = ac.currentTime + when / 1000;
  const end = start + durationMs / 1000;
  // envelope simples (fade-in/out) para evitar clique
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.01);
  g.gain.setValueAtTime(gain, end - 0.03);
  g.gain.linearRampToValueAtTime(0, end);
  osc.start(start);
  osc.stop(end + 0.02);
}

export function beep(opts: { kind?: BeepKind } = {}): void {
  const ac = getCtx();
  if (!ac) return;
  const kind: BeepKind = opts.kind ?? "default";
  if (kind === "cap") {
    tone(ac, 1040, 100, 0);
    tone(ac, 1320, 120, 140);
  } else if (kind === "car") {
    tone(ac, 560, 320, 0);
  } else {
    tone(ac, 880, 180, 0);
  }
}
