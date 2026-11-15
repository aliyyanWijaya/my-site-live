const DEFAULT_LAYERS_COUNT = 24;

const layeredElements = document.querySelectorAll('.layeredText');
layeredElements.forEach(generateLayers);

function generateLayers(element) {
  if (element.querySelector('.layers')) return;
  
  const layersCount = element.dataset.layers || DEFAULT_LAYERS_COUNT;
  element.style.setProperty('--layers-count', layersCount);

  const content = element.textContent;

  element.innerHTML = `
    <span>${content}</span>
    <div class="layers" aria-hidden="true">
      ${Array.from({ length: layersCount }, (_, i) =>
        `<div class="layer" style="--i: ${i + 1};">${content}</div>`
      ).join('')}
    </div>
  `;
}

function updateTilt(x, y) {
  document.body.style.setProperty('--nx', x / window.innerWidth);
  document.body.style.setProperty('--ny', y / window.innerHeight);
}

// Desktop: ikuti mouse
window.addEventListener('mousemove', (e) => updateTilt(e.clientX, e.clientY));

// Phone/tablet: ikuti jari (passive, jadi tidak mengganggu scroll atau game)
['touchstart', 'touchmove'].forEach((type) => {
  window.addEventListener(type, (e) => {
    const t = e.touches[0];
    if (t) updateTilt(t.clientX, t.clientY);
  }, { passive: true });
});