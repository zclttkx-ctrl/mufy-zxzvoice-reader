// ==UserScript==
// @name         Mufy ZXZ Voice Reader
// @namespace    https://github.com/zclttkx-ctrl/mufy-zxzvoice-reader
// @version      1.5.2
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
  let observers = [];
  let scanTimer = null;
  const spoken = new Set();

  const panel = document.createElement('div');
  panel.id = 'zxz-voice-panel';
  panel.innerHTML = `
    <div class="zxz-title">ZXZ VOICE READER <span>1.5.2</span></div>
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
      position:fixed; z-index:2147483647;
      right:12px; bottom:22px; width:255px;
      padding:13px; box-sizing:border-box;
      border:1px solid #555; border-radius:12px;
      background:rgba(25,25,29,.97); color:white;
      font:12px -apple-system,BlinkMacSystemFont,sans-serif;
      box-shadow:0 5px 22px #0005;
    }
    #zxz-voice-panel .zxz-title {
      color:#f0c5ce; font-weight:bold;
      letter-spacing:1px; font-size:11px;
    }
    #zxz-voice-panel .zxz-title span {
      float:right; color:#999; font-weight:normal;
    }
    #zxz-status {
      min-height:42px; padding:12px 0;
      line-height:1.5; color:#ddd;
      overflow-wrap:anywhere;
    }
    #zxz-voice-panel .zxz-buttons {
      display:flex; gap:5px;
    }
    #zxz-voice-panel button {
      border:0; border-radius:6px;
      padding:9px 4px; color:white;
      background:#713847; font-size:10px;
    }
    #zxz-voice-panel .zxz-buttons button {
      flex:1;
    }
    #zxz-stop {
      width:100%; margin-top:6px;
      background:#444 !important;
    }
  `;

  document.documentElement.append(style, panel);

  const status = panel.querySelector('#zxz-status');
  const enableButton = panel.querySelector('#zxz-enable');

  function sayStatus(text) {
    status.textContent = text;
  }

  function getText(el) {
    return (el.innerText || el.textContent || '')
      .replace(/\u00a0/g, ' ').trim();
  }

  function hasMarkers(text) {
    return text.includes(START) && text.includes(END);
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
        if (!text || !hasMarkers(text)) continue;

        results.push({ element: el, text });
      }
    }

    // 过滤掉内容完全相同的重复元素
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

  function extract(text) {
    const start = text.indexOf(START);
    if (start < 0) return '';

    const from = start + START.length;
    const end = text.indexOf(END, from);

    if (end < 0) return '';

    return text.slice(from, end).replace(/\s+/g, ' ').trim();
  }

  function speak(text) {
    if (!enabled || !unlocked || !text) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 1;
    utterance.pitch = 1;

    const voices = speechSynthesis.getVoices();
    const voice = voices.find(v =>
      v.lang && v.lang.toLowerCase().startsWith('zh')
    );

    if (voice) utterance.voice = voice;

    utterance.onstart = () => {
      sayStatus('正在朗读：' + text);
    };

    utterance.onend = () => {
      sayStatus('朗读完成，继续监听新对白…');
    };

    utterance.onerror = e => {
      sayStatus('播放错误：' + e.error);
    };

    speechSynthesis.speak(utterance);
  }

  function scan() {
    const roots = collectRoots();
    const matches = findDialogues(roots);

    if (!matches.length) return;

    let found = false;

    for (const item of matches) {
      const dialogue = extract(item.text);
      if (!dialogue) continue;

      found = true;

      // 关键修复：
      // 未开启朗读时绝不把对白记为已读。
      if (!enabled || !unlocked) continue;

      if (spoken.has(dialogue)) continue;

      // 只有真正准备朗读时才记录
      spoken.add(dialogue);

      if (spoken.size > 120) {
        spoken.delete(spoken.values().next().value);
      }

      speak(dialogue);
    }

    if (found && (!enabled || !unlocked)) {
      sayStatus('已找到角色对白，点击开启朗读');
    }
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 400);
  }

  function attachObservers() {
    for (const observer of observers) observer.disconnect();
    observers = [];

    const roots = collectRoots();

    for (const root of roots) {
      try {
        const observer = new MutationObserver(scheduleScan);
        observer.observe(root, {
          childList: true,
          subtree: true,
          characterData: true
        });
        observers.push(observer);
      } catch (_) {}
    }

    scheduleScan();
  }

  function diagnostic() {
    const roots = collectRoots();
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

    sayStatus(
      '检查结果：区域 ' + roots.length +
      ' 个；开始标记 ' + (startFound ? '有' : '无') +
      '；结束标记 ' + (endFound ? '有' : '无') +
      '；完整正文元素 ' + matches.length
    );
  }

  enableButton.addEventListener('click', () => {
    enabled = true;
    unlocked = true;
    enableButton.textContent = '朗读已开启';

    speechSynthesis.cancel();

    const unlock = new SpeechSynthesisUtterance('语音朗读已开启');
    unlock.lang = 'zh-CN';
    speechSynthesis.speak(unlock);

    sayStatus('朗读已开启，正在检查已有对白…');

    // 立即重新扫描，补读开启前已经出现的对白
    scheduleScan();
  });

  panel.querySelector('#zxz-test').addEventListener('click', () => {
    enabled = true;
    unlocked = true;
    enableButton.textContent = '朗读已开启';

    speechSynthesis.cancel();

    const test = new SpeechSynthesisUtterance('听见了吗？过来。');
    test.lang = 'zh-CN';
    speechSynthesis.speak(test);

    sayStatus('正在试听…');
  });

  panel.querySelector('#zxz-check').addEventListener('click', diagnostic);

  panel.querySelector('#zxz-stop').addEventListener('click', () => {
    enabled = false;
    unlocked = false;
    speechSynthesis.cancel();

    enableButton.textContent = '开启朗读';
    sayStatus('朗读已停止');
  });

  attachObservers();
})();
