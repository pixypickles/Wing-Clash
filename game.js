(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const startButton = document.getElementById("startButton");
  const status = document.getElementById("status");
  const W = canvas.width;
  const H = canvas.height;
  const gravity = 1850;
  const keys = new Set();
  const pressed = new Set();

  const images = {};
  const imageSources = {
    neutral: "assets/neutral.png",
    flap: "assets/flap.png",
    dash: "assets/dash.png",
  };

  for (const [name, src] of Object.entries(imageSources)) {
    const img = new Image();
    img.src = src;
    images[name] = img;
  }

  let running = false;
  let lastTime = performance.now();
  let players = [];
  let ball;
  let score = [0, 0];
  let updraft;
  let goalLock = 0;

  const controls = [
    { left: "KeyA", right: "KeyD", flap: "KeyW", dash: "KeyF", kick: "KeyG", slam: "KeyH" },
    { left: "ArrowLeft", right: "ArrowRight", flap: "ArrowUp", dash: "KeyJ", kick: "KeyK", slam: "KeyL" },
  ];

  addEventListener("keydown", (event) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "Space"].includes(event.code)) event.preventDefault();
    if (!keys.has(event.code)) pressed.add(event.code);
    keys.add(event.code);
  });
  addEventListener("keyup", (event) => keys.delete(event.code));

  function floorY(x) {
    const n = Math.abs(x - W / 2) / (W / 2);
    return 630 - 270 * n * n;
  }

  function makePlayer(x, facing, index) {
    return {
      x, y: 410, vx: 0, vy: 0,
      radius: 38,
      facing,
      index,
      grounded: false,
      cooldown: 0,
      flapCooldown: 0,
      action: "neutral",
      actionTime: 0,
      hitUsed: false,
      flash: 0,
    };
  }

  function resetRound() {
    players = [makePlayer(370, 1, 0), makePlayer(910, -1, 1)];
    ball = { x: W / 2, y: 220, vx: 0, vy: 0, radius: 23, spin: 0 };
    updraft = { active: false, time: 0, next: random(4.5, 6.5), warning: 0 };
    goalLock = 0.8;
  }

  function startGame() {
    score = [0, 0];
    resetRound();
    running = true;
    startButton.hidden = true;
    status.hidden = true;
    lastTime = performance.now();
    canvas.focus?.();
  }

  startButton.addEventListener("click", startGame);
  startButton.addEventListener("pointerup", (event) => {
    event.preventDefault();
    if (!running) startGame();
  });

  document.querySelectorAll("[data-code]").forEach((button) => {
    const code = button.dataset.code;
    const down = (event) => {
      event.preventDefault();
      if (!running) startGame();
      if (!keys.has(code)) pressed.add(code);
      keys.add(code);
      button.classList.add("active");
      button.setPointerCapture?.(event.pointerId);
    };
    const up = (event) => {
      event.preventDefault();
      keys.delete(code);
      button.classList.remove("active");
    };
    button.addEventListener("pointerdown", down);
    button.addEventListener("pointerup", up);
    button.addEventListener("pointercancel", up);
    button.addEventListener("lostpointercapture", up);
  });

  function random(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function len(x, y) { return Math.hypot(x, y); }

  function beginAction(p, action) {
    if (p.cooldown > 0 || p.action !== "neutral") return;
    p.action = action;
    p.hitUsed = false;
    if (action === "dash") {
      p.actionTime = 0.23;
      p.cooldown = 0.58;
      p.vx = p.facing * 1450;
      p.vy *= 0.25;
    } else if (action === "kick") {
      p.actionTime = 0.28;
      p.cooldown = 0.55;
      p.vy = Math.min(p.vy, -250);
    } else if (action === "slam") {
      p.actionTime = 0.34;
      p.cooldown = 0.62;
      p.vy = 1250;
      p.vx *= 0.35;
    }
  }

  function updatePlayer(p, dt) {
    const c = controls[p.index];
    p.cooldown = Math.max(0, p.cooldown - dt);
    p.flapCooldown = Math.max(0, p.flapCooldown - dt);
    p.flash = Math.max(0, p.flash - dt);

    if (p.action === "neutral") {
      let move = 0;
      if (keys.has(c.left)) move -= 1;
      if (keys.has(c.right)) move += 1;
      if (move) p.facing = move;
      const target = move * 390;
      p.vx += (target - p.vx) * Math.min(1, dt * (p.grounded ? 11 : 6));

      if (pressed.has(c.flap) && p.flapCooldown <= 0) {
        // From rest, this reaches roughly one sixth of the 720px stage height.
        p.vy = Math.min(p.vy - 520, -660);
        p.flapCooldown = 0.18;
        p.action = "flap";
        p.actionTime = 0.13;
      }
      if (pressed.has(c.dash)) beginAction(p, "dash");
      if (pressed.has(c.kick)) beginAction(p, "kick");
      if (pressed.has(c.slam)) beginAction(p, "slam");
    } else {
      p.actionTime -= dt;
      if (p.actionTime <= 0) p.action = "neutral";
    }

    p.vy += gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    p.x = clamp(p.x, 30, W - 30);
    if (p.x <= 31 || p.x >= W - 31) p.vx *= -0.35;

    const fy = floorY(p.x) - p.radius;
    p.grounded = false;
    if (p.y > fy) {
      p.y = fy;
      if (p.vy > 0) p.vy *= -0.16;
      if (Math.abs(p.vy) < 100) p.vy = 0;
      p.grounded = true;
      p.vx *= 0.94;
      if (p.action === "slam") p.action = "neutral";
    }

    applyUpdraft(p, dt, 1);
  }

  function attackHitbox(p) {
    if (p.action === "dash") return { x: p.x + p.facing * 62, y: p.y, r: 63, kx: p.facing * 1250, ky: -130 };
    if (p.action === "kick") return { x: p.x + p.facing * 25, y: p.y - 62, r: 58, kx: p.facing * 300, ky: -1320 };
    if (p.action === "slam") return { x: p.x + p.facing * 10, y: p.y + 62, r: 62, kx: p.facing * 260, ky: 1380 };
    return null;
  }

  function resolveAttacks() {
    for (const p of players) {
      const hit = attackHitbox(p);
      if (!hit || p.hitUsed) continue;
      let connected = false;
      const other = players[1 - p.index];
      if (len(other.x - hit.x, other.y - hit.y) < other.radius + hit.r) {
        other.vx = hit.kx;
        other.vy = hit.ky;
        other.flash = 0.15;
        connected = true;
      }
      if (len(ball.x - hit.x, ball.y - hit.y) < ball.radius + hit.r) {
        ball.vx = hit.kx * 1.18;
        ball.vy = hit.ky * 1.12;
        connected = true;
      }
      if (connected) p.hitUsed = true;
    }
  }

  function resolvePlayerCollision() {
    const a = players[0], b = players[1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = len(dx, dy) || 1;
    const minD = a.radius + b.radius;
    if (d < minD) {
      const nx = dx / d, ny = dy / d;
      const push = (minD - d) / 2;
      a.x -= nx * push; a.y -= ny * push;
      b.x += nx * push; b.y += ny * push;
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv < 0) {
        const impulse = -rv * 0.6;
        a.vx -= nx * impulse; a.vy -= ny * impulse;
        b.vx += nx * impulse; b.vy += ny * impulse;
      }
    }
  }

  function updateBall(dt) {
    ball.vy += gravity * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.spin += ball.vx * dt * 0.004;

    if (ball.x < ball.radius) { ball.x = ball.radius; ball.vx = Math.abs(ball.vx) * 0.75; }
    if (ball.x > W - ball.radius) { ball.x = W - ball.radius; ball.vx = -Math.abs(ball.vx) * 0.75; }

    const fy = floorY(ball.x) - ball.radius;
    if (ball.y > fy) {
      ball.y = fy;
      if (ball.vy > 0) ball.vy *= -0.62;
      ball.vx *= 0.985;
      if (Math.abs(ball.vy) < 80) ball.vy = -60;
    }

    for (const p of players) {
      const dx = ball.x - p.x, dy = ball.y - p.y;
      const d = len(dx, dy) || 1;
      const minD = ball.radius + p.radius;
      if (d < minD) {
        const nx = dx / d, ny = dy / d;
        ball.x = p.x + nx * minD;
        ball.y = p.y + ny * minD;
        const rel = (ball.vx - p.vx) * nx + (ball.vy - p.vy) * ny;
        const impulse = Math.max(240, -rel * 1.25);
        ball.vx += nx * impulse + p.vx * 0.25;
        ball.vy += ny * impulse + p.vy * 0.12;
      }
    }

    applyUpdraft(ball, dt, 1.22);
  }

  function applyUpdraft(body, dt, multiplier) {
    if (!updraft.active) return;
    const halfWidth = 92;
    const dx = Math.abs(body.x - W / 2);
    if (dx < halfWidth && body.y > 80) {
      const strength = 4300 * (1 - dx / halfWidth) * multiplier;
      body.vy -= strength * dt;
      body.vx += (W / 2 - body.x) * dt * 2.2;
    }
  }

  function updateUpdraft(dt) {
    if (updraft.active) {
      updraft.time -= dt;
      if (updraft.time <= 0) {
        updraft.active = false;
        updraft.next = random(4.5, 6.5);
      }
    } else {
      updraft.next -= dt;
      updraft.warning = updraft.next < 0.65 ? 1 - updraft.next / 0.65 : 0;
      if (updraft.next <= 0) {
        updraft.active = true;
        updraft.time = 0.72;
        updraft.warning = 0;
      }
    }
  }

  function checkGoal() {
    if (goalLock > 0) return;
    const leftGoal = ball.x < 150 && ball.y < 245;
    const rightGoal = ball.x > W - 150 && ball.y < 245;
    if (leftGoal) {
      score[1]++;
      resetRound();
    } else if (rightGoal) {
      score[0]++;
      resetRound();
    }
  }

  function update(dt) {
    goalLock = Math.max(0, goalLock - dt);
    updateUpdraft(dt);
    players.forEach(p => updatePlayer(p, dt));
    resolvePlayerCollision();
    updateBall(dt);
    resolveAttacks();
    checkGoal();
    pressed.clear();
  }

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#c9f1ff");
    sky.addColorStop(1, "#fff8b8");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#ffffff99";
    for (const [x, y, s] of [[180, 115, 1], [610, 95, .8], [1040, 130, 1.1]]) {
      ctx.beginPath();
      ctx.arc(x, y, 38*s, 0, Math.PI*2);
      ctx.arc(x+42*s, y-10*s, 50*s, 0, Math.PI*2);
      ctx.arc(x+88*s, y, 35*s, 0, Math.PI*2);
      ctx.fill();
    }
  }

  function drawBowl() {
    ctx.beginPath();
    ctx.moveTo(0, floorY(0));
    for (let x = 0; x <= W; x += 12) ctx.lineTo(x, floorY(x));
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = "#9fd45a";
    ctx.fill();
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 10;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 8) {
      const y = floorY(x);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function drawNest(x, mirror) {
    ctx.save();
    ctx.translate(x, 185);
    if (mirror) ctx.scale(-1, 1);
    ctx.lineCap = "round";
    ctx.strokeStyle = "#5b341c";
    ctx.lineWidth = 14;
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.arc(0, i * 5, 78 - i * 5, 0.15, Math.PI - 0.15);
      ctx.stroke();
    }
    ctx.strokeStyle = "#8b5a2b";
    ctx.lineWidth = 7;
    for (let i = -60; i <= 60; i += 20) {
      ctx.beginPath(); ctx.moveTo(i, -10); ctx.lineTo(i + 15, 48); ctx.stroke();
    }
    ctx.restore();
  }

  function drawUpdraft() {
    if (!updraft.active && !updraft.warning) return;
    const alpha = updraft.active ? 0.8 : 0.2 + updraft.warning * 0.35;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = updraft.active ? 12 : 7;
    ctx.lineCap = "round";
    const t = performance.now() * 0.004;
    for (let i = 0; i < 6; i++) {
      const x = W/2 + Math.sin(t + i*1.4) * (22 + i*5);
      const y0 = 610 - i*18;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.bezierCurveTo(x-35, y0-80, x+40, y0-155, x, y0-245);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBall() {
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.rotate(ball.spin);
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(0, 0, ball.radius, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#222";
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      ctx.beginPath(); ctx.arc(Math.cos(a)*12, Math.sin(a)*12, 5, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  function drawPlayer(p) {
    let img = images.neutral;
    if (p.action === "flap") img = images.flap;
    if (p.action === "dash") img = images.dash;

    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.facing < 0) ctx.scale(-1, 1);

    let rotation = 0;
    if (p.action === "kick") rotation = -0.48;
    if (p.action === "slam") rotation = 0.72;
    ctx.rotate(rotation);

    if (p.flash > 0) ctx.globalAlpha = 0.45 + Math.sin(performance.now() * .06) * .25;
    const w = p.action === "dash" ? 138 : 112;
    const ratio = img.naturalWidth ? img.naturalHeight / img.naturalWidth : 0.8;
    const h = w * ratio;
    ctx.drawImage(img, -w * 0.5, -h * 0.55, w, h);
    ctx.restore();
  }

  function drawUI() {
    ctx.fillStyle = "#222";
    ctx.font = "900 52px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(`${score[0]}  -  ${score[1]}`, W/2, 65);
    ctx.font = "800 22px system-ui";
    ctx.fillText(updraft.active ? "上昇気流！" : `次の風まで ${Math.max(0, updraft.next).toFixed(1)}秒`, W/2, 98);
  }

  function draw() {
    drawBackground();
    drawNest(92, false);
    drawNest(W - 92, true);
    drawBowl();
    drawUpdraft();
    drawBall();
    players.forEach(drawPlayer);
    drawUI();

    if (!running) {
      ctx.fillStyle = "#0008";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      ctx.font = "900 66px system-ui";
      ctx.fillText("BIRD BOWL", W/2, H/2 - 35);
      ctx.font = "700 27px system-ui";
      ctx.fillText("ボールを相手側上部の巣へ！", W/2, H/2 + 18);
    }
  }

  function frame(now) {
    const dt = Math.min(0.025, (now - lastTime) / 1000);
    lastTime = now;
    if (running) update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  resetRound();
  requestAnimationFrame(frame);
})();
