const DEFAULT_LAYERS_COUNT = 24;

const layeredElements = document.querySelectorAll('.layeredText');
layeredElements.forEach(generateLayers);
layeredElements.forEach(makeInteractive);

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/**
 * Pecah teks per huruf. Tiap huruf punya tumpukan layer 3D sendiri,
 * supaya bisa berhamburan sendiri-sendiri tapi tetap terlihat tebal.
 */
function generateLayers(element) {
  if (element.querySelector('.layers')) return;

  const layersCount = Number(element.dataset.layers) || DEFAULT_LAYERS_COUNT;
  element.style.setProperty('--layers-count', layersCount);

  const content = element.textContent.trim();
  const layerNumbers = Array.from({ length: layersCount }, (_, i) => i + 1);

  const chars = Array.from(content).map((ch) => {
    if (ch === ' ') return '<span class="char space" aria-hidden="true">&nbsp;</span>';
    const glyph = escapeHtml(ch);
    return `<span class="char" aria-hidden="true">` +
      `<span class="glyph">${glyph}</span>` +
      `<span class="layers">${layerNumbers.map((i) =>
        `<span class="layer" style="--i: ${i};">${glyph}</span>`
      ).join('')}</span>` +
    `</span>`;
  }).join('');

  // Teks utuh untuk screen reader; huruf-huruf visualnya disembunyikan.
  element.innerHTML = `<span class="sr-only">${escapeHtml(content)}</span>${chars}`;
}

/**
 * Interaksi teks 3D:
 * - Drag (mouse / jari) untuk memutar bebas, bisa 360° ke segala arah.
 * - Dilepas saat masih bergerak: terus berputar (inersia), lalu pelan-pelan
 *   kembali menghadap depan.
 * - Tap / klik: huruf-huruf berhamburan, lalu memantul kembali ke tempatnya.
 * - Mouse di desktop: teks sedikit miring mengikuti kursor.
 */
