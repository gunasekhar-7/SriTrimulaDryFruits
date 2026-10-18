/**
 * cinematic-story.js
 * High-performance, scroll-controlled video scrubber & chapter storytelling engine
 * for Sri Tirumala Dry Fruits.
 * 
 * Synchronizes video.currentTime with window scroll progress using smooth RAF lerp.
 */

(function () {
  'use strict';

  class CinematicStoryEngine {
    constructor() {
      this.track = document.getElementById('cinematic-experience');
      this.video = document.getElementById('cinematic-video');
      this.fallbackBg = document.getElementById('cinematic-fallback-bg');
      this.navbar = document.querySelector('.storefront-navbar');
      this.chapterDots = document.querySelectorAll('.hud-dot-btn');

      this.chapters = [
        document.getElementById('cinematic-chapter-1'),
        document.getElementById('cinematic-chapter-2'),
        document.getElementById('cinematic-chapter-3')
      ];

      this.duration = 6.58; // Standard Hailuo video duration fallback
      this.targetProgress = 0;
      this.currentProgress = 0;
      this.isSeeking = false;
      this.rafId = null;
      this.hasVideoError = false;

      this.chapterThresholds = [
        { start: 0.00, end: 0.32, index: 0, poster: '/videos/chapter1-first.png' },
        { start: 0.33, end: 0.65, index: 1, poster: '/videos/chapter2-middle.png' },
        { start: 0.66, end: 1.00, index: 2, poster: '/videos/chapter3-last.png' }
      ];

      if (!this.track || !this.video) {
        console.warn('[CinematicEngine] Track or video element missing.');
        return;
      }

      this.init();
    }

    init() {
      // Configure navbar
      if (this.navbar) {
        this.navbar.classList.add('cinematic-nav');
      }

      // Prepare video
      this.video.pause();
      this.video.currentTime = 0;
      this.video.muted = true;

      // Handle video metadata
      const onMetadata = () => {
        if (this.video.duration && !isNaN(this.video.duration) && this.video.duration > 0) {
          this.duration = this.video.duration;
          console.log('[CinematicEngine] Video duration detected:', this.duration.toFixed(2), 'seconds');
        }
      };

      if (this.video.readyState >= 1) {
        onMetadata();
      } else {
        this.video.addEventListener('loadedmetadata', onMetadata, { once: true });
      }

      // Handle seeked synchronization
      this.video.addEventListener('seeked', () => {
        this.isSeeking = false;
      });

      // Handle video error fallback
      this.video.addEventListener('error', (err) => {
        console.warn('[CinematicEngine] Video playback encounter: falling back to high-res chapter keyframes.', err);
        this.hasVideoError = true;
        if (this.fallbackBg) {
          this.fallbackBg.classList.add('active');
          this.fallbackBg.style.backgroundImage = "url('/videos/chapter1-first.png')";
        }
      });

      // Bind HUD and Controls
      this.bindControls();

      // Check Reduced Motion
      const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prefersReduced) {
        this.handleReducedMotion();
        return;
      }

      // Start RAF Render Loop
      this.startRenderLoop();

      // Setup ScrollTrigger / Scroll Listener
      this.setupScrollSync();

      // Initial Chapter Display
      this.updateChapter(0, 0);
    }

    bindControls() {
      // Chapter Dot Clicks
      this.chapterDots.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const targetIndex = parseInt(btn.dataset.chapterTarget, 10);
          this.scrollToChapter(targetIndex);
        });
      });
    }

    setupScrollSync() {
      if (typeof ScrollTrigger !== 'undefined') {
        ScrollTrigger.create({
          trigger: this.track,
          start: 'top top',
          end: 'bottom bottom',
          onUpdate: (self) => {
            this.targetProgress = Math.max(0, Math.min(1, self.progress));
            this.handleNavbarState(self.progress);
          }
        });
      } else {
        window.addEventListener('scroll', () => {
          this.calculateProgress();
        }, { passive: true });
        this.calculateProgress();
      }
    }

    calculateProgress() {
      const rect = this.track.getBoundingClientRect();
      const totalScrollable = rect.height - window.innerHeight;
      if (totalScrollable <= 0) return;

      const scrolled = -rect.top;
      const progress = Math.max(0, Math.min(1, scrolled / totalScrollable));
      this.targetProgress = progress;
      this.handleNavbarState(progress);
    }

    handleNavbarState(progress) {
      if (!this.navbar) return;
      const rect = this.track.getBoundingClientRect();
      if (rect.bottom <= 120 || progress >= 0.98) {
        this.navbar.classList.add('scrolled-past-cinematic');
      } else {
        this.navbar.classList.remove('scrolled-past-cinematic');
      }
    }

    startRenderLoop() {
      const loop = () => {
        // Lerp progress for smooth continuous motion (lerp factor 0.22)
        const delta = this.targetProgress - this.currentProgress;
        this.currentProgress += delta * 0.22;

        if (Math.abs(delta) < 0.0001) {
          this.currentProgress = this.targetProgress;
        }

        // Apply video scrub
        this.applyVideoTime(this.currentProgress);

        // Update active chapters
        this.evaluateChapters(this.currentProgress);

        this.rafId = requestAnimationFrame(loop);
      };

      this.rafId = requestAnimationFrame(loop);
    }

    applyVideoTime(progress) {
      if (this.hasVideoError || !this.video) return;

      const targetTime = Math.max(0, Math.min(this.duration, progress * this.duration));

      // Avoid redundant or rapid seeks that choke the decoder
      if (Math.abs(this.video.currentTime - targetTime) > 0.03 && !this.isSeeking) {
        this.isSeeking = true;

        if (typeof this.video.fastSeek === 'function') {
          try {
            this.video.fastSeek(targetTime);
          } catch {
            this.video.currentTime = targetTime;
          }
        } else {
          this.video.currentTime = targetTime;
        }
      }
    }

    evaluateChapters(progress) {
      let activeIndex = 0;
      if (progress >= 0.66) {
        activeIndex = 2;
      } else if (progress >= 0.33) {
        activeIndex = 1;
      } else {
        activeIndex = 0;
      }

      this.updateChapter(activeIndex, progress);
    }

    updateChapter(activeIndex, progress) {
      // Update Chapters DOM classes
      this.chapters.forEach((chapter, idx) => {
        if (!chapter) return;

        if (idx === activeIndex) {
          chapter.classList.remove('exit-up', 'exit-down');
          chapter.classList.add('active');
        } else if (idx < activeIndex) {
          chapter.classList.remove('active', 'exit-down');
          chapter.classList.add('exit-up');
        } else {
          chapter.classList.remove('active', 'exit-up');
          chapter.classList.add('exit-down');
        }
      });

      // Update HUD Dots
      this.chapterDots.forEach((dot) => {
        const target = parseInt(dot.dataset.chapterTarget, 10);
        if (target === activeIndex + 1) {
          dot.classList.add('active');
        } else {
          dot.classList.remove('active');
        }
      });

      // Fallback background image update if active
      if (this.hasVideoError && this.fallbackBg) {
        const threshold = this.chapterThresholds[activeIndex];
        if (threshold) {
          this.fallbackBg.style.backgroundImage = `url('${threshold.poster}')`;
        }
      }
    }

    scrollToChapter(chapterIndex) { // 1, 2, or 3
      if (!this.track) return;
      const trackTop = this.track.offsetTop;
      const trackHeight = this.track.offsetHeight - window.innerHeight;

      let targetRatio = 0.02;
      if (chapterIndex === 2) targetRatio = 0.48;
      if (chapterIndex === 3) targetRatio = 0.85;

      const destination = trackTop + trackHeight * targetRatio;

      window.scrollTo({
        top: destination,
        behavior: 'smooth'
      });
    }

    handleReducedMotion() {
      console.log('[CinematicEngine] prefers-reduced-motion active: displaying static keyframe presentation.');
      if (this.fallbackBg) {
        this.fallbackBg.classList.add('active');
        this.fallbackBg.style.backgroundImage = "url('/videos/chapter1-first.png')";
      }
      this.chapters.forEach((c) => {
        if (c) c.classList.add('active');
      });
    }

    destroy() {
      if (this.rafId) cancelAnimationFrame(this.rafId);
    }
  }

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.CinematicStory = new CinematicStoryEngine();
    });
  } else {
    window.CinematicStory = new CinematicStoryEngine();
  }
})();
