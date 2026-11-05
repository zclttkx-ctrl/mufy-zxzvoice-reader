
// ==UserScript==
// @name         Mufy ZXZ Voice Reader
// @namespace    https://github.com/zclttkx-ctrl/mufy-zxzvoice-reader
// @version      1.1.0
// @description  Mufy AI角色对白自动朗读与抓取诊断
// @match        https://chat.mufy.ai/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const AI_SELECTOR =
    '.mufy_ai_message_bubble, [class*="mufy_ai_message"]';
  const DIALOGUE_SELECTOR = '.dialogue';

  const WAIT_TIME = 1800;

  let enabled = true;
  let speaking = false;
  let queue = [];
  let aiCount = 0;
  let dialogueCount = 0;

  const ignored = new WeakSet();
  const timers = new WeakMap();
  const seenLines = new WeakMap();

  function status(message) {
    const el = document.querySelector('#zxz-voice-status');
    if (el) el.textContent = message;
  }

  function getBubble(node) {
    if (!(node instanceof Element)) return null;

    return node.closest(AI_SELECTOR);
  }

  function getDialogues(bubble) {
    return [...bubble.querySelectorAll(DIALOGUE_SELECTOR)]
      .map(el => (el.innerText || el.textContent || '')
        .replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  function playNext() {
    if (!enabled || speaking || !queue.length) return;

    if (!('speechSynthesis' in window)) {
      status('浏览器不支持语音');
      return;
    }

    const text = queue.shift();
    const utterance = new SpeechSynthesisUtterance(text);

    utterance.lang = 'zh-CN';
    utterance.rate = 1;
    utterance.pitch = 1;

    speaking = true;
    status('正在朗读…');

    utterance.onend = () => {
      speaking = false;
      if (queue.length) {
        playNext();
      } else {
        status('朗读完成 · 监听中');
      }
    };

    utterance.onerror = (event) => {
      speaking = false;
      status('语音错误：' + event.error);
      if (queue.length) playNext();
    };

    speechSynthesis.speak(utterance);
  }

  function inspect(bubble) {
    if (!enabled || !bubble || ignored.has(bubble)) return;

    clearTimeout(timers.get(bubble));

    const timer = setTimeout(() => {
      if (!bubble.isConnected || ignored.has(bubble)) return;

      const lines = getDialogues(bubble);

      if (!lines.length) {
        status('发现AI消息，暂未找到对白标签');
        return;
      }

      let known = seenLines.get(bubble);
      if (!known) {
        known = new Set();
        seenLines.set(bubble, known);
      }

      const fresh = lines.filter(line => {
        if (known.has(line)) return false;
        known.add(line);
        return true;
      });

      if (!fresh.length) return;

      dialogueCount += fresh.length;
      status('已抓到对白 ' + dialogueCount + ' 条，准备播放');

      queue.push(...fresh);
      playNext();
    }, WAIT_TIME);

    timers.set(bubble, timer);
  }

  function scan(node) {
    if (!(node instanceof Element)) return;

    if (node.matches(AI_SELECTOR)) {
      aiCount++;
      inspect(node);
    }

    node.querySelectorAll(AI_SELECTOR).forEach(bubble => {
      aiCount++;
      inspect(bubble);
    });

    const parent = getBubble(node);
    if (parent) inspect(parent);
  }

  function testVoice() {
    if (!('speechSynthesis' in window)) {
      status('此浏览器不支持语音');
      return;
    }

    speechSynthesis.cancel();
    speaking = false;

    const test = new SpeechSynthesisUtterance(
      '语音测试成功。现在可以听见我的声音了吗？'
    );

    test.lang = 'zh-CN';
    test.rate = 1;
    test.pitch = 1;

    status('正在测试声音…');

    test.onend = () => {
      status('测试完成 · 监听中');
      playNext();
    };

    test.onerror = (event) => {
      status('测试失败：' + event.error);
    };

    speechSynthesis.speak(test);
  }

  function createPanel() {
    if (document.querySelector('#zxz-voice-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'zxz-voice-panel';

    panel.style.cssText = `
      position:fixed;
      right:10px;
      bottom:110px;
      z-index:2147483647;
      display:flex;
      flex-direction:column;
      gap:7px;
      padding:10px;
      border-radius:14px;
      background:#29272e;
      color:white;
      font:12px -apple-system,sans-serif;
      box-shadow:0 3px 14px #0005;
      max-width:220px;
    `;

    const label = document.createElement('div');
    label.id = 'zxz-voice-status';
    label.textContent = '监听中…';
    label.style.cssText = 'max-width:200px;word-break:break-word';

    const buttons = document.createElement('div');
    buttons.style.cssText =
      'display:flex;gap:6px;flex-wrap:wrap';

    function makeButton(text) {
      const button = document.createElement('button');
      button.textContent = text;
      button.style.cssText = `
        border:0;
        border-radius:16px;
        padding:7px 10px;
        color:white;
        background:#7650a8;
        font:12px -apple-system,sans-serif;
      `;
      return button;
    }

    const toggle = makeButton('暂停');
    const test = makeButton('测试声音');
    const clear = makeButton('清空');

    toggle.onclick = () => {
      enabled = !enabled;

      if (!enabled) {
        queue = [];
        speechSynthesis.cancel();
        speaking = false;
        toggle.textContent = '开启';
        status('朗读已暂停');
      } else {
        toggle.textContent = '暂停';
        status('监听中…');
        playNext();
      }
    };

    test.onclick = testVoice;

    clear.onclick = () => {
      queue = [];
      speechSynthesis.cancel();
      speaking = false;
      status('队列已清空');
    };

    buttons.append(toggle, test, clear);
    panel.append(label, buttons);
    document.body.appendChild(panel);
  }

  function start() {
    createPanel();

    // 页面初始历史消息不朗读
    document.querySelectorAll(AI_SELECTOR).forEach(bubble => {
      ignored.add(bubble);
    });

    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'childList') {
          record.addedNodes.forEach(scan);

          const parent = getBubble(record.target);
          if (parent) inspect(parent);

        } else if (record.type === 'characterData') {
          const parent = getBubble(record.target.parentElement);
          if (parent) inspect(parent);

        } else if (record.type === 'attributes') {
          scan(record.target);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class']
    });

    status('监听已启动 · 等待角色对白');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, {
      once: true
    });
  } else {
    start();
  }
})();
