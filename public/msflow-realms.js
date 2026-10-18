/**
 * MSFLOW 3D DIRECT MOTION HARVEST REALMS CAROUSEL ENGINE
 * 10 Floating Glass Realm Cards • Scroll-Controlled 3D Perspective • Compressed Blur • Touch Snap
 */

(function () {
  'use strict';

  // ── 3D MSFlow Motion Engine ────────────────────────────────────────────────
  function initMSFlowCarousel() {
    const stage = document.getElementById('msflowStage');
    const track = document.getElementById('msflowTrack');
    const cards = Array.from(document.querySelectorAll('.realm-card'));
    const prevBtn = document.getElementById('msflowPrev');
    const nextBtn = document.getElementById('msflowNext');
    const dotsContainer = document.getElementById('msflowDots');

    if (!stage || !track || cards.length === 0) return;

    const totalCards = cards.length;
    let targetIndex = 0;
    let currentIndex = 0;
    let isDragging = false;
    let startX = 0;
    let dragDistance = 0;
    let animFrameId = null;

    // Generate Dot Indicators
    if (dotsContainer) {
      dotsContainer.innerHTML = '';
      for (let i = 0; i < totalCards; i++) {
        const dot = document.createElement('button');
        dot.className = `msflow-dot ${i === 0 ? 'is-active' : ''}`;
        dot.setAttribute('type', 'button');
        dot.setAttribute('aria-label', `Go to Realm ${i + 1}`);
        dot.innerText = (i + 1).toString().padStart(2, '0');
        dot.addEventListener('click', () => {
          targetIndex = i;
          renderFrame();
        });
        dotsContainer.appendChild(dot);
      }
    }

    function updateDots(activeIdx) {
      if (!dotsContainer) return;
      const dots = dotsContainer.querySelectorAll('.msflow-dot');
      dots.forEach((dot, idx) => {
        if (idx === activeIdx) {
          dot.classList.add('is-active');
        } else {
          dot.classList.remove('is-active');
        }
      });
    }

    // 3D Direct Motion Math Rendering
    function update3DPositions() {
      const isMobile = window.innerWidth < 768;

      if (isMobile) {
        // Mobile view: let native scroll-snap handle positioning, update active scale
        const stageCenter = stage.scrollLeft + stage.offsetWidth / 2;
        let closestIdx = 0;
        let minDiff = Infinity;

        cards.forEach((card, idx) => {
          const cardCenter = card.offsetLeft + card.offsetWidth / 2;
          const diff = Math.abs(stageCenter - cardCenter);
          if (diff < minDiff) {
            minDiff = diff;
            closestIdx = idx;
          }
        });

        cards.forEach((card, idx) => {
          if (idx === closestIdx) {
            card.classList.add('is-active');
          } else {
            card.classList.remove('is-active');
          }
        });
        updateDots(closestIdx);
        return;
      }

      // Desktop & Tablet: Full 3D MSFlow perspective with compressed blur & parallax
      cards.forEach((card, i) => {
        const offset = i - currentIndex;
        const dist = Math.abs(offset);

        // Hide cards too far along the carousel for performance
        if (dist > 4.2) {
          card.style.visibility = 'hidden';
          card.style.pointerEvents = 'none';
          return;
        }

        card.style.visibility = 'visible';

        // 3D positioning curve matching the reference motion
        const sign = offset < 0 ? -1 : 1;
        const xSpread = 280;
        const curvedX = sign * Math.pow(dist, 0.94) * xSpread;

        // Depth: cards recede into deep Z space
        const zDepth = -Math.pow(dist, 1.25) * 150;

        // Angled inward rotation
        const rotY = Math.min(Math.max(-offset * 22, -45), 45);

        // Scale, compressed blur, and opacity
        const scale = Math.max(1.02 - dist * 0.11, 0.68);
        const blurAmount = dist < 0.25 ? 0 : Math.min((dist - 0.2) * 3.8, 9);
        const opacity = dist < 0.3 ? 1 : Math.max(1 - dist * 0.22, 0.22);
        const zIndex = Math.round(50 - dist * 10);

        card.style.transform = `translate3d(${curvedX.toFixed(1)}px, 0, ${zDepth.toFixed(1)}px) rotateY(${rotY.toFixed(1)}deg) scale(${scale.toFixed(3)})`;
        card.style.filter = `blur(${blurAmount.toFixed(1)}px)`;
        card.style.opacity = opacity.toFixed(2);
        card.style.zIndex = zIndex;

        if (dist < 0.5) {
          card.classList.add('is-active');
          card.style.pointerEvents = 'auto';
        } else {
          card.classList.remove('is-active');
          card.style.pointerEvents = 'auto'; // allow click-to-center
        }
      });

      updateDots(Math.round(currentIndex));
    }

    // Animation Loop with Smooth Damping Interpolation
    function renderFrame() {
      targetIndex = Math.max(0, Math.min(targetIndex, totalCards - 1));

      const diff = targetIndex - currentIndex;
      currentIndex += diff * 0.12;

      update3DPositions();

      if (Math.abs(diff) > 0.001) {
        animFrameId = requestAnimationFrame(renderFrame);
      } else {
        currentIndex = targetIndex;
        update3DPositions();
        animFrameId = null;
      }
    }

    function triggerMove() {
      if (!animFrameId) {
        animFrameId = requestAnimationFrame(renderFrame);
      }
    }

    // Prev / Next Controls
    if (prevBtn) {
      prevBtn.addEventListener('click', (e) => {
        e.preventDefault();
        targetIndex = Math.max(0, Math.round(currentIndex) - 1);
        triggerMove();
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', (e) => {
        e.preventDefault();
        targetIndex = Math.min(totalCards - 1, Math.round(currentIndex) + 1);
        triggerMove();
      });
    }

    // Click on side card to center it
    cards.forEach((card, idx) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.realm-explore-btn')) {
          return;
        }
        if (Math.round(currentIndex) !== idx) {
          e.preventDefault();
          targetIndex = idx;
          triggerMove();
        }
      });
    });

    // Mouse / Touch Drag Support on Stage
    stage.addEventListener('mousedown', (e) => {
      if (window.innerWidth < 768) return;
      isDragging = true;
      startX = e.clientX;
      dragDistance = 0;
      stage.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - startX;
      dragDistance += Math.abs(deltaX);
      startX = e.clientX;
      targetIndex -= deltaX * 0.004;
      triggerMove();
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        stage.style.cursor = '';
        targetIndex = Math.round(targetIndex);
        triggerMove();
      }
    });

    // Mouse Wheel scrub when hovering directly over carousel
    stage.addEventListener('wheel', (e) => {
      if (window.innerWidth < 768) return;
      if ((targetIndex <= 0 && e.deltaY < 0) || (targetIndex >= totalCards - 1 && e.deltaY > 0)) {
        return;
      }
      e.preventDefault();
      targetIndex += e.deltaY * 0.0025;
      triggerMove();
    }, { passive: false });

    // GSAP ScrollTrigger Integration for Desktop Scrollytelling
    if (typeof ScrollTrigger !== 'undefined' && typeof gsap !== 'undefined') {
      const section = document.getElementById('product-categories');
      const navbar = document.querySelector('.storefront-navbar');

      if (section && window.innerWidth >= 768) {
        const getNavHeight = () => (navbar ? navbar.offsetHeight : 70);
        ScrollTrigger.create({
          trigger: section,
          start: () => `top top+=${getNavHeight()}`,
          end: '+=1800',
          pin: true,
          pinSpacing: true,
          scrub: 0.5,
          anticipatePin: 1,
          onUpdate: (self) => {
            targetIndex = self.progress * (totalCards - 1);
            triggerMove();
          }
        });
      }
    }

    // Mobile horizontal scroll listener
    if (window.innerWidth < 768) {
      stage.addEventListener('scroll', () => {
        update3DPositions();
      }, { passive: true });
    }

    window.addEventListener('resize', () => {
      update3DPositions();
    });

    // Initial render
    update3DPositions();
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMSFlowCarousel);
  } else {
    initMSFlowCarousel();
  }
})();
