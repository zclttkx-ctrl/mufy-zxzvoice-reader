// ==UserScript==
// @name         Mufy ZXZ Voice Reader
// @namespace    https://github.com/zclttkx-ctrl/mufy-zxzvoice-reader
// @version      1.5.5
// @description  Mufy AI-only incremental voice reader
// @match        https://chat.mufy.ai/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const START = '【语音开始】';
  const END = '【语音结束】';

  const ACTION_SELECTOR = 'button[id="mufy_message_actions_btn"]';
  const GROUP_SELECTOR = '.group';
  const GREETING_SELECTOR = '.greeting-content';
  const SCROLL_SELECTOR = '.scroll-primary';

  let enabled = false;
  let unlocked = false;
  let isSpeaking = false;
  let scanTimer = null;

  const spoken = new Set();
  const queue = [];

  // 每个消息节点独立保存扫描位置
  const messageStates = new WeakMap();

  // 避免重复给同一个 DOM 根节点安装监听器
  const observedRoots = new WeakSet();

  // ---------- UI ----------

  const oldPanel = document.getElementById('zxz-voice-panel');
  if (oldPanel) oldPanel.remove();

  const panel = document.createElement('div');

  panel.id = 'zxz-voice-panel';

  panel.innerHTML = `
    <div class="zxz-title">
      ZXZ VOICE READER <span>1.5.5</span>
    </div>
    <div id="zxz-status">正在启动监听…</div>
    <div class="zxz-buttons">
      <button id="zxz-enable">开启朗读</button>
      <button id="zxz-test">试听</button>
      <button id="zxz-check">检查页面</button>
    </div>
    <button id="zxz-stop">停止朗读</button>
  `;

  const style = document.createElement('style');

  style.textContent = `
    #zxz-voice-panel {
      position:fixed;
      z-index:2147483647;
      right:10px;
      bottom:110px;
      width:220px;
      padding:9px;
      box-sizing:border-box;
      border:1px solid #555;
      border-radius:10px;
      background:rgba(25,25,29,.97);
      color:white;
      font:11px -apple-system,BlinkMacSystemFont,sans-serif;
      box-shadow:0 4px 16px #0005;
    }

    #zxz-voice-panel .zxz-title {
      color:#f0c5ce;
      font-weight:bold;
      font-size:10px;
      letter-spacing:.5px;
    }

    #zxz-voice-panel .zxz-title span {
      float:right;
      color:#999;
      font-weight:normal;
    }

    #zxz-status {
      min-height:30px;
      padding:7px 0;
      line-height:1.4;
      color:#ddd;
      overflow-wrap:anywhere;
      font-size:10px;
    }

    #zxz-voice-panel .zxz-buttons {
      display:flex;
      gap:4px;
    }

    #zxz-voice-panel button {
      border:0;
      border-radius:5px;
      padding:7px 3px;
      color:white;
      background:#713847;
      font-size:9px;
      line-height:1.2;
    }

    #zxz-voice-panel .zxz-buttons button {
      flex:1;
      min-width:0;
    }

    #zxz-stop {
      width:100%;
      margin-top:5px;
      background:#444 !important;
    }
  `;

  document.documentElement.append(style, panel);

  const status = panel.querySelector('#zxz-status');
  const enableButton = panel.querySelector('#zxz-enable');

  function setStatus(message) {
    status.textContent = message;
  }

  // ---------- 页面根节点 ----------

  function collectRoots() {
    const roots = [];
    const visited = new Set();

    function walk(root) {
      if (!root || visited.has(root)) return;

      visited.add(root);
      roots.push(root);

      let elements = [];

      try {
        elements = root.querySelectorAll('*');
      } catch (_) {
        return;
      }

      for (const el of elements) {
        if (el.shadowRoot) {
          walk(el.shadowRoot);
        }

        if (el.tagName === 'IFRAME') {
          try {
            if (el.contentDocument) {
              walk(el.contentDocument);
            }
          } catch (_) {}
        }
      }
    }

    walk(document);

    return roots;
  }

  function isPanelMutation(mutation) {
    let target = mutation.target;

    if (target && target.nodeType === Node.TEXT_NODE) {
      target = target.parentElement;
    }

    return !!(
      target &&
      (target === panel || panel.contains(target))
    );
  }

  function observeRoots(roots) {
    for (const root of roots) {
      if (observedRoots.has(root)) continue;

      try {
        const observer = new MutationObserver((mutations) => {
          const relevant = mutations.some(
            mutation => !isPanelMutation(mutation)
          );

          if (relevant) scheduleScan();
        });

        observer.observe(root, {
          childList: true,
          subtree: true,
          characterData: true
        });

        observedRoots.add(root);
      } catch (_) {}
    }
  }

  // ---------- 文本提取 ----------

  function getCleanText(element) {
    if (!element) return '';

    // 克隆后移除不属于对白正文的区域
    const clone = element.cloneNode(true);

    const excluded = [
      'button',
      'svg',
      'script',
      'style',
      'input',
      'textarea',
      'details',
      '.mufy_message_narration',
      '.mufy_code_block',
      '#mufy_author_note',
      '#mufy_chat_input_container'
    ];

    for (const selector of excluded) {
      try {
        clone.querySelectorAll(selector).forEach(el => el.remove());
      } catch (_) {}
    }

    return (clone.textContent || '')
      .replace(/\u00a0/g, ' ');
  }

  function normalizeDialogue(text) {
    return text
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ---------- 消息识别 ----------

  function findMessageRows(roots) {
    const aiRows = new Set();
    const userRows = new Set();

    for (const root of roots) {
      let buttons = [];

      try {
        buttons = root.querySelectorAll(ACTION_SELECTOR);
      } catch (_) {
        continue;
      }

      for (const button of buttons) {
        const row = button.closest(GROUP_SELECTOR);

        if (!row) continue;

        // 只处理聊天滚动区域里的消息
        if (!row.closest(SCROLL_SELECTOR)) continue;

        // 用户消息：反向布局，直接排除
        if (row.classList.contains('flex-row-reverse')) {
          userRows.add(row);
          continue;
        }

        // AI 消息：正向布局
        if (row.classList.contains('flex-row')) {
          aiRows.add(row);
        }
      }
    }

    return {
      aiRows: Array.from(aiRows),
      userRows: Array.from(userRows)
    };
  }

  function findGreetings(roots) {
    const greetings = new Set();

    for (const root of roots) {
      try {
        root.querySelectorAll(GREETING_SELECTOR).forEach(el => {
          if (el.closest(SCROLL_SELECTOR)) {
            // 开场白独立处理，避免和普通消息重复
            if (!el.closest(GROUP_SELECTOR)) {
              greetings.add(el);
            }
          }
        });
      } catch (_) {}
    }

    return Array.from(greetings);
  }

  // ---------- 完整对白与增量游标 ----------

  /*
   * 从指定位置向后提取完整对白。
   *
   * 没有结束标记时绝不入队。
   * 未闭合的开始标记会保留游标，
   * 等待后续流式字符补齐。
   */

  function extractIncremental(text, initialCursor) {
    const dialogues = [];

    let cursor = Math.max(0, initialCursor || 0);
    let lastCompleteEnd = cursor;

    while (cursor < text.length) {
      const start = text.indexOf(START, cursor);

      if (start === -1) {
        // 保留可能尚未完整出现的开始标记
        const safeCursor = Math.max(
          lastCompleteEnd,
          text.length - START.length + 1
        );

        return {
          dialogues,
          cursor: safeCursor
        };
      }

      const contentStart = start + START.length;
      const end = text.indexOf(END, contentStart);

      if (end === -1) {
        // 有开始标记但还没有结束标记
        // 不越过它，等待后续追加
        return {
          dialogues,
          cursor: start
        };
      }

      const dialogue = normalizeDialogue(
        text.slice(contentStart, end)
      );

      if (dialogue) {
        dialogues.push(dialogue);
      }

      cursor = end + END.length;
      lastCompleteEnd = cursor;
    }

    return {
      dialogues,
      cursor: Math.max(
        lastCompleteEnd,
        text.length - START.length + 1
      )
    };
  }

  function fingerprint(dialogue) {
    return normalizeDialogue(dialogue);
  }

  function enqueue(dialogue) {
    if (!dialogue) return false;

    const key = fingerprint(dialogue);

    if (spoken.has(key)) return false;

    spoken.add(key);
    queue.push(dialogue);

    return true;
  }

  /*
   * baseline=true：
   * 将页面现存对白登记为历史，不播放。
   *
   * baseline=false：
   * 只处理游标之后新闭合的对白。
   */

  function processContainer(element, baseline) {
    const text = getCleanText(element);

    let state = messageStates.get(element);

    if (!state) {
      state = {
        snapshot: '',
        cursor: 0
      };

      messageStates.set(element, state);
    }

    if (state.snapshot === text) {
      return 0;
    }

    let startCursor = 0;

    if (text.startsWith(state.snapshot)) {
      startCursor = state.cursor;
    }

    const result = extractIncremental(
      text,
      startCursor
    );

    state.snapshot = text;
    state.cursor = result.cursor;

    let added = 0;

    for (const dialogue of result.dialogues) {
      if (baseline) {
        // 历史内容只登记，不播放
        spoken.add(fingerprint(dialogue));
      } else if (enabled && unlocked) {
        if (enqueue(dialogue)) {
          added++;
        }
      }
    }

    return added;
  }

  // ---------- 队列与语音 ----------

  function pumpQueue() {
    if (!enabled || !unlocked || isSpeaking) return;

    if (!queue.length) {
      setStatus('朗读完成，继续监听 AI 新对白…');
      return;
    }

    if (!('speechSynthesis' in window)) {
      setStatus('当前浏览器不支持语音合成');
      return;
    }

    const text = queue.shift();

    isSpeaking = true;

    const utterance = new SpeechSynthesisUtterance(text);

    utterance.lang = 'zh-CN';
    utterance.rate = 1;
    utterance.pitch = 1;

    try {
      const voices = speechSynthesis.getVoices();

      const voice = voices.find(v =>
        v.lang && v.lang.toLowerCase().startsWith('zh')
      );

      if (voice) utterance.voice = voice;
    } catch (_) {}

    utterance.onstart = () => {
      setStatus('正在朗读：' + text);
    };

    utterance.onend = () => {
      isSpeaking = false;
      setTimeout(pumpQueue, 150);
    };

    utterance.onerror = (event) => {
      isSpeaking = false;

      if (enabled) {
        setStatus('语音错误：' + event.error);
        setTimeout(pumpQueue, 300);
      }
    };

    try {
      speechSynthesis.speak(utterance);
    } catch (_) {
      isSpeaking = false;
      setStatus('播放失败，请重新开启朗读');
    }
  }

  // ---------- 扫描 ----------

  function scan() {
    const roots = collectRoots();

    observeRoots(roots);

    const {
      aiRows,
      userRows
    } = findMessageRows(roots);

    const greetings = findGreetings(roots);

    let added = 0;

    for (const row of aiRows) {
      added += processContainer(row, false);
    }

    for (const greeting of greetings) {
      added += processContainer(greeting, false);
    }

    if (!enabled || !unlocked) {
      setStatus(
        'AI 消息：' + aiRows.length +
        '；用户消息：' + userRows.length +
        '；开场白：' + greetings.length +
        '；等待开启朗读'
      );

      return;
    }

    if (added > 0) {
      setStatus('发现 AI 新对白，已加入队列 ' + added + ' 条');
      pumpQueue();
    }
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 250);
  }

  // ---------- 历史静默登记 ----------

  function baselineExistingMessages() {
    const roots = collectRoots();

    observeRoots(roots);

    const {
      aiRows
    } = findMessageRows(roots);

    const greetings = findGreetings(roots);

    for (const row of aiRows) {
      processContainer(row, true);
    }

    for (const greeting of greetings) {
      processContainer(greeting, true);
    }

    return {
      aiCount: aiRows.length,
      greetingCount: greetings.length
    };
  }

  // ---------- 诊断 ----------

  function diagnostic() {
    const roots = collectRoots();

    observeRoots(roots);

    const {
      aiRows,
      userRows
    } = findMessageRows(roots);

    const greetings = findGreetings(roots);

    let dialogueCount = 0;

    for (const row of aiRows) {
      dialogueCount += extractIncremental(
        getCleanText(row),
        0
      ).dialogues.length;
    }

    for (const greeting of greetings) {
      dialogueCount += extractIncremental(
        getCleanText(greeting),
        0
      ).dialogues.length;
    }

    setStatus(
      'AI 消息：' + aiRows.length +
      '；用户消息：' + userRows.length +
      '；开场白：' + greetings.length +
      '；完整对白：' + dialogueCount +
      '；队列：' + queue.length
    );
  }

  // ---------- 按钮 ----------

  enableButton.addEventListener('click', () => {
    if (!('speechSynthesis' in window)) {
      setStatus('当前浏览器不支持语音合成');
      return;
    }

    // 每次开启前先静默登记现存历史
    baselineExistingMessages();

    enabled = true;
    unlocked = true;

    enableButton.textContent = '朗读已开启';

    speechSynthesis.cancel();
    isSpeaking = true;

    const unlock = new SpeechSynthesisUtterance(
      '语音朗读已开启'
    );

    unlock.lang = 'zh-CN';

    unlock.onend = () => {
      isSpeaking = false;

      setStatus('已开启，只监听 AI 新对白…');

      scheduleScan();
      setTimeout(pumpQueue, 150);
    };

    unlock.onerror = () => {
      isSpeaking = false;

      setStatus('已开启，等待角色新对白…');

      scheduleScan();
      setTimeout(pumpQueue, 150);
    };

    try {
      speechSynthesis.speak(unlock);
    } catch (_) {
      isSpeaking = false;
      setStatus('语音启动失败，请再点一次开启朗读');
    }
  });

  panel.querySelector('#zxz-test')
    .addEventListener('click', () => {
      if (!enabled || !unlocked) {
        setStatus('请先开启朗读');
        return;
      }

      queue.push('听见了吗？过来。');
      pumpQueue();
    });

  panel.querySelector('#zxz-check')
    .addEventListener('click', diagnostic);

  panel.querySelector('#zxz-stop')
    .addEventListener('click', () => {
      enabled = false;
      unlocked = false;

      if ('speechSynthesis' in window) {
        speechSynthesis.cancel();
      }

      isSpeaking = false;
      queue.length = 0;

      enableButton.textContent = '开启朗读';

      setStatus('朗读已停止');
    });

  // ---------- 启动 ----------

  const roots = collectRoots();

  observeRoots(roots);

  scheduleScan();

})();
