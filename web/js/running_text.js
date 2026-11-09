/**
 * RunningTextEngine
 * Dynamic Branding Carousel with 3D Vertical Flip Slide Transition and Smart Logo Transition.
 * Designed for OBS Browser Source with zero memory leaks and hardware-accelerated GPU transitions.
 */

class RunningTextEngine {
  constructor(containerEl, options = {}) {
    this.container = containerEl || document.body;
    this.options = options;

    this.settings = {
      is_enabled: true,
      font_family: 'Poppins',
      font_size_px: 32,
      text_color: '#FFFFFF',
      transition_ms: 350
    };

    this.slides = [];
    this.activeSlides = [];
    this.currentIndex = -1;
    this.currentSlide = null;

    this.slideTimer = null;
    this.transitionTimer = null;
    this.isTransitioning = false;
    this.isPollingAttached = false;
    this.pollInterval = null;

    this.cacheDom();
    this.setupSyncChannels();
  }

  cacheDom() {
    this.dom = {
      viewport: this.container.querySelector('.rt-viewport') || this.container,
      stage: this.container.querySelector('.rt-stage'),
      logoWrapper: this.container.querySelector('.rt-logo-wrapper'),
      logoImg: this.container.querySelector('.rt-logo-img'),
      textWrapper: this.container.querySelector('.rt-text-wrapper'),
      line1: this.container.querySelector('.rt-line1'),
      line2: this.container.querySelector('.rt-line2')
    };
  }

  setupSyncChannels() {
    if (this.options.disableSync) return;

    try {
      if ('BroadcastChannel' in window) {
        this.broadcastChannel = new BroadcastChannel('zover_running_text_channel');
        this.broadcastChannel.onmessage = (event) => {
          if (event.data && event.data.type === 'RUNNING_TEXT_CONFIG') {
            this.updateConfig(event.data.data);
          }
        };
      }
    } catch (e) {}

    window.addEventListener('storage', (e) => {
      if (e.key === 'chat_overlay_running_text_trigger' && e.newValue) {
        try {
          const payload = JSON.parse(e.newValue);
          if (payload.type === 'RUNNING_TEXT_CONFIG' && payload.data) {
            this.updateConfig(payload.data);
          }
        } catch (err) {}
      }
    });
  }

  attachConfigPolling(intervalMs = 5000) {
    if (this.isPollingAttached) return;
    this.isPollingAttached = true;

    const getApiUrl = () => {
      if (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null' && !window.location.origin.startsWith('file:')) {
        return `${window.location.origin}/api/config`;
      }
      return 'http://localhost:8765/api/config';
    };

    const poll = async () => {
      try {
        const res = await fetch(getApiUrl(), { cache: 'no-store' });
        if (res.ok) {
          const cfg = await res.json();
          if (cfg && cfg.runningText) {
            this.updateConfig(cfg.runningText);
          }
        }
      } catch (e) {}
    };

    poll();
    this.pollInterval = setInterval(poll, intervalMs);
  }

  updateConfig(data) {
    if (!data) return;

    const incomingHash = JSON.stringify(data);
    if (this._lastConfigHash === incomingHash) {
      return;
    }
    this._lastConfigHash = incomingHash;

    if (data.settings) {
      this.settings = { ...this.settings, ...data.settings };
      this.applyStyleVariables();
    }

    if (Array.isArray(data.slides)) {
      this.slides = data.slides;
      this.activeSlides = this.slides
        .filter((s) => s.is_active !== false)
        .sort((a, b) => (parseInt(a.sort_order, 10) || 0) - (parseInt(b.sort_order, 10) || 0));
    }

    if (!this.settings.is_enabled || this.activeSlides.length === 0) {
      this.clearAllTimers();
      this.hideAll();
      this.currentIndex = -1;
      this.currentSlide = null;
      return;
    }

    if (this.currentIndex === -1 || !this.currentSlide) {
      this.clearAllTimers();
      this.currentIndex = -1;
      this.advanceToNextSlide();
      return;
    }

    if (this.currentIndex >= this.activeSlides.length) {
      this.currentIndex = 0;
    }

    const currentActiveSlide = this.activeSlides[this.currentIndex];
    if (currentActiveSlide) {
      this.currentSlide = currentActiveSlide;
      this.applySlideContent(currentActiveSlide, true);
    }

    if (!this.slideTimer && !this.isTransitioning) {
      const dur = (this.currentSlide && this.currentSlide.duration_ms) || 3000;
      this.scheduleNextSlide(dur);
    }
  }

  applyStyleVariables() {
    const root = this.container;
    if (!root || !root.style) return;

    if (this.settings.font_size_px) {
      root.style.setProperty('--rt-font-size', `${this.settings.font_size_px}px`);
    }
    if (this.settings.text_color) {
      root.style.setProperty('--rt-text-color', this.settings.text_color);
    }
    if (this.settings.transition_ms) {
      root.style.setProperty('--rt-transition-ms', `${this.settings.transition_ms}ms`);
    }
    if (this.settings.font_family) {
      root.style.setProperty('--rt-font-family', `'${this.settings.font_family}', sans-serif`);
    }
  }

