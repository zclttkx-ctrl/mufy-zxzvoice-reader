// ==UserScript==
// @name         Mufy ZXZ Voice Reader
// @namespace    https://github.com/zclttkx-ctrl/mufy-zxzvoice-reader
// @version      1.6.3
// @description  Mufy AI-only zxznarration voice reader
// @match        https://chat.mufy.ai/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const DIALOGUE_SELECTOR = '.zxznarration';
  const ACTION_SELECTOR = '[id="mufy_message_actions_btn"]';
  const MESSAGE_SELECTOR = 'div.flex.min-w-0.flex-1.flex-col';
  const GREETING_SELECTOR = '.greeting-content';

  const STABLE_DELAY = 1200;
  const SCAN_INTERVAL = 350;

  let enabled = false;
  let unlocked = false;
  let isSpeaking = false;
  let scanTimer = null;

  const spoken = new Set();
  const queue = [];

  const processed = new WeakSet();
  const pending = new WeakMap();

  // ---------- UI ----------

  const oldPanel = document.getElementById('zxz-voice-panel');
  if (oldPanel) oldPanel.remove();

  const panel = document.createElement('div');
  panel.id = 'zxz-voice-panel';

  panel.innerHTML = `
    <div class="zxz-title">
      ZXZ VOICE READER <span>1.6.3</span>
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

  // ---------- 找到 AI 消息 ----------

  function findAIMessages() {
    const rows = new Set();

    document.querySelectorAll(ACTION_SELECTOR).forEach(button => {
      const row = button.closest(MESSAGE_SELECTOR);

      if (!row) return;
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

  // ---------- 找到对白标签 ----------

  function findDialogueElements() {
    const containers = [
      ...findAIMessages(),
      ...findGreetings()
    ];

    const elements = new Set();

    containers.forEach(container => {
      container.querySelectorAll(DIALOGUE_SELECTOR)
        .forEach(element => elements.add(element));
    });

    return Array.from(elements);
  }

  function normalize(text) {
    return (text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ---------- 登记历史对白 ----------

  function baselineExistingMessages() {
    const elements = findDialogueElements();

    elements.forEach(element => {
      const text = normalize(element.textContent);

      // 关键修复：空标签绝不标记为已处理
      if (!text) return;

      processed.add(element);
      spoken.add(text);
    });

    return elements.length;
  }

  // ---------- 加入队列 ----------

  function enqueue(dialogue) {
    const text = normalize(dialogue);

    if (!text || spoken.has(text)) return false;

    spoken.add(text);
    queue.push(text);

    return true;
  }

  // ---------- 扫描对白 ----------

  function scan() {
    const aiMessages = findAIMessages();
    const greetings = findGreetings();

    const elements = new Set();

    [...aiMessages, ...greetings].forEach(container => {
      container.querySelectorAll(DIALOGUE_SELECTOR)
        .forEach(element => elements.add(element));
    });

    let added = 0;
    let waiting = 0;
    let empty = 0;

    elements.forEach(element => {
      const text = normalize(element.textContent);

      // 空标签不登记、不处理，等待文字填入
      if (!text) {
        empty++;
        return;
      }

      if (!enabled || !unlocked) {
        processed.add(element);
        spoken.add(text);
        return;
      }

      if (processed.has(element)) return;

      let state = pending.get(element);

      // 首次发现文字，开始计时
      if (!state || state.text !== text) {
        pending.set(element, {
          text: text,
          changedAt: Date.now()
        });

        waiting++;
        return;
      }

      // 文字尚未稳定
      if (Date.now() - state.changedAt < STABLE_DELAY) {
        waiting++;
        return;
      }

      // 文字稳定，加入朗读队列
      processed.add(element);
      pending.delete(element);

      if (enqueue(text)) {
        added++;
      }
    });

    if (!enabled || !unlocked) {
      setStatus(
        'AI 消息：' + aiMessages.length +
        '；对白标签：' + elements.size +
        '；等待开启朗读'
      );
      return;
    }

    if (added > 0) {
      setStatus('发现 AI 新对白，加入队列 ' + added + ' 条');
      pumpQueue();
    } else if (waiting > 0) {
      setStatus('正在等待对白生成完成…');
    } else if (empty > 0) {
      setStatus('发现空对白标签，等待文字填入…');
    } else {
      setStatus('朗读完成，继续监听 AI 新对白…');
    }
  }

  // ---------- 持续扫描 ----------

  function scheduleScan() {
    clearTimeout(scanTimer);

    scanTimer = setTimeout(() => {
      scan();

      if (enabled && unlocked) {
        scheduleScan();
      }
    }, SCAN_INTERVAL);
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

  // ---------- 诊断 ----------

  function diagnostic() {
    const aiMessages = findAIMessages();
    const greetings = findGreetings();
    const elements = findDialogueElements();

    const nonEmpty = elements.filter(
      element => normalize(element.textContent)
    ).length;

    const empty = elements.length - nonEmpty;

    setStatus(
      'AI 消息：' + aiMessages.length +
      '；开场白：' + greetings.length +
      '；对白标签：' + elements.length +
      '；有文字：' + nonEmpty +
      '；空标签：' + empty +
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
      setStatus('已开启，只监听新的对白标签…');
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

      clearTimeout(scanTimer);
      speechSynthesis.cancel();

      isSpeaking = false;
      queue.length = 0;

      enableButton.textContent = '开启朗读';
      setStatus('朗读已停止');
    });

  // ---------- 自动监听 ----------

  const observer = new MutationObserver(mutations => {
    const relevant = mutations.some(mutation => {
      return !(
        mutation.target === panel ||
        panel.contains(mutation.target)
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
