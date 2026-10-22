(() => {
  "use strict";

  const WORLD = { width: 1000, height: 650 };
  const COLORS = {
    cyan: "#2de2ff",
    magenta: "#ff3df2",
    lime: "#91ff5b",
    amber: "#ffc857",
    danger: "#ff4d7d",
    white: "#edfbff",
  };

  const canvas = document.querySelector("#gameCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const gameFrame = document.querySelector("#gameFrame");
  const ui = {
    score: document.querySelector("#score"),
    level: document.querySelector("#level"),
    lives: document.querySelector("#lives"),
    best: document.querySelector("#bestScore"),
    combo: document.querySelector("#comboDisplay"),
    start: document.querySelector("#startOverlay"),
    pause: document.querySelector("#pauseOverlay"),
    gameOver: document.querySelector("#gameOverOverlay"),
    endTitle: document.querySelector("#endTitle"),
    endEyebrow: document.querySelector("#endEyebrow"),
    finalScore: document.querySelector("#finalScore"),
    newBest: document.querySelector("#newBest"),
    toast: document.querySelector("#toast"),
    sound: document.querySelector("#soundButton"),
    pauseButton: document.querySelector("#pauseButton"),
  };

  const state = {
    mode: "start",
    score: 0,
    best: 0,
    level: 1,
    lives: 3,
    combo: 0,
    comboTimer: 0,
    shake: 0,
    flash: 0,
    time: 0,
    lastTime: 0,
    pointerActive: false,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };

  const input = { left: false, right: false, pointerX: null };
  const paddle = { x: 410, y: 592, width: 180, targetWidth: 180, height: 15, speed: 750, velocity: 0 };
  let balls = [];
  let bricks = [];
  let particles = [];
  let powerUps = [];
  let stars = [];
  let shield = 0;
  let slowTimer = 0;
  let wideTimer = 0;
  let levelTransitionTimer = 0;
  let toastTimer = 0;

  function readStorage(key, fallback) {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // Storage can be unavailable in strict privacy modes; gameplay still works.
    }
  }

  state.best = Number.parseInt(readStorage("neon-breakout-best", "0"), 10) || 0;

  class SoundEngine {
    constructor() {
      this.context = null;
      this.muted = readStorage("neon-breakout-muted", "false") === "true";
    }

    init() {
      try {
        if (!this.context) {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (AudioContext) this.context = new AudioContext();
        }
        if (this.context?.state === "suspended") this.context.resume();
      } catch {
        this.context = null;
      }
    }

    tone(frequency, duration, type = "sine", volume = 0.045, slide = 0) {
      if (this.muted || !this.context) return;
      const now = this.context.currentTime;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, frequency + slide), now + duration);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      oscillator.connect(gain).connect(this.context.destination);
      oscillator.start(now);
      oscillator.stop(now + duration);
    }

    brick(strength) {
      this.tone(210 + strength * 55, 0.055, "square", 0.025, 60);
    }

    paddle() {
      this.tone(150, 0.08, "triangle", 0.04, 100);
    }

    power() {
      this.tone(380, 0.16, "sine", 0.05, 520);
      window.setTimeout(() => this.tone(760, 0.12, "sine", 0.035, 250), 70);
    }

    lose() {
      this.tone(170, 0.35, "sawtooth", 0.045, -120);
    }

    clear() {
      [440, 590, 760].forEach((note, index) => {
        window.setTimeout(() => this.tone(note, 0.16, "triangle", 0.04, 80), index * 100);
      });
    }
  }

  const sound = new SoundEngine();
  ui.sound.classList.toggle("muted", sound.muted);
  ui.sound.setAttribute("aria-label", sound.muted ? "Unmute sound" : "Mute sound");

  function formatScore(value) {
    return Math.max(0, Math.floor(value)).toString().padStart(6, "0");
  }

  function updateUI() {
    ui.score.textContent = formatScore(state.score);
    ui.level.textContent = state.level.toString().padStart(2, "0");
    ui.lives.textContent = "◆ ".repeat(Math.max(0, state.lives)).trim() || "—";
    ui.lives.setAttribute("aria-label", `${state.lives} ${state.lives === 1 ? "life" : "lives"}`);
    ui.best.textContent = formatScore(state.best);
    ui.combo.innerHTML = `Combo <strong>x${Math.max(1, state.combo)}</strong>`;
    ui.combo.classList.toggle("hot", state.combo >= 3);
  }

  function setMode(mode) {
    state.mode = mode;
    ui.start.classList.toggle("active", mode === "start");
    ui.pause.classList.toggle("active", mode === "paused");
    ui.gameOver.classList.toggle("active", mode === "gameover" || mode === "victory");
    ui.pauseButton.textContent = mode === "paused" ? "Resume" : "Pause";
  }

  function makeBall(x = paddle.x + paddle.width / 2, y = paddle.y - 14, angle = -Math.PI / 2) {
    const slowed = slowTimer > 0;
    const speed = (395 + (state.level - 1) * 20) * (slowed ? 0.72 : 1);
    return {
      x,
      y,
      prevX: x,
      prevY: y,
      radius: 8,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      trail: [],
      grace: 0.08,
      slowed,
    };
  }

  function createLevel(level) {
    bricks = [];
    const columns = 11;
    const rows = Math.min(5 + Math.floor((level - 1) / 2), 8);
    const gap = 8;
    const width = 76;
    const height = 25;
    const left = (WORLD.width - (columns * width + (columns - 1) * gap)) / 2;
    const top = 82;
    const palettes = [COLORS.cyan, COLORS.magenta, COLORS.lime, COLORS.amber];

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < columns; col += 1) {
        const skip = level > 1 && ((col + row * 2 + level) % (7 + (level % 3)) === 0);
        if (skip) continue;
        const maxHits = 1 + (level >= 2 && (row + col + level) % 6 === 0 ? 1 : 0) + (level >= 4 && row === 0 ? 1 : 0);
        bricks.push({
          x: left + col * (width + gap),
          y: top + row * (height + gap),
          width,
          height,
          hits: maxHits,
          maxHits,
          color: palettes[(row + Math.floor(col / 3) + level - 1) % palettes.length],
          pulse: Math.random() * Math.PI * 2,
        });
      }
    }
  }

  function resetPaddle() {
    paddle.targetWidth = 180;
    paddle.width = 180;
    paddle.x = (WORLD.width - paddle.width) / 2;
    paddle.velocity = 0;
    input.pointerX = null;
    wideTimer = 0;
    slowTimer = 0;
    shield = 0;
  }

  function resetRun() {
    state.score = 0;
    state.level = 1;
    state.lives = 3;
    state.combo = 0;
    state.comboTimer = 0;
    state.shake = 0;
    particles = [];
    powerUps = [];
    levelTransitionTimer = 0;
    resetPaddle();
    createLevel(state.level);
    balls = [makeBall(undefined, undefined, -Math.PI / 2 - 0.2)];
    updateUI();
  }

  function startGame() {
    sound.init();
    resetRun();
    setMode("running");
    canvas.focus({ preventScroll: true });
  }

  function restartGame() {
    startGame();
    showToast("Run restarted", COLORS.cyan);
  }

  function togglePause() {
    if (state.mode === "running") {
      setMode("paused");
    } else if (state.mode === "paused") {
      sound.init();
      setMode("running");
      state.lastTime = performance.now();
      canvas.focus({ preventScroll: true });
    }
  }

  function showToast(text, color = COLORS.white) {
    ui.toast.textContent = text;
    ui.toast.style.color = color;
    ui.toast.style.borderColor = `${color}66`;
    ui.toast.classList.remove("show");
    window.clearTimeout(toastTimer);
    requestAnimationFrame(() => ui.toast.classList.add("show"));
    toastTimer = window.setTimeout(() => ui.toast.classList.remove("show"), 1300);
  }

  function spawnParticles(x, y, color, amount = 10, force = 180) {
    const count = state.reducedMotion ? Math.ceil(amount * 0.35) : amount;
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = force * (0.25 + Math.random() * 0.75);
      const life = 0.35 + Math.random() * 0.5;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        maxLife: life,
        size: 1.5 + Math.random() * 3.5,
        color,
      });
    }
  }

  function maybeDropPowerUp(brick) {
    if (Math.random() > 0.16) return;
    const types = [
      { type: "wide", color: COLORS.cyan, label: "W" },
      { type: "multi", color: COLORS.magenta, label: "M" },
      { type: "slow", color: COLORS.lime, label: "S" },
      { type: "shield", color: COLORS.amber, label: "◆" },
    ];
    const choice = types[Math.floor(Math.random() * types.length)];
    powerUps.push({
      ...choice,
      x: brick.x + brick.width / 2,
      y: brick.y + brick.height / 2,
      vy: 125,
      rotation: 0,
    });
  }

  function applyPowerUp(power) {
    sound.power();
    spawnParticles(power.x, power.y, power.color, 24, 240);
    state.score += 250;
    if (power.type === "wide") {
      paddle.targetWidth = 260;
      wideTimer = 12;
      showToast("Wide paddle · 12s", power.color);
    } else if (power.type === "multi") {
      const sources = balls.slice(0, 2);
      sources.forEach((ball) => {
        const speed = Math.hypot(ball.vx, ball.vy);
        const current = Math.atan2(ball.vy, ball.vx);
        for (const offset of [-0.5, 0.5]) {
          const split = makeBall(ball.x, ball.y, current + offset);
          split.vx = Math.cos(current + offset) * speed;
          split.vy = Math.sin(current + offset) * speed;
          split.slowed = ball.slowed;
          balls.push(split);
        }
      });
      balls = balls.slice(0, 7);
      showToast("Multiball", power.color);
    } else if (power.type === "slow") {
      balls.forEach((ball) => {
        if (!ball.slowed) {
          ball.vx *= 0.72;
          ball.vy *= 0.72;
          ball.slowed = true;
        }
      });
      slowTimer = 8;
      showToast("Time warp · 8s", power.color);
    } else if (power.type === "shield") {
      shield = Math.min(2, shield + 1);
      showToast(`Energy shield · ${shield}`, power.color);
    }
    updateUI();
  }

  function loseLife() {
    if (state.mode !== "running") return;
    state.lives -= 1;
    state.combo = 0;
    sound.lose();
    state.shake = state.reducedMotion ? 0 : 9;
    updateUI();

    if (state.lives <= 0) {
      endGame(false);
      return;
    }

    paddle.x = (WORLD.width - paddle.width) / 2;
    balls = [makeBall(undefined, undefined, -Math.PI / 2 + (Math.random() - 0.5) * 0.45)];
    showToast("Signal restored", COLORS.danger);
  }

  function endGame(victory) {
    const oldBest = state.best;
    state.best = Math.max(state.best, state.score);
    writeStorage("neon-breakout-best", state.best);
    ui.finalScore.textContent = formatScore(state.score);
    ui.newBest.hidden = state.score <= oldBest || state.score === 0;
    ui.endTitle.textContent = victory ? "Grid Cleared" : "Game Over";
    ui.endEyebrow.textContent = victory ? "Protocol complete" : "Signal lost";
    setMode(victory ? "victory" : "gameover");
    updateUI();
  }

  function circleRectCollision(ball, rect) {
    const nearestX = Math.max(rect.x, Math.min(ball.x, rect.x + rect.width));
    const nearestY = Math.max(rect.y, Math.min(ball.y, rect.y + rect.height));
    const dx = ball.x - nearestX;
    const dy = ball.y - nearestY;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq > ball.radius * ball.radius) return null;

    if (distanceSq > 0.0001) {
      const distance = Math.sqrt(distanceSq);
      return { nx: dx / distance, ny: dy / distance, depth: ball.radius - distance };
    }

    const left = Math.abs(ball.x - rect.x);
    const right = Math.abs(rect.x + rect.width - ball.x);
    const top = Math.abs(ball.y - rect.y);
    const bottom = Math.abs(rect.y + rect.height - ball.y);
    const min = Math.min(left, right, top, bottom);
    if (min === left) return { nx: -1, ny: 0, depth: ball.radius + left };
    if (min === right) return { nx: 1, ny: 0, depth: ball.radius + right };
    if (min === top) return { nx: 0, ny: -1, depth: ball.radius + top };
    return { nx: 0, ny: 1, depth: ball.radius + bottom };
  }

  function reflect(ball, nx, ny) {
    const dot = ball.vx * nx + ball.vy * ny;
    if (dot < 0) {
      ball.vx -= 2 * dot * nx;
      ball.vy -= 2 * dot * ny;
    }
  }

  function hitBrick(ball, brick, collision) {
    reflect(ball, collision.nx, collision.ny);
    ball.x += collision.nx * (collision.depth + 0.5);
    ball.y += collision.ny * (collision.depth + 0.5);
    brick.hits -= 1;
    brick.pulse = 0;
    sound.brick(brick.hits);
    state.combo += 1;
    state.comboTimer = 2.1;
    state.score += 100 * Math.min(8, Math.max(1, state.combo));
    spawnParticles(ball.x, ball.y, brick.color, brick.hits <= 0 ? 15 : 6, 190);
    if (brick.hits <= 0) {
      maybeDropPowerUp(brick);
      const index = bricks.indexOf(brick);
      if (index >= 0) bricks.splice(index, 1);
    }
    state.shake = state.reducedMotion ? 0 : Math.min(5, state.shake + 1.1);
    updateUI();
  }

  function updateBall(ball, dt) {
    ball.prevX = ball.x;
    ball.prevY = ball.y;
    ball.grace = Math.max(0, ball.grace - dt);
    const distance = Math.hypot(ball.vx, ball.vy) * dt;
    const steps = Math.max(1, Math.ceil(distance / (ball.radius * 0.65)));
    const step = dt / steps;

    for (let i = 0; i < steps; i += 1) {
      ball.x += ball.vx * step;
      ball.y += ball.vy * step;

      if (ball.x - ball.radius < 18) {
        ball.x = 18 + ball.radius;
        ball.vx = Math.abs(ball.vx);
        sound.tone(110, 0.025, "square", 0.01, 20);
      } else if (ball.x + ball.radius > WORLD.width - 18) {
        ball.x = WORLD.width - 18 - ball.radius;
        ball.vx = -Math.abs(ball.vx);
        sound.tone(110, 0.025, "square", 0.01, 20);
      }

      if (ball.y - ball.radius < 18) {
        ball.y = 18 + ball.radius;
        ball.vy = Math.abs(ball.vy);
        sound.tone(130, 0.025, "square", 0.012, 20);
      }

      if (ball.vy > 0 && ball.y + ball.radius >= paddle.y && ball.y - ball.radius <= paddle.y + paddle.height + 5) {
        const paddleCollision = circleRectCollision(ball, paddle);
        if (paddleCollision && ball.grace <= 0) {
          const relative = Math.max(-1, Math.min(1, (ball.x - (paddle.x + paddle.width / 2)) / (paddle.width / 2)));
          const minimumSpeed = slowTimer > 0 ? 280 : 390;
          const maximumSpeed = slowTimer > 0 ? 520 : 720;
          const speed = Math.min(maximumSpeed, Math.max(minimumSpeed, Math.hypot(ball.vx, ball.vy) * 1.025));
          const angle = relative * 1.02;
          ball.vx = Math.sin(angle) * speed + paddle.velocity * 0.16;
          ball.vy = -Math.abs(Math.cos(angle) * speed);
          if (Math.abs(ball.vy) < 175) ball.vy = -175;
          ball.y = paddle.y - ball.radius - 1;
          ball.grace = 0.055;
          sound.paddle();
          spawnParticles(ball.x, paddle.y, COLORS.cyan, 5, 90);
        }
      }

      let collided = false;
      for (const brick of bricks) {
        const collision = circleRectCollision(ball, brick);
        if (collision) {
          hitBrick(ball, brick, collision);
          collided = true;
          break;
        }
      }
      if (collided) break;
    }

    if (!state.reducedMotion) {
      ball.trail.unshift({ x: ball.x, y: ball.y });
      if (ball.trail.length > 9) ball.trail.pop();
    }

    const speed = Math.hypot(ball.vx, ball.vy);
    const maxSpeed = slowTimer > 0 ? 520 : 720;
    if (speed > maxSpeed) {
      ball.vx = (ball.vx / speed) * maxSpeed;
      ball.vy = (ball.vy / speed) * maxSpeed;
    }
  }

  function updatePaddle(dt) {
    const previous = paddle.x;
    paddle.width += (paddle.targetWidth - paddle.width) * Math.min(1, dt * 7);
    if (input.pointerX !== null) {
      const target = input.pointerX - paddle.width / 2;
      const difference = target - paddle.x;
      paddle.x += difference * Math.min(1, dt * 18);
    } else {
      const direction = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      paddle.x += direction * paddle.speed * dt;
    }
    paddle.x = Math.max(20, Math.min(WORLD.width - 20 - paddle.width, paddle.x));
    paddle.velocity = dt > 0 ? (paddle.x - previous) / dt : 0;
  }

  function updatePowerUps(dt) {
    for (let i = powerUps.length - 1; i >= 0; i -= 1) {
      const power = powerUps[i];
      power.y += power.vy * dt;
      power.rotation += dt * 2.4;
      const caught = power.x + 15 > paddle.x && power.x - 15 < paddle.x + paddle.width && power.y + 15 > paddle.y && power.y - 15 < paddle.y + paddle.height;
      if (caught) {
        applyPowerUp(power);
        powerUps.splice(i, 1);
      } else if (power.y > WORLD.height + 25) {
        powerUps.splice(i, 1);
      }
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const particle = particles[i];
      particle.life -= dt;
      if (particle.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= Math.pow(0.04, dt);
      particle.vy = particle.vy * Math.pow(0.14, dt) + 45 * dt;
    }
  }

  function update(dt) {
    state.time += dt;
    updateParticles(dt);
    state.shake = Math.max(0, state.shake - dt * 24);
    state.flash = Math.max(0, state.flash - dt * 3);

    if (state.mode !== "running") return;

    if (levelTransitionTimer > 0) {
      levelTransitionTimer -= dt;
      if (levelTransitionTimer <= 0) {
        createLevel(state.level);
        powerUps = [];
        balls = [makeBall(undefined, undefined, -Math.PI / 2 + (Math.random() - 0.5) * 0.5)];
      }
      return;
    }

    updatePaddle(dt);
    updatePowerUps(dt);
    balls.forEach((ball) => updateBall(ball, dt));

    for (let i = balls.length - 1; i >= 0; i -= 1) {
      if (balls[i].y - balls[i].radius > WORLD.height + 18) balls.splice(i, 1);
    }

    if (balls.length === 0) {
      if (shield > 0) {
        shield -= 1;
        balls = [makeBall(undefined, undefined, -Math.PI / 2 + (Math.random() - 0.5) * 0.4)];
        sound.power();
        showToast(`Shield recovered · ${shield} left`, COLORS.amber);
      } else {
        loseLife();
      }
    }

    if (state.comboTimer > 0) {
      state.comboTimer -= dt;
      if (state.comboTimer <= 0 && state.combo !== 0) {
        state.combo = 0;
        updateUI();
      }
    }

    if (wideTimer > 0) {
      wideTimer -= dt;
      if (wideTimer <= 0) paddle.targetWidth = 180;
    }
    if (slowTimer > 0) {
      slowTimer -= dt;
      if (slowTimer <= 0) {
        slowTimer = 0;
        balls.forEach((ball) => {
          if (ball.slowed) {
            ball.vx /= 0.72;
            ball.vy /= 0.72;
            ball.slowed = false;
          }
        });
        showToast("Time flow restored", COLORS.lime);
      }
    }

    if (bricks.length === 0 && levelTransitionTimer <= 0) {
      state.score += 1000 * state.level;
      state.level += 1;
      state.flash = 1;
      sound.clear();
      updateUI();
      if (state.level > 8) {
        endGame(true);
      } else {
        levelTransitionTimer = 1.35;
        balls = [];
        showToast(`Level ${state.level}`, COLORS.cyan);
      }
    }
  }

  function roundedRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function drawBackground() {
    const gradient = ctx.createLinearGradient(0, 0, 0, WORLD.height);
    gradient.addColorStop(0, "#070d25");
    gradient.addColorStop(0.55, "#070b1c");
    gradient.addColorStop(1, "#040713");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    ctx.save();
    ctx.strokeStyle = "rgba(48, 157, 205, 0.075)";
    ctx.lineWidth = 1;
    const horizon = 410;
    for (let y = horizon; y < WORLD.height; y += 34) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD.width, y);
      ctx.stroke();
    }
    for (let x = -200; x <= WORLD.width + 200; x += 80) {
      ctx.beginPath();
      ctx.moveTo(WORLD.width / 2, horizon);
      ctx.lineTo(x, WORLD.height);
      ctx.stroke();
    }
    ctx.restore();

    for (const star of stars) {
      const alpha = 0.22 + Math.sin(state.time * star.speed + star.phase) * 0.16;
      ctx.fillStyle = `rgba(154, 226, 255, ${alpha})`;
      ctx.fillRect(star.x, star.y, star.size, star.size);
    }

    const topGlow = ctx.createRadialGradient(WORLD.width / 2, 0, 0, WORLD.width / 2, 0, 480);
    topGlow.addColorStop(0, "rgba(29, 102, 190, 0.16)");
    topGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = topGlow;
    ctx.fillRect(0, 0, WORLD.width, 480);
  }

  function drawArena() {
    ctx.save();
    ctx.shadowBlur = 10;
    ctx.shadowColor = "rgba(45, 226, 255, 0.55)";
    ctx.strokeStyle = "rgba(45, 226, 255, 0.28)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(18, WORLD.height - 24);
    ctx.lineTo(18, 18);
    ctx.lineTo(WORLD.width - 18, 18);
    ctx.lineTo(WORLD.width - 18, WORLD.height - 24);
    ctx.stroke();
    ctx.restore();

    if (shield > 0) {
      ctx.save();
      ctx.strokeStyle = COLORS.amber;
      ctx.globalAlpha = 0.45 + Math.sin(state.time * 5) * 0.15;
      ctx.lineWidth = 3;
      ctx.shadowBlur = 16;
      ctx.shadowColor = COLORS.amber;
      ctx.beginPath();
      ctx.moveTo(32, WORLD.height - 12);
      ctx.lineTo(WORLD.width - 32, WORLD.height - 12);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawBricks() {
    for (const brick of bricks) {
      brick.pulse += 0.02;
      const healthAlpha = 0.52 + 0.2 * (brick.hits / brick.maxHits);
      ctx.save();
      ctx.shadowBlur = 11 + Math.sin(brick.pulse) * 2;
      ctx.shadowColor = brick.color;
      roundedRect(ctx, brick.x, brick.y, brick.width, brick.height, 4);
      ctx.fillStyle = `${brick.color}${Math.round(healthAlpha * 255).toString(16).padStart(2, "0")}`;
      ctx.fill();
      ctx.shadowBlur = 0;
      const sheen = ctx.createLinearGradient(brick.x, brick.y, brick.x, brick.y + brick.height);
      sheen.addColorStop(0, "rgba(255,255,255,0.44)");
      sheen.addColorStop(0.28, "rgba(255,255,255,0.05)");
      sheen.addColorStop(1, "rgba(0,0,0,0.3)");
      ctx.fillStyle = sheen;
      ctx.fill();
      ctx.strokeStyle = `${brick.color}b8`;
      ctx.lineWidth = brick.maxHits > 1 ? 1.8 : 1;
      ctx.stroke();
      if (brick.maxHits > 1) {
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        for (let i = 0; i < brick.hits; i += 1) ctx.fillRect(brick.x + 7 + i * 7, brick.y + brick.height - 5, 4, 1);
      }
      ctx.restore();
    }
  }

  function drawPaddle() {
    ctx.save();
    ctx.shadowBlur = 24;
    ctx.shadowColor = COLORS.cyan;
    roundedRect(ctx, paddle.x, paddle.y, paddle.width, paddle.height, 8);
    const gradient = ctx.createLinearGradient(paddle.x, paddle.y, paddle.x, paddle.y + paddle.height);
    gradient.addColorStop(0, "#eaffff");
    gradient.addColorStop(0.25, COLORS.cyan);
    gradient.addColorStop(1, "#11759d");
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    roundedRect(ctx, paddle.x + 12, paddle.y + 2, paddle.width - 24, 2, 1);
    ctx.fill();
    ctx.restore();
  }

  function drawBalls() {
    for (const ball of balls) {
      ball.trail.forEach((point, index) => {
        const ratio = 1 - index / ball.trail.length;
        ctx.beginPath();
        ctx.arc(point.x, point.y, ball.radius * ratio * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(45, 226, 255, ${ratio * 0.17})`;
        ctx.fill();
      });

      ctx.save();
      ctx.shadowBlur = 24;
      ctx.shadowColor = COLORS.cyan;
      const gradient = ctx.createRadialGradient(ball.x - 2, ball.y - 3, 1, ball.x, ball.y, ball.radius);
      gradient.addColorStop(0, "#ffffff");
      gradient.addColorStop(0.35, "#b8fbff");
      gradient.addColorStop(1, COLORS.cyan);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawPowerUps() {
    for (const power of powerUps) {
      ctx.save();
      ctx.translate(power.x, power.y);
      ctx.rotate(power.rotation);
      ctx.shadowBlur = 20;
      ctx.shadowColor = power.color;
      ctx.strokeStyle = power.color;
      ctx.fillStyle = `${power.color}33`;
      ctx.lineWidth = 2;
      roundedRect(ctx, -14, -14, 28, 28, 6);
      ctx.fill();
      ctx.stroke();
      ctx.rotate(-power.rotation);
      ctx.shadowBlur = 8;
      ctx.fillStyle = "white";
      ctx.font = "bold 12px SFMono-Regular, Consolas, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(power.label, 0, 1);
      ctx.restore();
    }
  }

  function drawParticles() {
    for (const particle of particles) {
      const alpha = particle.life / particle.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.shadowBlur = 8;
      ctx.shadowColor = particle.color;
      ctx.fillRect(particle.x, particle.y, particle.size * alpha, particle.size * alpha);
      ctx.restore();
    }
  }

  function drawTransition() {
    if (levelTransitionTimer <= 0) return;
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.cyan;
    ctx.shadowBlur = 24;
    ctx.shadowColor = COLORS.cyan;
    ctx.font = "900 56px Inter, system-ui, sans-serif";
    ctx.fillText(`LEVEL ${state.level}`, WORLD.width / 2, WORLD.height / 2);
    ctx.fillStyle = "rgba(210, 246, 255, 0.7)";
    ctx.shadowBlur = 0;
    ctx.font = "700 13px SFMono-Regular, Consolas, monospace";
    ctx.fillText("GRID RECONFIGURING", WORLD.width / 2, WORLD.height / 2 + 34);
    ctx.restore();
  }

  function draw() {
    ctx.save();
    if (state.shake > 0) ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
    drawBackground();
    drawArena();
    drawBricks();
    drawPowerUps();
    drawParticles();
    drawPaddle();
    drawBalls();
    drawTransition();
    ctx.restore();

    if (state.flash > 0) {
      ctx.fillStyle = `rgba(130, 240, 255, ${state.flash * 0.14})`;
      ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    }
  }

  function frame(timestamp) {
    if (!state.lastTime) state.lastTime = timestamp;
    const dt = Math.min(0.033, Math.max(0, (timestamp - state.lastTime) / 1000));
    state.lastTime = timestamp;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  function pointerToWorld(event) {
    const rect = canvas.getBoundingClientRect();
    return ((event.clientX - rect.left) / rect.width) * WORLD.width;
  }

  function setPointer(event) {
    input.pointerX = Math.max(0, Math.min(WORLD.width, pointerToWorld(event)));
  }

  function bindHoldButton(element, key) {
    const start = (event) => {
      event.preventDefault();
      input.pointerX = null;
      input[key] = true;
      sound.init();
    };
    const stop = (event) => {
      event.preventDefault();
      input[key] = false;
    };
    element.addEventListener("pointerdown", start);
    element.addEventListener("pointerup", stop);
    element.addEventListener("pointercancel", stop);
    element.addEventListener("pointerleave", stop);
  }

  document.addEventListener("keydown", (event) => {
    if (["ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
    if (event.code === "ArrowLeft" || event.code === "KeyA") {
      input.pointerX = null;
      input.left = true;
    }
    if (event.code === "ArrowRight" || event.code === "KeyD") {
      input.pointerX = null;
      input.right = true;
    }
    if (event.code === "KeyP" || event.code === "Escape") togglePause();
    if (event.code === "Space" && state.mode === "start") startGame();
    if (event.code === "Space" && (state.mode === "gameover" || state.mode === "victory")) startGame();
  });

  document.addEventListener("keyup", (event) => {
    if (event.code === "ArrowLeft" || event.code === "KeyA") input.left = false;
    if (event.code === "ArrowRight" || event.code === "KeyD") input.right = false;
  });

  canvas.addEventListener("pointerdown", (event) => {
    state.pointerActive = true;
    canvas.setPointerCapture(event.pointerId);
    setPointer(event);
    sound.init();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (state.pointerActive || event.pointerType === "mouse") setPointer(event);
  });
  canvas.addEventListener("pointerup", (event) => {
    state.pointerActive = false;
    canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointercancel", () => {
    state.pointerActive = false;
  });

  document.querySelector("#startButton").addEventListener("click", startGame);
  document.querySelector("#playAgainButton").addEventListener("click", startGame);
  document.querySelector("#resumeButton").addEventListener("click", togglePause);
  document.querySelector("#pauseRestartButton").addEventListener("click", restartGame);
  document.querySelector("#restartButton").addEventListener("click", restartGame);
  document.querySelector("#pauseButton").addEventListener("click", togglePause);
  document.querySelector("#mobilePause").addEventListener("click", togglePause);
  document.querySelector(".brand").addEventListener("click", (event) => {
    event.preventDefault();
    if (state.mode !== "start") restartGame();
  });

  ui.sound.addEventListener("click", () => {
    sound.init();
    sound.muted = !sound.muted;
    writeStorage("neon-breakout-muted", sound.muted);
    ui.sound.classList.toggle("muted", sound.muted);
    ui.sound.setAttribute("aria-label", sound.muted ? "Unmute sound" : "Mute sound");
    ui.sound.title = sound.muted ? "Unmute sound" : "Mute sound";
    if (!sound.muted) sound.tone(440, 0.08, "sine", 0.035, 160);
  });

  bindHoldButton(document.querySelector("#mobileLeft"), "left");
  bindHoldButton(document.querySelector("#mobileRight"), "right");

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.mode === "running") setMode("paused");
  });

  window.addEventListener("blur", () => {
    input.left = false;
    input.right = false;
  });

  function initialize() {
    stars = Array.from({ length: 65 }, () => ({
      x: 25 + Math.random() * (WORLD.width - 50),
      y: 25 + Math.random() * 370,
      size: Math.random() > 0.88 ? 2 : 1,
      speed: 0.6 + Math.random() * 1.5,
      phase: Math.random() * Math.PI * 2,
    }));
    resetRun();
    setMode("start");
    updateUI();
    requestAnimationFrame(frame);
  }

  initialize();
})();
