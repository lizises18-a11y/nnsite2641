
// ---------- Слайдер ----------
const sliderContainer = document.querySelector('.slider-container');
const slider = document.querySelector('.slider');
const prevButton = document.querySelector('.prev-button');
const nextButton = document.querySelector('.next-button');
const slides = Array.from(slider.querySelectorAll('img'));
const slideCount = slides.length;
const SLIDE_DELAY = 5000;            // смена картинки каждые 5 секунд
let slideIndex = 0;
let autoSlideInterval = null;

// Иконка-кошечка для пагинации (SVG, не зависит от шрифтов).
// Голова и уши красятся цветом кнопки (currentColor), глаза и нос — тёмные.
const CAT_ICON = `
<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
  <path fill="currentColor" d="M4 3 L8.6 7.2 Q12 5.8 15.4 7.2 L20 3 L20 12 A8 8 0 0 1 4 12 Z"/>
  <ellipse cx="9" cy="13" rx="1.1" ry="1.4" fill="#2b1d14"/>
  <ellipse cx="15" cy="13" rx="1.1" ry="1.4" fill="#2b1d14"/>
  <path d="M11 16 L13 16 L12 17.2 Z" fill="#2b1d14"/>
</svg>`;

// --- Создаём точки-кошечки ---
const dotsContainer = document.querySelector('.slider-dots');
for (let i = 0; i < slideCount; i++) {
    const dot = document.createElement('button');
    dot.classList.add('slider-dot');
    dot.setAttribute('aria-label', `Перейти к слайду ${i + 1}`);
    dot.innerHTML = CAT_ICON;
    dot.style.setProperty('--i', i);   // у каждого котика свой сдвиг по цвету
    if (i === 0) dot.classList.add('active');

    dot.addEventListener('click', () => {
        goToSlide(i);
        stopAutoSlide();
        startAutoSlide();
    });

    dotsContainer.appendChild(dot);
}

function showPreviousSlide() {
    goToSlide((slideIndex - 1 + slideCount) % slideCount);
}
function showNextSlide() {
    goToSlide((slideIndex + 1) % slideCount);
}

function goToSlide(newIndex) {
    if (newIndex === slideIndex) return;
    const from = slides[slideIndex];
    const to = slides[newIndex];
    slideIndex = newIndex;
    updateDots();
    particleTransition(from, to);
}

function showSlide(index) {
    slides.forEach((slide, i) => slide.classList.toggle('active', i === index));
}

function updateDots() {
    document.querySelectorAll('.slider-dot').forEach((dot, index) => {
        dot.classList.toggle('active', index === slideIndex);
    });
}


// ---------- Переход «рассыпаться на частицы и собраться» ----------
// Старая картинка рассыпается на кусочки, которые улетают влево,
// а новая собирается из кусочков, прилетающих справа. Волна идёт слева направо.
//
// Что сделано для скорости:
//  • обе картинки один раз заранее отрисовываются в маленькие холсты
//    размером с блок — кусочки копируются 1:1, без пересчёта больших фото;
//  • разрешение холста ограничено (на ретине частицы и так в движении,
//    лишние пиксели только тормозят);
//  • неподвижные части (ещё не рассыпавшиеся и уже собравшиеся)
//    рисуются одним куском, а не сотнями маленьких;
//  • число частиц подбирается под мощность устройства;
//  • если кадры всё равно не успевают — переход ускоряется, а не дёргается.
const canvas = document.createElement('canvas');
canvas.className = 'slider-canvas';
sliderContainer.appendChild(canvas);
const ctx = canvas.getContext('2d', { alpha: false });

const TRANSITION_MS = 1900;
const BG = '#ffc6c6';             // фон под частицами — цвет страницы

// Слабое устройство: мало ядер, мало памяти или узкий экран телефона
const isLowEnd =
    (navigator.hardwareConcurrency || 8) <= 4 ||
    (navigator.deviceMemory || 8) <= 4;

let animationFrame = null;
let finishCurrent = null;

// Тайминги одного кусочка (в долях общего времени)
const WAVE = 0.55;       // за сколько волна проходит слева направо
const JITTER = 0.12;     // случайный разброс старта
const OUT = 0.35;        // разлёт старого кусочка
const IN_START = 0.12;   // пауза перед прилётом нового
const IN = 0.45;         // сборка нового кусочка
const TOTAL = WAVE + JITTER + IN_START + IN;

const clamp01 = t => (t < 0 ? 0 : t > 1 ? 1 : t);

