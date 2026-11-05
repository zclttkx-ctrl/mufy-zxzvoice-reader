
// ==UserScript==
// @name         Mufy ZXZ Voice Reader
// @namespace    https://github.com/zclttkx-ctrl/mufy-zxzvoice-reader
// @version      1.2.0
// @description  Mufy AI角色对白自动朗读与消息识别诊断
// @match        https://chat.mufy.ai/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  // AI消息容器：官方类名 + Mufy备用结构
  const AI_SELECTOR = [
    '.mufy_ai_message_bubble',
    '.relative.inline-block[class*="bg-[#711B3F]"]',
    '.greeting-content',
    '[class*="message-outgoing"]'
  ].join(',');

  // 只朗读明确标记的角色对白
  const DIALOGUE_SELECTOR = '.dialogue';

  // 排除用户消息及不应朗读的区域
  const USER_SELECTOR = [
    '.mufy_user_message_bubble',
    '.relative.inline-block[class*="bg-[#e8bec3]"]',
    '[class*="message-incoming"]'
  ].join(',');

  const IGNORE_SELECTOR = [
    '.mufy_message_narration',
    '.mufy_code_block',
    'details'
  ].join(',');

  const WAIT_TIME = 1800;

  let enabled = true;
  let speaking = false;
  let unlocked = false;
  let queue = [];
  let totalCaught = 0;

  const timers = new WeakMap();
  const seenLines = new WeakMap();

  function status(message) {
    const el = document.querySelector('#zxz-voice-status');
    if (el) el.textContent = message;
  }

  function isUserMessage(el) {
    return !!el.closest(USER_SELECTOR);
  }

  function findContainers(node) {
    if (!(node instanceof Element)) return [];

    const candidates = [];

    if (node.matches(AI_SELECTOR)) {
      candidates.push(node);
    }

    node.querySelectorAll(AI_SELECTOR).forEach(el => {
      candidates.push(el);
    });

    const parent = node.closest(AI_SELECTOR);
    if (parent) candidates.push(parent);

    const unique = [...new Set(candidates)]
      .filter(el => !isUserMessage(el));

    // 避免同一条消息的内外容器重复处理
    return unique.filter(el =>
      !unique.some(other =>
        other !== el && other.contains(el)
      )
    );
  }

  function getDialogues(bubble) {
    return [...bubble.querySelectorAll(DIALOGUE_SELECTOR)]
      .filter(el => !el.closest(IGNORE_SELECTOR))
      .map(el =>
        (el.innerText || el.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter(Boolean);
  }

  function playNext() {
    if (!enabled || speaking || !queue.length) return;

    if (!('speechSynthesis' in window)) {
      status('当前浏览器不支持语音');
      return;
    }

    const text = queue.shift();
    const utterance = new SpeechSynthesisUtterance(text);

    utterance.lang = 'zh-CN';
    utterance.rate = 1;
    utterance.pitch = 1;

    speaking = true;
    status('正在朗读角色对白…');

    utterance.onend = () => {
      speaking = false;

      if (queue.length) {
        playNext();
      } else {
        status('朗读完成 · 继续监听');
      }
    };

    utterance.onerror = event => {
      speaking = false;
      status('语音播放错误：' + event.error);

      if (queue.length) playNext();
    };

    speechSynthesis.speak(utterance);
  }

  function inspect(bubble) {
    if (!enabled || !bubble || !bubble.isConnected) return;

    clearTimeout(timers.get(bubble));

    const timer = setTimeout(() => {
      if (!enabled || !bubble.isConnected) return;

      const lines = getDialogues(bubble);

      if (!lines.length) {
        status('已发现AI消息，但没有找到 .dialogue 标签');
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

      totalCaught += fresh.length;
      queue.push(...fresh);

      status('已抓到对白 ' + totalCaught + ' 条，准备朗读');
      playNext();

    }, WAIT_TIME);

    timers.set(bubble, timer);
  }

  function scan(node) {
    if (!(node instanceof Element)) return;

    findContainers(node).forEach(inspect);
  }

  function testVoice() {
    if (!('speechSynthesis' in window)) {
      status('此浏览器不支持语音');
      return;
    }

    speechSynthesis.cancel();
    speaking = false;

    const test = new SpeechSynthesisUtterance(
      '语音测试成功。老婆，现在可以听见我的声音了吗？'
    );

    test.lang = 'zh-CN';
    test.rate = 1;
    test.pitch = 1;

    status('正在测试声音…');

    test.onend = () => {
      unlocked = true;
      status('测试完成 · 监听中');
      playNext();
    };

    test.onerror = event => {
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
      max-width:230px;
    `;

    const label = document.createElement('div');
    label.id = 'zxz-voice-status';
    label.textContent = '监听已启动 · 等待角色对白';
    label.style.cssText =
      'max-width:210px;word-break:break-word;line-height:1.5';

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

        if ('speechSynthesis' in window) {
          speechSynthesis.cancel();
        }

        speaking = false;
        toggle.textContent = '开启';
        status('朗读已暂停');
      } else {
        toggle.textContent = '暂停';
        status('监听已恢复');
        playNext();
      }
    };

    test.onclick = testVoice;

    clear.onclick = () => {
      queue = [];

      if ('speechSynthesis' in window) {
        speechSynthesis.cancel();
      }

      speaking = false;
      status('播放队列已清空');
    };

    buttons.append(toggle, test, clear);
    panel.append(label, buttons);
    document.body.appendChild(panel);
  }

  function start() {
    createPanel();

    // 不朗读打开页面前已经存在的历史消息
    const existing = findContainers(document.body);
    existing.forEach(bubble => {
      // 仅记录已有对白，避免刷新页面后重复朗读
      const known = new Set(getDialogues(bubble));
      seenLines.set(bubble, known);
    });

    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'childList') {
          record.addedNodes.forEach(scan);

          if (record.target instanceof Element) {
            findContainers(record.target).forEach(inspect);
          }
        }

        if (record.type === 'characterData') {
          const parent = record.target.parentElement;
          if (parent) scan(parent);
        }

        if (record.type === 'attributes') {
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

    status('1.2已启动 · 等待角色对白');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, {
      once: true
    });
  } else {
    start();
  }
})();
