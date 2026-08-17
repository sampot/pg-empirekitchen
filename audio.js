/**
 * 總舖師傳奇 — Kenney CC0 取樣音效 + Blippy Bits BGM。
 */

const BANK = {
  ui: { src: "./assets/audio/click.ogg", volume: 0.45, size: 2 },
  confirm: { src: "./assets/audio/confirm.ogg", volume: 0.55, size: 2 },
  cook: { src: "./assets/audio/cook.ogg", volume: 0.5, size: 3 },
  serve: { src: "./assets/audio/serve.ogg", volume: 0.55, size: 3 },
  fail: { src: "./assets/audio/fail.ogg", volume: 0.6, size: 2 },
  win: { src: "./assets/audio/win.ogg", volume: 0.55, size: 1 },
  lose: { src: "./assets/audio/lose.ogg", volume: 0.5, size: 1 },
};

class Pool {
  constructor({ src, volume, size }) {
    this.volume = volume;
    this.cursor = 0;
    this.nodes = Array.from({ length: size }, () => {
      const node = new Audio(src);
      node.preload = "auto";
      node.volume = volume;
      return node;
    });
  }

  play(rate = 1, gain = 1) {
    const node = this.nodes[this.cursor];
    this.cursor = (this.cursor + 1) % this.nodes.length;
    try {
      node.pause();
      node.currentTime = 0;
      node.playbackRate = rate;
      node.volume = Math.max(0, Math.min(1, this.volume * gain));
      const played = node.play();
      if (played?.catch) played.catch(() => {});
    } catch {
      // 尚未解鎖音訊
    }
  }
}

export class GameAudio {
  constructor() {
    this.enabled = true;
    this.pools = null;
    this.bgm = null;
    this.suspended = false;
  }

  unlock() {
    if (this.pools) return;
    this.pools = {};
    for (const [name, spec] of Object.entries(BANK)) this.pools[name] = new Pool(spec);
    this.bgm = new Audio("./assets/audio/bgm.ogg");
    this.bgm.loop = true;
    this.bgm.volume = 0.22;
    this.bgm.preload = "auto";
    try {
      const primer = this.pools.ui.nodes[0];
      primer.volume = 0;
      const played = primer.play();
      if (played?.catch) played.catch(() => {});
      primer.pause();
      primer.currentTime = 0;
      primer.volume = BANK.ui.volume;
    } catch {
      // ignore
    }
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) this.pauseBgm();
    else if (!this.suspended) this.resumeBgm();
  }

  play(name, rate = 1, gain = 1) {
    if (!this.enabled) return;
    this.unlock();
    this.pools?.[name]?.play(rate, gain);
  }

  resumeBgm() {
    if (!this.enabled || this.suspended) return;
    this.unlock();
    if (!this.bgm) return;
    const played = this.bgm.play();
    if (played?.catch) played.catch(() => {});
  }

  pauseBgm() {
    try {
      this.bgm?.pause();
    } catch {
      // ignore
    }
  }

  suspend() {
    this.suspended = true;
    this.pauseBgm();
  }

  resume() {
    this.suspended = false;
    if (this.enabled) this.resumeBgm();
  }

  ui() {
    this.play("ui");
  }

  cook() {
    this.play("cook");
  }

  serve() {
    this.play("serve", 1.05);
  }

  fail() {
    this.play("fail", 0.9);
  }

  win() {
    this.play("win");
  }

  lose() {
    this.play("lose");
  }

  confirm() {
    this.play("confirm");
  }
}
