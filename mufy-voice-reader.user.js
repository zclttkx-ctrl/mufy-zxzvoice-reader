
// ==UserScript==
// @name         Mufy ZXZ Voice Reader
// @namespace    https://github.com/zclttkx-ctrl/mufy-zxzvoice-reader
// @version      1.0.0
// @description  Mufy AI角色对白自动朗读
// @match        https://chat.mufy.ai/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const AI_SELECTOR = '.mufy_ai_message_bubble';
  const DIALOGUE_SELECTOR = '.dialogue';
  const WAIT_TIME = 2500;

  let enabled = true;
  let speaking = false;
  let queue = [];
  let unlocked = false;

  const processed = new WeakSet();
  const timers = new WeakMap();

  function getDialogues(bubble) {
    return [...bubble.querySelectorAll(DIALOGUE_SELECTOR)]
      .map(el => (el.innerText || el.textContent || '')
        .replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  function status(text) {
    const el = document.querySelector('#zxz-voice-status');
    if (el) el.textContent = text;
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
      if (queue.length) playNext();
      else status('朗读已开启');
    };

    utterance.onerror = () => {
      speaking = false;
      status('播放遇到问题');
      if (queue.length) playNext();
    };

    speechSynthesis.speak(utterance);
  }

  function inspect(bubble) {
    if (!enabled || processed.has(bubble)) return;

    clearTimeout(timers.get(bubble));

    const timer = setTimeout(() => {
      if (!bubble.isConnected || processed.has(bubble)) return;

      const lines = getDialogues(bubble);
      if (!lines.length) return;

      processed.add(bubble);
      queue.push(...lines);
      playNext();
    }, WAIT_TIME);

    timers.set(bubble, timer);
  }

  function scan(node) {
    if (!(node instanceof Element)) return;

    if (node.matches(AI_SELECTOR)) inspect(node);

    node.querySelectorAll(AI_SELECTOR).forEach(inspect);

    const parent = node.closest(AI_SELECTOR);
    if (parent) inspect(parent);
  }

  function unlock() {
    if (unlocked || !('speechSynthesis' in window)) return;

    const test = new SpeechSynthesisUtterance(' ');
    test.volume = 0;
    speechSynthesis.speak(test);
    speechSynthesis.cancel();

    unlocked = true;
  }

  function createPanel() {
    if (document.querySelector('#zxz-voice-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'zxz-voice-panel';
    panel.style.cssText = `
      position:fixed;
      right:12px;
      bottom:110px;
      z-index:2147483647;
      display:flex;
      align-items:center;
      gap:8px;
      padding:9px 12px;
      border-radius:24px;
      background:#29272e;
      color:white;
      font:13px -apple-system,sans-serif;
      box-shadow:0 3px 14px #0005;
    `;

    const label = document.createElement('span');
    label.id = 'zxz-voice-status';
    label.textContent = '朗读已开启';

    const toggle = document.createElement('button');
    toggle.textContent = '暂停';
    toggle.style.cssText =
      'border:0;border-radius:18px;padding:7px 12px;background:#7650a8;color:white';

    const clear = document.createElement('button');
    clear.textContent = '清空';
    clear.style.cssText =
      'border:0;border-radius:18px;padding:7px 12px;background:#555;color:white';

    toggle.onclick = () => {
      unlock();
      enabled = !enabled;

      if (!enabled) {
        queue = [];
        speechSynthesis.cancel();
        speaking = false;
        toggle.textContent = '开启';
        status('朗读已暂停');
      } else {
        toggle.textContent = '暂停';
        status('朗读已开启');
        playNext();
      }
    };

    clear.onclick = () => {
      queue = [];
      speechSynthesis.cancel();
      speaking = false;
      status('队列已清空');
    };

    panel.append(label, toggle, clear);
    document.body.appendChild(panel);
  }

  function start() {
    createPanel();

    // 页面加载时已有的历史消息不朗读
    document.querySelectorAll(AI_SELECTOR)
      .forEach(bubble => processed.add(bubble));

    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'childList') {
          record.addedNodes.forEach(scan);
        } else if (record.type === 'characterData') {
          const bubble = record.target.parentElement
            ?.closest(AI_SELECTOR);
          if (bubble) inspect(bubble);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
