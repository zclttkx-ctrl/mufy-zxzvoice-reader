// ==UserScript==
// @name         Mufy ZXZ Voice Reader
// @namespace    https://github.com/zclttkx-ctrl/mufy-zxzvoice-reader
// @version      1.6.0
// @description  Mufy AI-only incremental voice reader
// @match        https://chat.mufy.ai/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const START = '【语音开始】';
  const END = '【语音结束】';

  // 根据实际页面结构：操作按钮向上第5层
  const ACTION_SELECTOR = '[id="mufy_message_actions_btn"]';
  const MESSAGE_SELECTOR = 'div.flex.min-w-0.flex-1.flex-col';
  const GREETING_SELECTOR = '.greeting-content';

  let enabled = false;
  let unlocked = false;
  let isSpeaking = false;
  let scanTimer = null;

  const spoken = new Set();
  const queue = [];
  const messageStates = new WeakMap();

  // ---------- UI ----------

  const oldPanel = document.getElementById('zxz-voice-panel');
  if (oldPanel) oldPanel.remove();

  const panel = document.createElement('div');
  panel.id = 'zxz-voice-panel';

  panel.innerHTML = `
    <div class="zxz-title">
      ZXZ VOICE READER <span>1.6.0</span>
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
      width:230px;
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
      min-height:40px;
      padding:7px 0;
      line-height:1.5;
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

  // ---------- 找到真正的 AI 消息 ----------

  function findAIMessages() {
    const rows = new Set();

    document.querySelectorAll(ACTION_SELECTOR).forEach(button => {
      // 不再使用 .group
      // 根据真实 DOM 找到正文和操作栏共同的父容器
      const row = button.closest(MESSAGE_SELECTOR);

      if (!row) return;

      // 确认这个容器内部确实有对应的操作按钮
      if (!row.querySelector(ACTION_SELECTOR)) return;

      rows.add(row);
    });

    return Array.from(rows);
  }

  // ---------- 开场白 ----------

  function findGreetings() {
    return Array.from(
      document.querySelectorAll(GREETING_SELECTOR)
    );
  }

  // ---------- 提取正文 ----------

  function getCleanText(element) {
    if (!element) return '';

    const clone = element.cloneNode(true);

    const excluded = [
      'button',
      'svg',
      'script',
      'style',
      'input',
      'textarea',
      'details',
      '#mufy_message_actions_box',
      '.mufy_message_narration',
      '.mufy_code_block',
      '#mufy_author_note',
      '#mufy_chat_input_container'
    ];

    excluded.forEach(selector => {
      try {
        clone.querySelectorAll(selector).forEach(el => el.remove());
      } catch (_) {}
    });

    return (clone.textContent || '')
      .replace(/\u00a0/g, ' ');
  }

  function normalize(text) {
    return text.replace(/\s+/g, ' ').trim();
  }

  // ---------- 提取完整对白 ----------

  function extractIncremental(text, initialCursor) {
    const dialogues = [];

    let cursor = Math.max(0, initialCursor || 0);
    let lastCompleteEnd = cursor;

    while (cursor < text.length) {
      const start = text.indexOf(START, cursor);

      if (start === -1) {
        return {
          dialogues,
          cursor: Math.max(
            lastCompleteEnd,
            text.length - START.length + 1
          )
        };
      }

      const contentStart = start + START.length;
      const end = text.indexOf(END, contentStart);

      if (end === -1) {
        return {
          dialogues,
          cursor: start
        };
      }

      const dialogue = normalize(
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

  // ---------- 防止重复 ----------

  function enqueue(dialogue) {
    const key = normalize(dialogue);

    if (!key || spoken.has(key)) return false;

    spoken.add(key);
    queue.push(key);

    return true;
  }

  // ---------- 增量扫描 ----------

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

    if (state.snapshot === text) return 0;

    const startCursor = text.startsWith(state.snapshot)
      ? state.cursor
      : 0;

    const result = extractIncremental(text, startCursor);

    state.snapshot = text;
    state.cursor = result.cursor;

    let added = 0;

    for (const dialogue of result.dialogues) {
      if (baseline) {
        spoken.add(normalize(dialogue));
      } else if (enabled && unlocked) {
        if (enqueue(dialogue)) added++;
      }
    }

    return added;
  }

  // ---------- 语音播放 ----------

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

    utterance.onerror = event => {
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

  // ---------- 扫描页面 ----------

  function scan() {
    const aiMessages = findAIMessages();
    const greetings = findGreetings();

    let added = 0;

    aiMessages.forEach(row => {
      added += processContainer(row, false);
    });

    greetings.forEach(row => {
      added += processContainer(row, false);
    });

    if (!enabled || !unlocked) {
      setStatus(
        'AI 消息：' + aiMessages.length +
        '；开场白：' + greetings.length +
        '；等待开启朗读'
      );

      return;
    }

    if (added > 0) {
      setStatus('发现 AI 新对白，加入队列 ' + added + ' 条');
      pumpQueue();
    }
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 250);
  }

  // ---------- 历史对白静默登记 ----------

  function baselineExistingMessages() {
    const aiMessages = findAIMessages();
    const greetings = findGreetings();

    aiMessages.forEach(row => {
      processContainer(row, true);
    });

    greetings.forEach(row => {
      processContainer(row, true);
    });

    return {
      aiCount: aiMessages.length,
      greetingCount: greetings.length
    };
  }

  // ---------- 诊断 ----------

  function diagnostic() {
    const aiMessages = findAIMessages();
    const greetings = findGreetings();

    let dialogueCount = 0;

    aiMessages.forEach(row => {
      dialogueCount += extractIncremental(
        getCleanText(row),
        0
      ).dialogues.length;
    });

    greetings.forEach(row => {
      dialogueCount += extractIncremental(
        getCleanText(row),
        0
      ).dialogues.length;
    });

    setStatus(
      'AI 消息：' + aiMessages.length +
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

      speechSynthesis.cancel();

      isSpeaking = false;
      queue.length = 0;

      enableButton.textContent = '开启朗读';
      setStatus('朗读已停止');
    });

  // ---------- 自动监听 ----------

  const observer = new MutationObserver(mutations => {
    const relevant = mutations.some(mutation => {
      const target = mutation.target;

      return !(
        target === panel ||
        panel.contains(target)
      );
    });

    if (relevant) scheduleScan();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  scheduleScan();

})();