// Рисует картинку в холст размером W×H так же, как object-fit: cover
function renderCover(img, W, H, scale) {
    const off = document.createElement('canvas');
    off.width = Math.round(W * scale);
    off.height = Math.round(H * scale);
    const o = off.getContext('2d', { alpha: false });
    const k = Math.max(off.width / img.naturalWidth, off.height / img.naturalHeight);
    const w = img.naturalWidth * k;
    const h = img.naturalHeight * k;
    o.drawImage(img, (off.width - w) / 2, (off.height - h) / 2, w, h);
    return off;
}

function particleTransition(from, to) {
    if (finishCurrent) finishCurrent();    // прошлый переход ещё идёт — завершаем его сразу

    const ready = img => img.complete && img.naturalWidth > 0;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || !ready(from) || !ready(to)) {
        showSlide(slideIndex);
        return;
    }

    const W = sliderContainer.clientWidth;
    const H = sliderContainer.clientHeight;
    const S = Math.min(window.devicePixelRatio || 1, isLowEnd ? 1 : 1.5);
    canvas.width = Math.round(W * S);
    canvas.height = Math.round(H * S);

    const fromImg = renderCover(from, W, H, S);
    const toImg = renderCover(to, W, H, S);

    // Размер частицы: мелкий, но с потолком по количеству
    const maxTiles = isLowEnd ? 1400 : 3200;
    let size = Math.max(8, Math.round(W / 90));
    while (Math.ceil(W / size) * Math.ceil(H / size) > maxTiles) size++;
    const cols = Math.ceil(W / size);
    const rows = Math.ceil(H / size);
    const n = cols * rows;
    const ss = size * S;                       // размер кусочка в пикселях холста

    // Параметры частиц в плоских массивах — так быстрее, чем тысячи объектов.
    // Порядок: по колонкам, чтобы перебирать только «живую» полосу у волны.
    const tx = new Float32Array(n), ty = new Float32Array(n), delay = new Float32Array(n);
    const outX = new Float32Array(n), outY = new Float32Array(n), outR = new Float32Array(n);
    const inX = new Float32Array(n), inY = new Float32Array(n), inR = new Float32Array(n);
    for (let c = 0, i = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++, i++) {
            tx[i] = c * size;
            ty[i] = r * size;
            delay[i] = (c / cols) * WAVE + Math.random() * JITTER;
            outX[i] = -(120 + Math.random() * 380);
            outY[i] = (Math.random() - 0.5) * 320 - 60;
            outR[i] = (Math.random() - 0.5) * 6;
            inX[i] = 160 + Math.random() * 420;
            inY[i] = (Math.random() - 0.5) * 320;
            inR[i] = (Math.random() - 0.5) * 6;
        }
    }

    function drawTile(src, i, cx, cy, rot, scale, alpha) {
        if (alpha < 0.02) return;
        const cos = Math.cos(rot) * scale * S;
        const sin = Math.sin(rot) * scale * S;
        ctx.globalAlpha = alpha;
        ctx.setTransform(cos, sin, -sin, cos, cx * S, cy * S);
        // +1 — чтобы между кусочками не было щелей
        ctx.drawImage(src, tx[i] * S, ty[i] * S, ss + 1, ss + 1, -size / 2, -size / 2, size + 1 / S, size + 1 / S);
    }

    function frame(u) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.fillStyle = BG;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Колонки, где новая картинка уже точно собралась, — одним куском
        const landedCols = Math.max(0, Math.min(cols, Math.floor(((u - JITTER - IN_START - IN) / WAVE) * cols)));
        // Колонки, до которых волна ещё точно не дошла, — тоже одним куском
        const staticFrom = Math.max(0, Math.min(cols, Math.ceil((u / WAVE) * cols)));
        // Колонки, где старые кусочки уже точно улетели
        const goneCols = Math.max(0, Math.min(cols, Math.floor(((u - JITTER - OUT) / WAVE) * cols)));

        if (landedCols > 0) {
            const w = Math.min(canvas.width, landedCols * ss);
            ctx.drawImage(toImg, 0, 0, w, canvas.height, 0, 0, w, canvas.height);
        }

        // Новые кусочки в полёте
        for (let i = landedCols * rows; i < staticFrom * rows; i++) {
            const p = clamp01((u - delay[i] - IN_START) / IN);
            if (p <= 0) continue;
            const k = 1 - p;
            const e = 1 - k * k * k;           // плавное торможение
            const m = 1 - e;
            drawTile(toImg, i,
                tx[i] + size / 2 + inX[i] * m,
                ty[i] + size / 2 + inY[i] * m,
                inR[i] * m, 0.3 + 0.7 * e, p * 1.6 > 1 ? 1 : p * 1.6);
        }

        // Старые кусочки: стоят, пока до них не дошла волна, затем разлетаются
        for (let i = goneCols * rows; i < staticFrom * rows; i++) {
            const q = clamp01((u - delay[i]) / OUT);
            if (q >= 1) continue;
            const e = q * q;                   // плавный разгон
            drawTile(fromImg, i,
                tx[i] + size / 2 + outX[i] * e,
                ty[i] + size / 2 + outY[i] * e,
                outR[i] * e, 1 - 0.7 * e, 1 - q);
        }

        if (staticFrom < cols) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            const x = Math.round(staticFrom * ss);
            ctx.drawImage(fromImg, x, 0, canvas.width - x, canvas.height, x, 0, canvas.width - x, canvas.height);
        }
    }

    const finish = () => {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
        finishCurrent = null;
        canvas.classList.remove('visible');
    };
    finishCurrent = finish;

    // Первый кадр — копия старой картинки, только потом прячем настоящую
    frame(0);
    canvas.classList.add('visible');
    showSlide(slideIndex);

    // Время идёт по часам, а не по кадрам: если устройство не успевает,
    // эффект просто пропускает промежуточные кадры и не растягивается
    let start = null;
    const loop = now => {
        if (start === null) start = now;
        const t = (now - start) / TRANSITION_MS;
        if (t >= 1) { finish(); return; }
        frame(t * TOTAL);
        animationFrame = requestAnimationFrame(loop);
    };
    animationFrame = requestAnimationFrame(loop);
}

