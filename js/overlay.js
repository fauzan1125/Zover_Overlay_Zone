/**
 * OBS Chat Overlay Renderer
 * Controls real-time DOM rendering, themes, CSS animations, and message lifecycle.
 */

class OverlayRenderer {
  constructor(containerElement) {
    this.container = containerElement;
    this.theme = 'theme-gamer-neon';
    this.fontSize = 16;
    this.animation = 'anim-slide-left';
    this.maxMessages = 15;
    this.hideDuration = 15; // seconds (0 = never hide)
    this.showBadges = true;
    this.showAvatars = true;

    this.activeMessages = [];
  }

  updateConfig(config = {}) {
    if (config.theme) this.theme = config.theme;
    if (config.fontSize) this.fontSize = parseInt(config.fontSize);
    if (config.animation) this.animation = config.animation;
    if (config.maxMessages) this.maxMessages = parseInt(config.maxMessages);
    if (config.hideDuration !== undefined) this.hideDuration = parseInt(config.hideDuration);
    if (config.showBadges !== undefined) this.showBadges = !!config.showBadges;
    if (config.showAvatars !== undefined) this.showAvatars = !!config.showAvatars;

    this.applyContainerStyles();
  }

  applyContainerStyles() {
    if (!this.container) return;

    // Apply active theme class to parent wrapper
    const wrapper = this.container.closest('.obs-overlay-wrapper') || document.body;
    
    // Remove old theme classes
    wrapper.classList.remove(
      'theme-gamer-neon',
      'theme-cyberpunk',
      'theme-glassmorphism',
      'theme-minimal',
      'theme-bubble'
    );
    wrapper.classList.add(this.theme);

    // Apply font size CSS variable
    document.documentElement.style.setProperty('--overlay-font-size', `${this.fontSize}px`);
  }

  addMessage(chatData) {
    if (!this.container || !chatData) return;

    const platform = (chatData.platform || 'youtube').toLowerCase();
    
    // Create Chat Card DOM element
    const card = document.createElement('li');
    card.className = `chat-card ${platform} ${this.animation}`;
    card.id = `msg-${chatData.id || Date.now()}`;

    // Avatar Element
    let avatarHtml = '';
    if (this.showAvatars) {
      const avatarSrc = chatData.avatar || this.getDefaultAvatar(platform);
      avatarHtml = `<img class="chat-avatar" src="${this.escapeHtml(avatarSrc)}" alt="${this.escapeHtml(chatData.username)}" onerror="this.src='${this.getDefaultAvatar(platform)}'">`;
    }

    // Platform Badge Element
    let badgeHtml = '';
    if (this.showBadges) {
      let badgeLabel = 'YT';
      if (platform === 'kick') badgeLabel = 'KICK';
      if (platform === 'tiktok') badgeLabel = 'TT';

      badgeHtml = `<span class="platform-badge ${platform}">${badgeLabel}</span>`;
    }

    // Header Line with User
    const headerLine = `
      <div class="chat-header-line">
        ${badgeHtml}
        <span class="chat-author ${platform}-author" style="color: ${this.sanitizeColor(chatData.userColor)}">${this.escapeHtml(chatData.username)}</span>
      </div>
    `;

    // Message Text Content
    const messageContent = `<div class="chat-text">${this.formatMessageText(chatData.message)}</div>`;

    card.innerHTML = `
      ${avatarHtml}
      <div class="chat-content-box">
        ${headerLine}
        ${messageContent}
      </div>
    `;

    // Remove empty state placeholder if present
    const emptyState = this.container.querySelector('.chat-empty-state');
    if (emptyState) {
      emptyState.remove();
    }

    // Append to container
    this.container.appendChild(card);
    this.activeMessages.push(card);

    // Enforce Max Messages limit
    while (this.activeMessages.length > this.maxMessages) {
      const oldest = this.activeMessages.shift();
      if (oldest && oldest.parentNode) {
        oldest.remove();
      }
    }

    // Auto-hide Timer
    if (this.hideDuration > 0) {
      setTimeout(() => {
        card.classList.add('hiding');
        setTimeout(() => {
          if (card && card.parentNode) {
            card.remove();
            this.activeMessages = this.activeMessages.filter(m => m !== card);
          }
        }, 500);
      }, this.hideDuration * 1000);
    }

    // Scroll to bottom smoothly
    this.container.scrollTop = this.container.scrollHeight;
  }

  formatMessageText(text) {
    if (!text) return '';
    let sanitized = this.escapeHtml(text);
    return sanitized;
  }

  getDefaultAvatar(platform) {
    if (platform === 'kick') return 'https://kick.com/favicon.ico';
    if (platform === 'tiktok') return 'https://www.tiktok.com/favicon.ico';
    return 'https://www.youtube.com/favicon.ico';
  }

  escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Hanya izinkan warna hex valid agar tidak terjadi injeksi CSS via atribut style.
  sanitizeColor(color) {
    const c = String(color || '').trim();
    return /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c) ? c : '';
  }

  clear() {
    if (this.container) {
      this.container.innerHTML = '';
    }
    this.activeMessages = [];
  }
}

window.OverlayRenderer = OverlayRenderer;
