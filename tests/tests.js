/**
 * ZoVer Unit & Integration Test Suite
 * Tests every component and logic branch across all client-side files:
 * - tts.js (MbakGoogleTTS)
 * - overlay.js (OverlayRenderer)
 * - viewcount.js (ViewCountMonitor)
 * - connectors/kick.js (KickConnector)
 * - connectors/tikfinity.js (TikFinityConnector)
 * - connectors/tiktok.js (TikTokConnector)
 * - connectors/youtube.js (YouTubeConnector)
 * - alerts.js (AlertOverlayManager)
 * - app.js (Application State & Cross-Window Sync)
 */

(function (root) {
  const runner = {
    total: 0,
    passed: 0,
    failed: 0,
    results: [],

    assert(testName, condition, details = '') {
      this.total++;
      if (condition) {
        this.passed++;
        this.results.push({ name: testName, status: 'pass' });
        console.log(`%c[PASS] ${testName}`, 'color: #10b981');
      } else {
        this.failed++;
        this.results.push({ name: testName, status: 'fail', details });
        console.error(`[FAIL] ${testName}`, details);
      }
    },

    assertEqual(testName, actual, expected) {
      const match = JSON.stringify(actual) === JSON.stringify(expected);
      this.assert(testName, match, `Expected: ${JSON.stringify(expected)} | Received: ${JSON.stringify(actual)}`);
    }
  };

  root.TestRunner = runner;

  // =========================================================================
  // SUITE 1: TTS Logic (tts.js - MbakGoogleTTS)
  // =========================================================================
  function runTtsTests() {
    console.group('--- 1. MbakGoogleTTS Tests ---');
    const tts = new MbakGoogleTTS();

    // 1.1 sanitizeForSpeech
    runner.assertEqual(
      'TTS: Sanitize run of @@@@ into single space (not mention)',
      tts.sanitizeForSpeech('Halo @@@@ kawan'),
      'Halo kawan'
    );

    runner.assertEqual(
      'TTS: Retain valid mention @budi',
      tts.sanitizeForSpeech('Halo @budi apa kabar?'),
      'Halo @budi apa kabar?'
    );

    runner.assertEqual(
      'TTS: Collapse duplicate exclamation / question marks',
      tts.sanitizeForSpeech('Keren banget nih!!!!!!???'),
      'Keren banget nih'
    );

    runner.assertEqual(
      'TTS: Clean multiple spaces and whitespace',
      tts.sanitizeForSpeech('  tes   spasi   banyak  '),
      'tes spasi banyak'
    );

    // 1.2 Blacklist Filtering
    tts.updateConfig({
      blacklistedWords: ['toxic', 'kasar'],
      ignoredPrefixes: ['!', '/']
    });

    tts.queue = [];
    tts.isPlaying = false;

    tts.speakMessage({ platform: 'youtube', username: 'User1', message: '!drop command' });
    runner.assertEqual('TTS: Ignore command prefixes (!)', tts.queue.length, 0);

    tts.speakMessage({ platform: 'youtube', username: 'User1', message: 'Kamu sangat toxic sekali' });
    runner.assertEqual('TTS: Blacklist filter ignores toxic message', tts.queue.length, 0);

    // 1.3 Platform Disable Filter
    tts.updateConfig({
      platforms: { kick: false, youtube: true }
    });
    tts.speakMessage({ platform: 'kick', username: 'KickGuy', message: 'Halo dari Kick' });
    runner.assertEqual('TTS: Disable platform filter suppresses kick', tts.queue.length, 0);

    // 1.4 URL Replacement
    tts.updateConfig({
      platforms: { youtube: true },
      template: '{user} berkata {message}'
    });
    const origPlayNext = tts.playNext;
    tts.playNext = function () {}; // Stub to prevent shifting from queue
    tts.queue = [];
    tts.speakMessage({ platform: 'youtube', username: 'Andi', message: 'Kunjungi https://example.com/test dong' });
    runner.assert(
      'TTS: URL replaced with readable phrase "sebuah tautan"',
      tts.queue.length > 0 && tts.queue[0].includes('sebuah tautan')
    );
    tts.playNext = origPlayNext;

    // 1.5 Template Multiple Substitution Check
    tts.queue = [];
    tts.template = '{user} dari {platform} menyapa {user}: {message}';
    const origPlayNext2 = tts.playNext;
    tts.playNext = function () {};
    tts.speakMessage({ platform: 'youtube', username: 'Budi', message: 'Semangat' });
    const formatted = tts.queue[0] || '';
    tts.playNext = origPlayNext2;
    // Check if second {user} was replaced or remained unparsed (detecting single-replace bug)
    runner.assert(
      'TTS: Multiple occurrences of {user} in template replaced properly',
      !formatted.includes('{user}'),
      `Formatted result was: "${formatted}"`
    );

    tts.stop();
    console.groupEnd();
  }

  // =========================================================================
  // SUITE 2: Overlay Renderer (overlay.js - OverlayRenderer)
  // =========================================================================
  function runOverlayTests() {
    console.group('--- 2. OverlayRenderer Tests ---');
    const container = document.createElement('ul');
    container.className = 'chat-stream-list';
    document.body.appendChild(container);

    const renderer = new OverlayRenderer(container);
    renderer.updateConfig({
      theme: 'theme-gamer-neon',
      fontSize: 18,
      maxMessages: 3,
      showBadges: true,
      showAvatars: true,
      hideDuration: 0 // Keep in DOM for tests
    });

    // 2.1 CSS / Styles Application
    runner.assert('Overlay: Wrapper applied active theme class', document.body.classList.contains('theme-gamer-neon'));
    runner.assertEqual(
      'Overlay: CSS variable font-size matches configuration',
      document.documentElement.style.getPropertyValue('--overlay-font-size'),
      '18px'
    );

    // 2.2 Color Sanitization
    runner.assertEqual('Overlay: Valid 6-digit hex color accepted', renderer.sanitizeColor('#53FC18'), '#53FC18');
    runner.assertEqual('Overlay: Valid 3-digit hex color accepted', renderer.sanitizeColor('#fff'), '#fff');
    runner.assertEqual('Overlay: Malicious CSS injection string rejected', renderer.sanitizeColor('red; background:url(x);'), '');
    runner.assertEqual('Overlay: JavaScript pseudo-protocol rejected', renderer.sanitizeColor('javascript:alert(1)'), '');

    // 2.3 HTML Escaping & XSS Protection in Usernames & Messages
    const maliciousChat = {
      id: 'test-xss-1',
      platform: 'youtube',
      username: 'Hacker<script>alert(1)</script>',
      userColor: '#ff0000',
      message: 'Hello <img src="x" onerror="alert(2)"> & "quotes"',
      avatar: 'https://example.com/avatar.png'
    };

    renderer.addMessage(maliciousChat);
    const renderedCard = container.querySelector('#msg-test-xss-1');
    runner.assert('Overlay: Chat card DOM element created', !!renderedCard);

    // Verify script tag is not executed and escaped
    const textNodeHtml = renderedCard.querySelector('.chat-text')?.innerHTML || '';
    runner.assert('Overlay: Script / img tags in message are escaped', !textNodeHtml.includes('<img src="x"') && textNodeHtml.includes('&lt;img'));

    // Check attribute injection on alt attribute
    const avatarImg = renderedCard.querySelector('.chat-avatar');
    runner.assert(
      'Overlay: Avatar alt tag escapes malicious username',
      avatarImg && !avatarImg.outerHTML.includes('<script>')
    );

    // 2.4 Max Messages (FIFO Trimming)
    renderer.addMessage({ id: 'msg-2', platform: 'kick', username: 'User2', message: 'P2' });
    renderer.addMessage({ id: 'msg-3', platform: 'tiktok', username: 'User3', message: 'P3' });
    renderer.addMessage({ id: 'msg-4', platform: 'youtube', username: 'User4', message: 'P4' });

    runner.assertEqual(
      'Overlay: Active messages strictly clamped to maxMessages (3)',
      container.querySelectorAll('.chat-card').length,
      3
    );
    runner.assert('Overlay: Oldest message msg-test-xss-1 was evicted', !container.querySelector('#msg-test-xss-1'));

    // 2.5 Clear
    renderer.clear();
    runner.assertEqual('Overlay: Clear removes all cards', container.children.length, 0);

    container.remove();
    console.groupEnd();
  }

  // =========================================================================
  // SUITE 3: ViewCount Monitor (viewcount.js - ViewCountMonitor)
  // =========================================================================
  function runViewCountTests() {
    console.group('--- 3. ViewCountMonitor Tests ---');
    const bar = document.createElement('div');
    bar.id = 'viewcount-bar';
    document.body.appendChild(bar);

    const monitor = new ViewCountMonitor();
    monitor.enabled = true;
    monitor.platforms = { kick: true, youtube: true, tiktok: true };

    // 3.1 YouTube ID Extraction across diverse formats
    const singleRaw = 'QWZXv51H918';
    runner.assertEqual('ViewCount: Parse raw 11-char ID', monitor.parseYtIds(singleRaw), ['QWZXv51H918']);

    const standardUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    runner.assertEqual('ViewCount: Parse standard watch URL', monitor.parseYtIds(standardUrl), ['dQw4w9WgXcQ']);

    const liveShareUrl = 'https://www.youtube.com/live/QWZXv51H918?si=3tD17Y_a0xBGmO7Q';
    runner.assertEqual('ViewCount: Parse /live/ URL with query param', monitor.parseYtIds(liveShareUrl), ['QWZXv51H918']);

    const multiInput = 'https://youtu.be/vid11111111, https://www.youtube.com/shorts/vid22222222; vid33333333';
    const parsedMulti = monitor.parseYtIds(multiInput);
    runner.assertEqual(
      'ViewCount: Parse multi-live tokens (comma, semicolon, spaces)',
      parsedMulti,
      ['vid11111111', 'vid22222222', 'vid33333333']
    );

    // 3.2 Number Regex Extraction
    const htmlKick = '{"viewers":42,"other":123}';
    const kickCount = monitor.extractNumber(htmlKick, [/"viewer_count"\s*:\s*(\d+)/, /"viewers"\s*:\s*(\d+)/]);
    runner.assertEqual('ViewCount: Extract viewer count from JSON/HTML string', kickCount, 42);

    const htmlYt = '<span class="view-count">"viewCount":"1250"</span>';
    const ytCount = monitor.extractNumber(htmlYt, [/"viewCount"\s*:\s*"(\d+)"/]);
    runner.assertEqual('ViewCount: Extract YouTube viewCount with quotes', ytCount, 1250);

    // 3.3 TikTok Count Set and Render
    monitor.setTikTokCount(88);
    runner.assertEqual('ViewCount: setTikTokCount updates state', monitor.counts.tiktok, 88);

    // 3.4 DOM Rendering
    monitor.render();
    runner.assert('ViewCount: Bar element is visible (display flex)', bar.style.display === 'flex');
    const items = bar.querySelectorAll('.viewcount-item');
    runner.assertEqual('ViewCount: Renders 3 platform pill items', items.length, 3);

    // 3.5 Disabled ViewCount
    monitor.updateConfig({ enabled: false });
    runner.assertEqual('ViewCount: Disabled state hides bar element', bar.style.display, 'none');

    bar.remove();
    console.groupEnd();
  }

  // =========================================================================
  // SUITE 4: Kick Connector (kick.js - KickConnector)
  // =========================================================================
  function runKickTests() {
    console.group('--- 4. KickConnector Tests ---');
    let receivedMsg = null;
    let receivedAlert = null;
    let receivedStatus = null;

    const connector = new KickConnector(
      (msg) => { receivedMsg = msg; },
      (st) => { receivedStatus = st; },
      (alt) => { receivedAlert = alt; }
    );

    // 4.1 Chat Message Event Parsing
    const sampleChatEvent = {
      event: 'App\\Events\\ChatMessageEvent',
      data: JSON.stringify({
        id: 'kick-msg-123',
        content: 'GGWP Bang mantap siarannya!',
        sender: {
          username: 'GamerSultan',
          identity: { color: '#53FC18', badges: [{ type: 'subscriber' }] },
          profile_pic: 'https://kick.com/avatar.jpg'
        }
      })
    };

    connector.handlePusherEvent(sampleChatEvent);
    runner.assert('Kick: Chat event routed to onMessage callback', !!receivedMsg);
    runner.assertEqual('Kick: Sender username parsed correctly', receivedMsg?.username, 'GamerSultan');
    runner.assertEqual('Kick: Message content parsed correctly', receivedMsg?.message, 'GGWP Bang mantap siarannya!');
    runner.assertEqual('Kick: User color parsed correctly', receivedMsg?.userColor, '#53FC18');

    // 4.2 Subscription Alert Event Parsing
    const sampleSubEvent = {
      event: 'App\\Events\\SubscriptionEvent',
      data: JSON.stringify({
        username: 'DonaturKick',
        months: 3
      })
    };

    connector.handlePusherEvent(sampleSubEvent);
    runner.assert('Kick: Subscription event routed to onAlert callback', !!receivedAlert);
    runner.assertEqual('Kick: Alert type is kick_sub', receivedAlert?.type, 'kick_sub');
    runner.assertEqual('Kick: Alert subscriber username matches', receivedAlert?.user, 'DonaturKick');

    // 4.3 Cleanup
    connector.disconnect();
    runner.assertEqual('Kick: Disconnect resets state to disconnected', connector.isConnected, false);
    runner.assertEqual('Kick: ChatroomId cleared on disconnect', connector.chatroomId, null);

    console.groupEnd();
  }

  // =========================================================================
  // SUITE 5: TikFinity Connector (tikfinity.js - TikFinityConnector)
  // =========================================================================
  function runTikFinityTests() {
    console.group('--- 5. TikFinityConnector Tests ---');
    let receivedAlert = null;
    let receivedViewCount = null;

    const connector = new TikFinityConnector(
      (alt) => { receivedAlert = alt; },
      (vc) => { receivedViewCount = vc; },
      () => {}
    );

    // 5.1 Follow Event
    const followPacket = JSON.stringify({
      event: 'follow',
      data: {
        uniqueId: 'tiktoker_gemoy',
        nickname: 'Gemoy Official',
        avatarUrl: 'https://p16.tiktokcdn.com/avatar.jpg'
      }
    });

    connector.handleMessage(followPacket);
    runner.assert('TikFinity: Follow event routed to onAlert', !!receivedAlert);
    runner.assertEqual('TikFinity: Follow alert type is tiktok_follow', receivedAlert?.type, 'tiktok_follow');
    runner.assertEqual('TikFinity: User name captures nickname', receivedAlert?.user, 'Gemoy Official');

    // 5.2 Deduplication of rapid duplicate follow packets
    receivedAlert = null;
    connector.handleMessage(followPacket);
    runner.assertEqual('TikFinity: Rapid duplicate follow packet is suppressed', receivedAlert, null);

    // 5.3 Viewer Count Event
    const viewCountPacket = JSON.stringify({
      event: 'roomUser',
      data: { viewerCount: 254 }
    });

    connector.handleMessage(viewCountPacket);
    runner.assertEqual('TikFinity: Viewer count parsed and routed', receivedViewCount, 254);

    connector.disconnect();
    console.groupEnd();
  }

  // =========================================================================
  // SUITE 6: TikTok Connector (tiktok.js - TikTokConnector)
  // =========================================================================
  function runTikTokTests() {
    console.group('--- 6. TikTokConnector Tests ---');
    let receivedChat = null;
    let receivedAlert = null;

    const connector = new TikTokConnector(
      (chat) => { receivedChat = chat; },
      () => {},
      (alt) => { receivedAlert = alt; }
    );
    connector.username = 'streamerpro';

    // 6.1 Socket.IO Packet Strip & Comment Parse
    const socketIoFrame = '42["chat",{"nickname":"BudiSantoso","comment":"Halo streamer!","uniqueId":"budi99"}]';
    connector.parseIndoFinityPayload(socketIoFrame);
    runner.assert('TikTok: Socket.IO frame packet number stripped and parsed', !!receivedChat);
    runner.assertEqual('TikTok: Comment text matches payload', receivedChat?.message, 'Halo streamer!');
    runner.assertEqual('TikTok: Nickname extracted', receivedChat?.username, 'BudiSantoso');

    // 6.2 Host / Creator Detection
    receivedChat = null;
    const hostComment = JSON.stringify({
      event: 'chat',
      data: {
        nickname: 'streamerpro',
        uniqueId: 'streamerpro',
        comment: 'Selamat datang di live saya!',
        isHost: true
      }
    });
    connector.parseIndoFinityPayload(hostComment);
    runner.assert('TikTok: Host user detected with Creator badge', receivedChat?.badges.includes('HOST'));
    runner.assert('TikTok: Host username tagged with Creator crown', receivedChat?.username.includes('👑'));

    // 6.3 Gift Alert Event
    receivedAlert = null;
    const giftEvent = JSON.stringify({
      event: 'gift',
      data: {
        nickname: 'SultanGifter',
        giftName: 'Paus Menyelam',
        repeatCount: 1,
        repeat_end: 1
      }
    });
    connector.parseIndoFinityPayload(giftEvent);
    runner.assert('TikTok: Gift event parsed into alert', !!receivedAlert);
    runner.assertEqual('TikTok: Gift alert type is tiktok_gift', receivedAlert?.type, 'tiktok_gift');
    runner.assertEqual('TikTok: Gift name matches', receivedAlert?.gift, 'Paus Menyelam');

    // 6.4 Tap-Tap Like Milestone Accumulator
    receivedAlert = null;
    connector.accumulatedLikes = 90;
    connector.lastLikeMilestone = 0;
    connector.lastLikeAlertTime = 0;

    const likePacket = JSON.stringify({
      event: 'like',
      data: {
        nickname: 'Liker1',
        totalLikes: 105
      }
    });
    connector.parseIndoFinityPayload(likePacket);
    runner.assert('TikTok: Tap-tap like milestone (100) triggered alert', !!receivedAlert);
    runner.assertEqual('TikTok: Milestone count is 100', receivedAlert?.count, 100);

    connector.disconnect();
    console.groupEnd();
  }

  // =========================================================================
  // SUITE 7: YouTube Connector (youtube.js - YouTubeConnector)
  // =========================================================================
  function runYouTubeTests() {
    console.group('--- 7. YouTubeConnector Tests ---');
    let receivedChat = null;
    let receivedAlert = null;

    const connector = new YouTubeConnector(
      (chat) => { receivedChat = chat; },
      () => {},
      (alt) => { receivedAlert = alt; }
    );

    // 7.1 Video ID Extraction
    runner.assertEqual('YouTube: Extract 11-char ID', connector.extractVideoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    runner.assertEqual(
      'YouTube: Extract from live URL',
      connector.extractVideoId('https://www.youtube.com/live/QWZXv51H918?si=123'),
      'QWZXv51H918'
    );
    runner.assertEqual(
      'YouTube: Extract multi live IDs from comma-separated input',
      connector.extractVideoIds('dQw4w9WgXcQ, QWZXv51H918'),
      ['dQw4w9WgXcQ', 'QWZXv51H918']
    );

    // 7.2 InnerTube JSON Parser
    const ytJsonPayload = {
      contents: {
        liveChatRenderer: {
          actions: [
            {
              addChatItemAction: {
                item: {
                  liveChatTextMessageRenderer: {
                    id: 'yt-msg-001',
                    authorName: { simpleText: 'PenontonSetia' },
                    message: { runs: [{ text: 'Halo bang, mantap streamnya!' }] },
                    authorPhoto: { thumbnails: [{ url: 'https://yt.com/photo.jpg' }] }
                  }
                }
              }
            },
            {
              addChatItemAction: {
                item: {
                  liveChatMembershipItemRenderer: {
                    authorName: { simpleText: 'MemberBaru' }
                  }
                }
              }
            }
          ]
        }
      }
    };

    connector.parseLiveChatJson(ytJsonPayload);
    runner.assert('YouTube: Live chat message extracted from InnerTube JSON', !!receivedChat);
    runner.assertEqual('YouTube: Chat username parsed', receivedChat?.username, 'PenontonSetia');
    runner.assertEqual('YouTube: Chat message text parsed', receivedChat?.message, 'Halo bang, mantap streamnya!');

    runner.assert('YouTube: Membership item triggered yt_sub alert', !!receivedAlert);
    runner.assertEqual('YouTube: Alert subscriber name matches', receivedAlert?.user, 'MemberBaru');

    // 7.3 Seen Message Deduplication
    receivedChat = null;
    connector.parseLiveChatJson(ytJsonPayload);
    runner.assertEqual('YouTube: Duplicate message with existing ID is ignored', receivedChat, null);

    connector.disconnect();
    console.groupEnd();
  }

  // =========================================================================
  // SUITE 8: Alert Overlay Manager (alerts.js - AlertOverlayManager)
  // =========================================================================
  function runAlertOverlayTests() {
    console.group('--- 8. AlertOverlayManager Tests ---');
    const container = document.createElement('div');
    container.id = 'alert-container';
    document.body.appendChild(container);

    const audio = document.createElement('audio');
    audio.id = 'alert-audio-player';
    document.body.appendChild(audio);

    const manager = new AlertOverlayManager();
    manager.config.alertDuration = 2; // Fast for testing

    // 8.1 Config Merging
    manager.mergeConfig({
      alertDuration: 8,
      alertSoundVolume: 0.5,
      alerts: {
        yt_sub: { title: 'SUBS BARU: {user}' }
      }
    });

    runner.assertEqual('Alerts: mergeConfig updates alertDuration', manager.config.alertDuration, 8);
    runner.assertEqual('Alerts: mergeConfig updates alertSoundVolume', manager.config.alertSoundVolume, 0.5);
    runner.assertEqual('Alerts: mergeConfig deep merges alert title', manager.config.alerts.yt_sub.title, 'SUBS BARU: {user}');

    // 8.2 HTML Escaping in Alerts
    runner.assertEqual(
      'Alerts: escapeHtml escapes dangerous characters (&, <, >, ", \')',
      manager.escapeHtml('<script>alert("x") & \'y\'</script>'),
      '&lt;script&gt;alert(&quot;x&quot;) &amp; &#039;y&#039;&lt;/script&gt;'
    );

    // 8.3 Deduplication by Alert ID & Rapid Fingerprint
    manager.queue = [];
    manager.isPlaying = false;
    const testPayload = {
      type: 'ALERT_TRIGGER',
      id: 'unique-alert-1',
      data: {
        platform: 'youtube',
        type: 'yt_sub',
        user: 'Ahmad'
      }
    };

    manager.handleIncomingBroadcast(testPayload);
    runner.assertEqual('Alerts: First trigger enqueued into alert queue', manager.queue.length + (manager.isPlaying ? 1 : 0), 1);

    // Immediate duplicate send
    manager.handleIncomingBroadcast(testPayload);
    runner.assertEqual('Alerts: Duplicate alert ID rejected and ignored', manager.queue.length + (manager.isPlaying ? 1 : 0), 1);

    container.remove();
    audio.remove();
    console.groupEnd();
  }

  // =========================================================================
  // SUITE 9: Application State & Activity Log (app.js - Application)
  // =========================================================================
  function runApplicationTests() {
    console.group('--- 9. Application Logic Tests ---');
    const app = new Application(false);

    // 9.1 Activity Log Limiting
    const logBox = document.createElement('div');
    logBox.id = 'activity-log';
    document.body.appendChild(logBox);

    for (let i = 0; i < 150; i++) {
      app.logActivity(`Test Log Item ${i}`);
    }

    runner.assert('App: Activity log is capped at max 120 items', logBox.children.length <= 120);

    // 9.2 Broadcast Payload Structure
    let sentPayload = null;
    app.alertBroadcastChannel = {
      postMessage: (p) => { sentPayload = p; }
    };

    app.broadcastAlert({
      platform: 'kick',
      type: 'kick_sub',
      user: 'Sultan99'
    });

    runner.assert('App: broadcastAlert includes ALERT_TRIGGER envelope', sentPayload?.type === 'ALERT_TRIGGER');
    runner.assert('App: broadcastAlert generates unique ID', !!sentPayload?.id);
    runner.assertEqual('App: broadcastAlert preserves payload data', sentPayload?.data?.user, 'Sultan99');

    logBox.remove();
    console.groupEnd();
  }

  // Main Test Runner Entrypoint
  root.runAllTests = function () {
    console.clear();
    console.log('%c🚀 Starting ZoVer Comprehensive Test Suite...', 'font-size: 16px; font-weight: bold; color: #00f2fe');

    runner.total = 0;
    runner.passed = 0;
    runner.failed = 0;
    runner.results = [];

    runTtsTests();
    runOverlayTests();
    runViewCountTests();
    runKickTests();
    runTikFinityTests();
    runTikTokTests();
    runYouTubeTests();
    runAlertOverlayTests();
    runApplicationTests();

    console.log(
      `%c=======================================================\n🏁 Test Finished: ${runner.passed} Passed, ${runner.failed} Failed out of ${runner.total} Tests\n=======================================================`,
      `font-size: 14px; font-weight: bold; color: ${runner.failed === 0 ? '#10b981' : '#ff3333'}`
    );

    return {
      total: runner.total,
      passed: runner.passed,
      failed: runner.failed,
      results: runner.results
    };
  };

})(window);