// Ресайз окна во время перехода — просто завершаем его
window.addEventListener('resize', () => { if (finishCurrent) finishCurrent(); });


// --- Кнопки ---
prevButton.addEventListener('click', () => {
    showPreviousSlide();
    stopAutoSlide();
    startAutoSlide();
});
nextButton.addEventListener('click', () => {
    showNextSlide();
    stopAutoSlide();
    startAutoSlide();
});

// --- Автопрокрутка ---
function startAutoSlide() {
    if (autoSlideInterval) return;
    autoSlideInterval = setInterval(showNextSlide, SLIDE_DELAY);
}
function stopAutoSlide() {
    clearInterval(autoSlideInterval);
    autoSlideInterval = null;
}

showSlide(slideIndex);
startAutoSlide();

// Пауза при наведении — только там, где есть мышь.
// На телефоне касание вызывает mouseenter без mouseleave, и прокрутка бы залипла.
if (window.matchMedia('(hover: hover)').matches) {
    sliderContainer.addEventListener('mouseenter', stopAutoSlide);
    sliderContainer.addEventListener('mouseleave', startAutoSlide);
}

// Свайп пальцем по слайдеру — листать фото на телефоне
let touchX = null, touchY = null;
sliderContainer.addEventListener('touchstart', e => {
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
}, { passive: true });
sliderContainer.addEventListener('touchend', e => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    touchX = touchY = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;   // это не свайп, а прокрутка страницы
    if (dx < 0) showNextSlide(); else showPreviousSlide();
    stopAutoSlide();
    startAutoSlide();
}, { passive: true });











function openFullscreenImage(element) {
    const fullscreenContainer = document.getElementById('fullscreen-container');
    const fullscreenImage = document.getElementById('fullscreen-image');
    fullscreenImage.src = element.src;
    fullscreenContainer.style.display = 'block';
}
function closeFullscreenImage() {
    const fullscreenContainer = document.getElementById('fullscreen-container');
    fullscreenContainer.style.display = 'none';
}

// Закрытие по клику на саму картинку
document.getElementById('fullscreen-image').addEventListener('click', closeFullscreenImage);

window.onscroll = function() {
  scrollFunction();
};


function scrollFunction() {
  if (document.body.scrollTop > 20 || document.documentElement.scrollTop > 20) {
      document.getElementById('scrollToTopButton').style.display = 'block';
  } else {
      document.getElementById('scrollToTopButton').style.display = 'none';
  }
}



document.getElementById('scrollToTopButton').addEventListener('click', function() {
  scrollToTop();
});


function scrollToTop() {
  const scrollStep = -window.scrollY / 15;
  const scrollInterval = setInterval(function() {
      if (window.scrollY !== 0) {
          window.scrollBy(0, scrollStep);
      } else {
          clearInterval(scrollInterval);
      }
  }, 15);
}