  advanceToNextSlide() {
    if (!this.settings.is_enabled || this.activeSlides.length === 0) {
      this.hideAll();
      return;
    }

    this.currentIndex = (this.currentIndex + 1) % this.activeSlides.length;
    const nextSlide = this.activeSlides[this.currentIndex];
    this.showSlide(nextSlide);
  }

  showSlide(nextSlide) {
    if (!nextSlide) return;

    const prevSlide = this.currentSlide;
    const transitionMs = parseInt(this.settings.transition_ms, 10) || 350;

    const isFirstRun = !prevSlide;
    const sameLogo =
      !isFirstRun &&
      Boolean(prevSlide.show_logo) &&
      Boolean(nextSlide.show_logo) &&
      Boolean(prevSlide.logo_url) &&
      prevSlide.logo_url.trim() === nextSlide.logo_url.trim();

    this.isTransitioning = true;

    if (isFirstRun) {
      this.applySlideContent(nextSlide, false);
      this.dom.textWrapper.classList.remove('flip-out');
      this.dom.textWrapper.classList.add('flip-in');

      if (nextSlide.show_logo && nextSlide.logo_url) {
        this.dom.logoWrapper.classList.remove('flip-out');
        this.dom.logoWrapper.classList.add('flip-in');
      }

      this.currentSlide = nextSlide;
      this.isTransitioning = false;
      this.scheduleNextSlide(nextSlide.duration_ms);
      return;
    }

    this.dom.textWrapper.classList.remove('flip-in');
    this.dom.textWrapper.classList.add('flip-out');

    if (!sameLogo && this.dom.logoWrapper) {
      this.dom.logoWrapper.classList.remove('flip-in');
      this.dom.logoWrapper.classList.add('flip-out');
    }

    this.transitionTimer = setTimeout(() => {
      this.applySlideContent(nextSlide, sameLogo);

      this.dom.textWrapper.classList.remove('flip-out');
      this.dom.textWrapper.classList.add('flip-in');

      if (!sameLogo && nextSlide.show_logo && nextSlide.logo_url) {
        this.dom.logoWrapper.classList.remove('flip-out');
        this.dom.logoWrapper.classList.add('flip-in');
      }

      this.currentSlide = nextSlide;
      this.isTransitioning = false;
      this.scheduleNextSlide(nextSlide.duration_ms);
    }, transitionMs);
  }

  applySlideContent(slide, sameLogo) {
    if (this.dom.line1) {
      this.dom.line1.textContent = slide.text_line_1 || '';
    }

    if (this.dom.line2) {
      if (slide.text_line_2 && slide.text_line_2.trim().length > 0) {
        this.dom.line2.textContent = slide.text_line_2;
        this.dom.line2.style.display = 'block';
      } else {
        this.dom.line2.textContent = '';
        this.dom.line2.style.display = 'none';
      }
    }

    if (!sameLogo && this.dom.logoWrapper && this.dom.logoImg) {
      if (slide.show_logo && slide.logo_url && slide.logo_url.trim().length > 0) {
        const cleanUrl = this.sanitizeLogoUrl(slide.logo_url);
        this.dom.logoImg.src = cleanUrl;
        this.dom.logoWrapper.style.display = 'block';
      } else {
        this.dom.logoWrapper.style.display = 'none';
        this.dom.logoImg.removeAttribute('src');
      }
    }
  }

  sanitizeLogoUrl(url) {
    if (!url) return '';
    const trimmed = url.trim();
    if (trimmed.startsWith('javascript:') || trimmed.startsWith('data:text/html')) {
      return '';
    }
    return trimmed;
  }

  scheduleNextSlide(durationMs) {
    this.clearSlideTimer();
    const duration = parseInt(durationMs, 10) || 3000;
    this.slideTimer = setTimeout(() => {
      this.advanceToNextSlide();
    }, duration);
  }

  hideAll() {
    if (this.dom.logoWrapper) {
      this.dom.logoWrapper.classList.remove('flip-in');
      this.dom.logoWrapper.classList.add('flip-out');
      this.dom.logoWrapper.style.display = 'none';
    }
    if (this.dom.textWrapper) {
      this.dom.textWrapper.classList.remove('flip-in');
      this.dom.textWrapper.classList.add('flip-out');
    }
    if (this.dom.line1) this.dom.line1.textContent = '';
    if (this.dom.line2) {
      this.dom.line2.textContent = '';
      this.dom.line2.style.display = 'none';
    }
  }

  clearSlideTimer() {
    if (this.slideTimer) {
      clearTimeout(this.slideTimer);
      this.slideTimer = null;
    }
  }

  clearTransitionTimer() {
    if (this.transitionTimer) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }
  }

  clearAllTimers() {
    this.clearSlideTimer();
    this.clearTransitionTimer();
  }

  destroy() {
    this.clearAllTimers();
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close();
      } catch (e) {}
    }
  }
}

if (typeof window !== 'undefined') {
  window.RunningTextEngine = RunningTextEngine;
}
