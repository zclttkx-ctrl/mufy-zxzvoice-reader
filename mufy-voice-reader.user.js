// ==UserScript==
// @name         Mufy ZXZ Voice Reader
// @namespace    https://github.com/zclttkx-ctrl/mufy-zxzvoice-reader
// @version      1.5.4
// @description  Mufy AI-only automatic voice reader
// @match        https://chat.mufy.ai/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const START = '【语音开始】';
  const END = '【语音结束】';

  // 只认 AI 暗红色气泡
  const AI_SELECTOR = '[class*="bg-[#711B3F]"]';

  // 用户浅粉色气泡，仅用于诊断，不参与朗读
  const USER_SELECTOR = '[class*="bg-[#e8bec3]"]';

  let enabled = false;
  let unlocked = false;
  let isSpeaking = false;
  let scanTimer = null;

  const spoken = new Set();
  const queue = [];
  const observedRoots = new WeakSet();

  // ---------- UI ----------

  const panel = document.createElement('div');

  panel.id = 'zxz-voice-panel';

  panel.innerHTML = `
    <div class="zxz-title">
      ZXZ VOICE READER <span>1.5.4</span>
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

  // ---------- 页面区域 ----------

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
        if (el.shadowRoot) walk(el.shadowRoot);

        if (el.tagName === 'IFRAME') {
          try {
            if (el.contentDocument) walk(el.contentDocument);
          } catch (_) {}
        }
      }
    }

    walk(document);
    return roots;
  }

  function observeRoots(roots) {
    for (const root of roots) {
      if (observedRoots.has(root)) continue;

      try {
        const observer = new MutationObserver(scheduleScan);

        observer.observe(root, {
          childList: true,
          subtree: true,
          characterData: true
        });

        observedRoots.add(root);
      } catch (_) {}
    }
  }

  // ---------- AI 气泡识别 ----------

  function getText(el) {
    return (el.innerText || el.textContent || '')
      .replace(/\u00a0/g, ' ')
      .trim();
  }

  function findAIBubbles(roots) {
    const bubbles = [];

    for (const root of roots) {
      let elements = [];

      try {
        elements = root.querySelectorAll(AI_SELECTOR);
      } catch (_) {
        continue;
      }

      for (const el of elements) {
        if (panel.contains(el)) continue;

        // 避免把 AI 气泡内部的嵌套节点重复计算
        const parentBubble = el.parentElement
          ? el.parentElement.closest(AI_SELECTOR)
          : null;

        if (parentBubble) continue;

        bubbles.push(el);
      }
    }

    return bubbles;
  }

  function extractAll(text) {
    const result = [];
    let cursor = 0;

    while (cursor < text.length) {
      const start = text.indexOf(START, cursor);

      if (start === -1) break;

      const contentStart = start + START.length;
      const end = text.indexOf(END, contentStart);

      if (end === -1) break;

      const dialogue = text
        .slice(contentStart, end)
        .replace(/\s+/g, ' ')
        .trim();

      if (dialogue) result.push(dialogue);

      cursor = end + END.length;
    }

    return result;
  }

  // ---------- 队列 ----------

  function enqueue(text) {
    if (!text || spoken.has(text)) return false;

    // 入队时即登记，避免重复扫描时重复排队
    spoken.add(text);
    queue.push(text);

    return true;
  }

  function pumpQueue() {
    if (!enabled || !unlocked || isSpeaking) return;

    if (!queue.length) {
      setStatus('朗读完成，继续监听 AI 新对白…');
      return;
    }

    const text = queue.shift();

    isSpeaking = true;

    const utterance = new SpeechSynthesisUtterance(text);

    utterance.lang = 'zh-CN';
    utterance.rate = 1;
    utterance.pitch = 1;

    try {
      const voice = speechSynthesis.getVoices().find(v =>
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
      setStatus('语音错误：' + event.error);
      setTimeout(pumpQueue, 300);
    };

    try {
      speechSynthesis.speak(utterance);
    } catch (error) {
      isSpeaking = false;
      setStatus('播放失败，请重新开启朗读');
    }
  }

  // ---------- 扫描：只读取 AI ----------

  function scan() {
    const roots = collectRoots();

    observeRoots(roots);

    const bubbles = findAIBubbles(roots);

    let added = 0;

    for (const bubble of bubbles) {
      const text = getText(bubble);

      if (!text.includes(START) || !text.includes(END)) {
        continue;
      }

      const dialogues = extractAll(text);

      for (const dialogue of dialogues) {
        if (enabled && unlocked) {
          if (enqueue(dialogue)) added++;
        }
      }
    }

    if (!enabled || !unlocked) {
      if (bubbles.length) {
        setStatus('已监听 AI 气泡，等待开启朗读');
      }
      return;
    }

    if (added > 0) {
      setStatus('发现 AI 新对白，已加入队列 ' + added + ' 条');
      pumpQueue();
    }
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 300);
  }

  // ---------- 诊断 ----------

  function diagnostic() {
    const roots = collectRoots();

    observeRoots(roots);

    const aiBubbles = findAIBubbles(roots);
    let userCount = 0;
    let dialogueCount = 0;

    for (const root of roots) {
      try {
        userCount += root.querySelectorAll(USER_SELECTOR).length;
      } catch (_) {}
    }

    for (const bubble of aiBubbles) {
      dialogueCount += extractAll(getText(bubble)).length;
    }

    setStatus(
      'AI 气泡：' + aiBubbles.length +
      '；用户气泡：' + userCount +
      '；AI 对白组数：' + dialogueCount +
      '；队列：' + queue.length
    );
  }

  // ---------- 按钮 ----------

  enableButton.addEventListener('click', () => {
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
      scheduleScan();
      setTimeout(pumpQueue, 150);
    };

    speechSynthesis.speak(unlock);
  });

  panel.querySelector('#zxz-test')
    .addEventListener('click', () => {
      if (!enabled) {
        setStatus('请先开启朗读');
        return;
      }

      const testText = '听见了吗？过来。';

      // 测试语音不占用正式对白去重记录
      queue.push(testText);
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

  // ---------- 启动 ----------

  const roots = collectRoots();

  observeRoots(roots);
  scheduleScan();

})();
