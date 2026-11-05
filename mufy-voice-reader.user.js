// ==UserScript==
// @name         Mufy ZXZ Voice Reader
// @namespace    https://github.com/zclttkx-ctrl/mufy-zxzvoice-reader
// @version      1.5.3
// @description  Mufy automatic dialogue voice reader
// @match        https://chat.mufy.ai/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const START = '【语音开始】';
  const END = '【语音结束】';

  const EXCLUDE = [
    '.mufy_user_message_bubble',
    '[class*="message-incoming"]',
    '.mufy_message_narration',
    'script', 'style', 'textarea', 'input',
    '[contenteditable="true"]'
  ].join(',');

  let enabled = false;
  let unlocked = false;
  let scanTimer = null;
  let isSpeaking = false;

  const spoken = new Set();
  const queued = new Set();
  const queue = [];
  const observedRoots = new WeakSet();

  // ---------- 面板 ----------

  const panel = document.createElement('div');
  panel.id = 'zxz-voice-panel';

  panel.innerHTML = `
    <div class="zxz-title">
      ZXZ VOICE READER <span>1.5.3</span>
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
      letter-spacing:.5px;
      font-size:10px;
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

  function sayStatus(text) {
    status.textContent = text;
  }

  // ---------- 文本提取 ----------

  function getText(el) {
    return (el.innerText || el.textContent || '')
      .replace(/\u00a0/g, ' ')
      .trim();
  }

  function excluded(el) {
    try {
      return !!el.closest(EXCLUDE);
    } catch (_) {
      return false;
    }
  }

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

  // ---------- 监听新区域 ----------

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

  // ---------- 查找对白 ----------

  function findDialogues(roots) {
    const results = [];

    for (const root of roots) {
      let elements = [];

      try {
        elements = root.querySelectorAll('*');
      } catch (_) {
        continue;
      }

      for (const el of elements) {
        if (panel.contains(el)) continue;
        if (excluded(el)) continue;

        const text = getText(el);

        if (
          !text ||
          !text.includes(START) ||
          !text.includes(END)
        ) {
          continue;
        }

        results.push({ element: el, text });
      }
    }

    // 优先保留内容较短的节点，避免父子节点重复
    results.sort((a, b) => a.text.length - b.text.length);

    const chosen = [];
    const seen = new Set();

    for (const item of results) {
      if (seen.has(item.text)) continue;

      seen.add(item.text);
      chosen.push(item);
    }

    return chosen;
  }

  // 重要修复：一次提取所有完整对白，而不只是第一条
  function extractAll(text) {
    const dialogues = [];
    let cursor = 0;

    while (cursor < text.length) {
      const start = text.indexOf(START, cursor);

      if (start < 0) break;

      const from = start + START.length;
      const end = text.indexOf(END, from);

      if (end < 0) break;

      const dialogue = text
        .slice(from, end)
        .replace(/\s+/g, ' ')
        .trim();

      if (dialogue) {
        dialogues.push(dialogue);
      }

      cursor = end + END.length;
    }

    return dialogues;
  }

  // ---------- 语音队列 ----------

  function enqueue(text) {
    if (!text) return;

    if (spoken.has(text) || queued.has(text)) {
      return;
    }

    queued.add(text);
    queue.push(text);
  }

  function finishCurrent() {
    isSpeaking = false;

    if (!enabled || !unlocked) return;

    if (queue.length) {
      sayStatus('当前对白完成，队列剩余 ' + queue.length + ' 条…');
      setTimeout(pumpQueue, 120);
    } else {
      sayStatus('朗读完成，继续监听新对白…');
    }
  }

  function pumpQueue() {
    if (!enabled || !unlocked) return;
    if (isSpeaking) return;
    if (!queue.length) return;

    const text = queue.shift();

    queued.delete(text);
    spoken.add(text);
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
      sayStatus('正在朗读：' + text);
    };

    utterance.onend = finishCurrent;
    utterance.onerror = finishCurrent;

    try {
      speechSynthesis.speak(utterance);
    } catch (error) {
      finishCurrent();
    }
  }

  // ---------- 页面扫描 ----------

  function scan() {
    const roots = collectRoots();

    // 新出现的 Shadow DOM 也加入监听
    observeRoots(roots);

    const matches = findDialogues(roots);

    if (!matches.length) return;

    let found = false;
    let added = 0;

    for (const item of matches) {
      const dialogues = extractAll(item.text);

      for (const dialogue of dialogues) {
        found = true;

        if (!enabled || !unlocked) continue;

        const wasKnown =
          spoken.has(dialogue) || queued.has(dialogue);

        enqueue(dialogue);

        if (!wasKnown) added++;
      }
    }

    if (found && (!enabled || !unlocked)) {
      sayStatus('已找到角色对白，点击开启朗读');
      return;
    }

    if (added > 0) {
      sayStatus('已加入朗读队列：' + added + ' 条');
      pumpQueue();
    }
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 350);
  }

  // ---------- 诊断 ----------

  function diagnostic() {
    const roots = collectRoots();

    observeRoots(roots);

    let startFound = false;
    let endFound = false;

    for (const root of roots) {
      let text = '';

      try {
        text = root.body
          ? getText(root.body)
          : getText(root.host || document.body);
      } catch (_) {}

      if (text.includes(START)) startFound = true;
      if (text.includes(END)) endFound = true;
    }

    const matches = findDialogues(roots);

    let dialogueCount = 0;

    for (const item of matches) {
      dialogueCount += extractAll(item.text).length;
    }

    sayStatus(
      '区域 ' + roots.length +
      '；开始标记 ' + (startFound ? '有' : '无') +
      '；结束标记 ' + (endFound ? '有' : '无') +
      '；正文元素 ' + matches.length +
      '；对白组数 ' + dialogueCount +
      '；队列 ' + queue.length
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
      sayStatus('朗读已开启，正在监听新对白…');
      scheduleScan();
      setTimeout(pumpQueue, 120);
    };

    unlock.onerror = () => {
      isSpeaking = false;
      scheduleScan();
      setTimeout(pumpQueue, 120);
    };

    speechSynthesis.speak(unlock);

    scheduleScan();
  });

  panel.querySelector('#zxz-test')
    .addEventListener('click', () => {
      if (!enabled) {
        enabled = true;
        unlocked = true;
        enableButton.textContent = '朗读已开启';
      }

      enqueue('听见了吗？过来。');

      sayStatus('试听已加入队列…');
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
      queued.clear();

      enableButton.textContent = '开启朗读';

      sayStatus('朗读已停止');
    });

  // ---------- 启动 ----------

  const initialRoots = collectRoots();

  observeRoots(initialRoots);
  scheduleScan();

})();
