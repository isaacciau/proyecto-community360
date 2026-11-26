/**
 * efectos.js — Efectos que siguen al cursor (login y dashboard)
 *  - Aro de luz que sigue al mouse y crece sobre elementos interactivos
 *  - Reflector de luz dentro de tarjetas
 *  - Inclinación 3D de las tarjetas KPI
 *  - Botones "magnéticos"
 *  - Onda al hacer clic
 *  - Fondo que se mueve suavemente con el mouse
 * Se desactiva en pantallas táctiles y si el sistema pide reducir animaciones.
 */
(() => {
  const fino    = window.matchMedia('(pointer: fine)').matches;
  const reducir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fino || reducir) return;

  document.documentElement.classList.add('efectos');

  const INTERACTIVOS = 'a, button, [role="button"], .kpi, .filtro, .hm-cell, .nav button, label[for], select';
  const TEXTO        = 'input, textarea';
  const REFLECTOR    = '.card, .kpi, .m-dato, .m-panel, .login-wrap, .h-item, .features li, .log-item';
  const INCLINAR     = '.kpi';
  const MAGNETICOS   = '.btn-primario, .btn-icono, .btn-salir, .filtro';

  // ── Elementos del cursor ──
  const crear = (clase) => { const d = document.createElement('div'); d.className = clase; document.body.appendChild(d); return d; };
  const punto  = crear('cursor-punto');
  const anillo = crear('cursor-anillo');

  let mx = innerWidth / 2, my = innerHeight / 2;   // posición real del mouse
  let ax = mx, ay = my;                            // posición suavizada del aro
  let bx = 0, by = 0;                              // desplazamiento del fondo
  let visible = false;
  const blobs = document.querySelector('.bg-blobs');

  addEventListener('mousemove', (e) => {
    mx = e.clientX; my = e.clientY;
    punto.style.transform = `translate(${mx}px, ${my}px)`;
    if (!visible) { visible = true; ax = mx; ay = my; document.documentElement.classList.add('cursor-visible'); }
  }, { passive: true });

  document.addEventListener('mouseleave', () => { visible = false; document.documentElement.classList.remove('cursor-visible'); });

  // Animación continua: el aro y el fondo siguen al mouse con suavidad
  (function bucle() {
    ax += (mx - ax) * 0.2;
    ay += (my - ay) * 0.2;
    anillo.style.transform = `translate(${ax}px, ${ay}px)`;
    if (blobs) {
      const tx = (mx / innerWidth - 0.5) * -40, ty = (my / innerHeight - 0.5) * -40;
      bx += (tx - bx) * 0.05; by += (ty - by) * 0.05;
      blobs.style.transform = `translate(${bx}px, ${by}px)`;
    }
    requestAnimationFrame(bucle);
  })();

  // ── Estado del aro según lo que hay debajo del cursor ──
  document.addEventListener('mouseover', (e) => {
    const t = e.target;
    anillo.classList.toggle('activo', !!t.closest(INTERACTIVOS));
    anillo.classList.toggle('texto',  !!t.closest(TEXTO));
  });
  addEventListener('mousedown', () => anillo.classList.add('presionado'));
  addEventListener('mouseup',   () => anillo.classList.remove('presionado'));

  // ── Onda al hacer clic ──
  addEventListener('click', (e) => {
    const onda = crear('cursor-onda');
    onda.style.left = e.clientX + 'px';
    onda.style.top  = e.clientY + 'px';
    onda.addEventListener('animationend', () => onda.remove());
    setTimeout(() => onda.remove(), 800);   // respaldo por si el navegador no avisa el final
  });

  // ── Reflector, inclinación 3D y botones magnéticos ──
  let inclinado = null, magnetico = null;

  document.addEventListener('mousemove', (e) => {
    const t = e.target;

    // Reflector de luz dentro de la tarjeta
    const spot = t.closest(REFLECTOR);
    if (spot) {
      const r = spot.getBoundingClientRect();
      spot.style.setProperty('--mx', `${e.clientX - r.left}px`);
      spot.style.setProperty('--my', `${e.clientY - r.top}px`);
    }

    // Inclinación 3D de los KPI
    const tilt = t.closest(INCLINAR);
    if (inclinado && inclinado !== tilt) { inclinado.style.removeProperty('--rx'); inclinado.style.removeProperty('--ry'); }
    inclinado = tilt;
    if (tilt) {
      const r = tilt.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      tilt.style.setProperty('--rx', `${(-py * 10).toFixed(2)}deg`);
      tilt.style.setProperty('--ry', `${(px * 12).toFixed(2)}deg`);
    }

    // Botones que se acercan al cursor
    const mag = t.closest(MAGNETICOS);
    if (magnetico && magnetico !== mag) { magnetico.style.removeProperty('--tx'); magnetico.style.removeProperty('--ty'); }
    magnetico = mag;
    if (mag && !mag.disabled) {
      const r = mag.getBoundingClientRect();
      const fuerza = mag.classList.contains('btn-primario') ? 0.12 : 0.25;
      mag.style.setProperty('--tx', `${((e.clientX - (r.left + r.width / 2)) * fuerza).toFixed(1)}px`);
      mag.style.setProperty('--ty', `${((e.clientY - (r.top + r.height / 2)) * fuerza).toFixed(1)}px`);
    }
  }, { passive: true });
})();