function makeInteractive(el) {
  const area = el.closest('.scene') || el;
  const reduceMotion =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const DRAG_SPEED = 0.5;    // derajat putaran per pixel drag
  const FRICTION = 0.95;     // perlambatan inersia per frame (60fps)
  const HOME_SPRING = 0.004; // tarikan kembali ke posisi menghadap depan
  const HOVER_TILT = 15;     // kemiringan maksimum mengikuti mouse (derajat)
  const TAP_MAX_MOVE = 6;    // px; lebih dari ini dianggap drag, bukan tap
  const TAP_MAX_TIME = 350;  // ms

  // Huruf berhamburan: pegas yang menarik tiap huruf kembali ke tempatnya.
  const SCATTER_POWER = 0.35; // kekuatan lemparan (dikali ukuran font)
  const SCATTER_SPIN = 20;    // putaran acak tiap huruf (derajat per frame)
  const LETTER_SPRING = 0.05; // makin besar, makin cepat kembali
  const LETTER_DAMPING = 0.88; // makin kecil, makin sedikit memantul

  let rotX = 0, rotY = 0, velX = 0, velY = 0;
  let tiltX = 0, tiltY = 0, targetTiltX = 0, targetTiltY = 0;
  let drag = null;
  let rafId = 0;
  let lastTime = 0;

  // Posisi tiap huruf: [x, y, z, rotX, rotY, rotZ] + kecepatannya.
  const letters = Array.from(el.querySelectorAll('.char:not(.space)')).map(
    (node) => ({ node, p: [0, 0, 0, 0, 0, 0], v: [0, 0, 0, 0, 0, 0], moving: false })
  );

  function nearestTurn(deg) {
    return Math.round(deg / 360) * 360;
  }

  function random(min, max) {
    return min + Math.random() * (max - min);
  }

  function scatter() {
    const fontSize = parseFloat(getComputedStyle(el).fontSize);
    const width = el.offsetWidth || 1;
    letters.forEach((letter) => {
      // -1 (paling kiri) .. 1 (paling kanan): huruf terlempar menjauhi tengah.
      const fromCenter =
        (letter.node.offsetLeft + letter.node.offsetWidth / 2) / width * 2 - 1;
      const power = fontSize * SCATTER_POWER * random(0.7, 1.3);
      letter.v[0] += (fromCenter + random(-0.5, 0.5)) * power;
      letter.v[1] += random(-1, 0.6) * power; // lebih sering ke atas
      letter.v[2] += random(-0.6, 1.2) * power; // lebih sering ke arah layar
      letter.v[3] += random(-SCATTER_SPIN, SCATTER_SPIN);
      letter.v[4] += random(-SCATTER_SPIN, SCATTER_SPIN);
      letter.v[5] += random(-SCATTER_SPIN, SCATTER_SPIN) * 1.3;
      letter.moving = true;
    });
  }

  function updateLetters(dt) {
    const damping = Math.pow(LETTER_DAMPING, dt);
    let anyMoving = false;
    letters.forEach((letter) => {
      if (!letter.moving) return;
      const { p, v } = letter;
      let energy = 0;
      for (let i = 0; i < 6; i++) {
        v[i] += -LETTER_SPRING * p[i] * dt;
        v[i] *= damping;
        p[i] += v[i] * dt;
        energy += Math.abs(p[i]) + Math.abs(v[i]);
      }
      if (energy < 0.05) {
        p.fill(0);
        v.fill(0);
        letter.moving = false;
        letter.node.style.transform = '';
        return;
      }
      anyMoving = true;
      letter.node.style.transform =
        `translate3d(${p[0]}px, ${p[1]}px, ${p[2]}px) ` +
        `rotateX(${p[3]}deg) rotateY(${p[4]}deg) rotateZ(${p[5]}deg)`;
    });
    return anyMoving;
  }

  function render() {
    el.style.transform =
      `rotateX(${rotX + tiltX}deg) rotateY(${rotY + tiltY}deg)`;
  }

  function frame(now) {
    // dt = jumlah "frame 60fps" sejak frame sebelumnya, agar kecepatan sama
    // di layar 60Hz maupun 120Hz.
    const dt = Math.min((now - lastTime) / 16.667, 3);
    lastTime = now;

    if (!drag) {
      // Pegas ke kelipatan 360° terdekat + gesekan: saat berputar cepat pegas
      // nyaris tidak terasa, saat melambat teks berhenti menghadap depan.
      velX += (nearestTurn(rotX) - rotX) * HOME_SPRING * dt;
      velY += (nearestTurn(rotY) - rotY) * HOME_SPRING * dt;
      const f = Math.pow(FRICTION, dt);
      velX *= f;
      velY *= f;
      rotX += velX * dt;
      rotY += velY * dt;
    }

    tiltX += (targetTiltX - tiltX) * Math.min(0.1 * dt, 1);
    tiltY += (targetTiltY - tiltY) * Math.min(0.1 * dt, 1);

    const lettersMoving = updateLetters(dt);
    render();

    const atRest = !drag && !lettersMoving &&
      Math.abs(velX) + Math.abs(velY) < 0.01 &&
      Math.abs(nearestTurn(rotX) - rotX) < 0.05 &&
      Math.abs(nearestTurn(rotY) - rotY) < 0.05 &&
      Math.abs(targetTiltX - tiltX) + Math.abs(targetTiltY - tiltY) < 0.05;

    if (atRest) {
      // Normalisasi supaya angka tidak membesar terus setelah banyak putaran.
      rotX = 0; rotY = 0; velX = 0; velY = 0;
      render();
      rafId = 0;
    } else {
      rafId = requestAnimationFrame(frame);
    }
  }

  function wake() {
    if (!rafId) {
      lastTime = performance.now();
      rafId = requestAnimationFrame(frame);
    }
  }

  area.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Mencegah mousedown "bawaan" ikut terkirim, supaya game dino tidak
    // ikut mulai/lompat saat teks di-drag atau di-tap.
    e.preventDefault();
    try { area.setPointerCapture(e.pointerId); } catch (err) {}
    const now = performance.now();
    drag = {
      id: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      x: e.clientX, y: e.clientY,
      startTime: now, lastMoveTime: now,
    };
    velX = 0;
    velY = 0;
    area.classList.add('dragging');
    wake();
  });

  area.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const now = performance.now();
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    const frames = Math.max((now - drag.lastMoveTime) / 16.667, 0.5);
    // Drag ke bawah: bagian atas mendekat; drag ke kanan: sisi kiri mendekat.
    rotX -= dy * DRAG_SPEED;
    rotY += dx * DRAG_SPEED;
    // Kecepatan dihaluskan, dipakai untuk inersia saat dilepas.
    velX = velX * 0.5 + (-dy * DRAG_SPEED / frames) * 0.5;
    velY = velY * 0.5 + (dx * DRAG_SPEED / frames) * 0.5;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.lastMoveTime = now;
    wake();
  });

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const now = performance.now();
    const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    const isTap = moved < TAP_MAX_MOVE && now - drag.startTime < TAP_MAX_TIME;

    // Kalau jari/mouse sempat diam sebelum dilepas, jangan lanjut berputar.
    if (now - drag.lastMoveTime > 80 || reduceMotion) {
      velX = 0;
      velY = 0;
    }
    if (isTap && !reduceMotion) {
      scatter();
    }
    drag = null;
    area.classList.remove('dragging');
    wake();
  }

  area.addEventListener('pointerup', endDrag);
  area.addEventListener('pointercancel', endDrag);

  // Desktop: sedikit miring mengikuti kursor mouse di mana pun di halaman.
  if (!reduceMotion) {
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || drag) return;
      targetTiltX = (e.clientY / window.innerHeight - 0.5) * 2 * HOVER_TILT;
      targetTiltY = (e.clientX / window.innerWidth - 0.5) * 2 * HOVER_TILT;
      wake();
    });
  }

  render();
}
