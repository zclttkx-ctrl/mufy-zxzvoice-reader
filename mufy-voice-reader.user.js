
// ==UserScript==
// @name         Mufy ZXZ Voice Reader
// @namespace    https://github.com/zclttkx-ctrl/mufy-zxzvoice-reader
// @version      1.4.0
// @description  Mufy对白抓取诊断与自动朗读
// @match        https://chat.mufy.ai/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const AI_SELECTOR = [
    '.mufy_ai_message_bubble',
    '.relative.inline-block[class*="bg-[#711B3F]"]',
    '.greeting-content',
    '[class*="message-outgoing"]'
  ].join(',');

  const USER_SELECTOR = [
    '.mufy_user_message_bubble',
    '.relative.inline-block[class*="bg-[#e8bec3]"]',
    '[class*="message-incoming"]'
  ].join(',');

  const START_MARK = '【语音开始】';
  const END_MARK = '【语音结束】';
  const WAIT_TIME = 2200;

  let enabled = true;
  let speaking = false;
  let queue = [];

  const timers = new WeakMap();
  const seen = new WeakMap();

  function status(message) {
    const el = document.querySelector('#zxz-voice-status');
    if (el) el.textContent = message;
  }

  function isUser(el) {
    return !!el.closest(USER_SELECTOR);
  }

  function containers(node) {
    if (!(node instanceof Element)) return [];

    const list = [];

    if (node.matches(AI_SELECTOR)) list.push(node);
    node.querySelectorAll(AI_SELECTOR).forEach(el => list.push(el));

    const parent = node.closest(AI_SELECTOR);
    if (parent) list.push(parent);

    const unique = [...new Set(list)].filter(el => !isUser(el));

    return unique.filter(el =>
      !unique.some(other => other !== el && other.contains(el))
    );
  }

  function readText(el) {
    return (el.innerText || el.textContent || '')
      .replace(/\u00a0/g, ' ');
  }

  function extract(text) {
    const lines = [];
    let pos = 0;

    while (true) {
      const start = text.indexOf(START_MARK, pos);
      if (start < 0) break;

      const contentStart = start + START_MARK.length;
      const end = text.indexOf(END_MARK, contentStart);
      if (end < 0) break;

      const line = text.slice(contentStart, end)
        .replace(/\s+/g, ' ')
        .trim();

      if (line) lines.push(line);
      pos = end + END_MARK.length;
    }

    return lines;
  }

  function inspect(el) {
    if (!enabled || !el || !el.isConnected) return;

    clearTimeout(timers.get(el));

    timers.set(el, setTimeout(() => {
      if (!el.isConnected) return;

      const text = readText(el);
      const lines = extract(text);

      const hasStart = text.includes(START_MARK);
      const hasEnd = text.includes(END_MARK);

      if (!lines.length) {
        status(
          '诊断：正文 ' + text.length +
          ' 字；开始标记 ' + (hasStart ? '有' : '无') +
          '；结束标记 ' + (hasEnd ? '有' : '无')
        );
        return;
      }

      let known = seen.get(el);
      if (!known) {
        known = new Set();
        seen.set(el, known);
      }

      const fresh = lines.filter(line => {
        if (known.has(line)) return false;
        known.add(line);
        return true;
      });

      if (!fresh.length) return;

      queue.push(...fresh);
      status('诊断成功：抓到 ' + fresh.length + ' 条对白');
      playNext();
    }, WAIT_TIME));
  }

  function playNext() {
    if (!enabled || speaking || !queue.length) return;

    if (!('speechSynthesis' in window)) {
      status('浏览器不支持语音');
      return;
    }

    const utterance = new SpeechSynthesisUtterance(queue.shift());
    utterance.lang = 'zh-CN';
    utterance.rate = 1;
    utterance.pitch = 1;

    speaking = true;
    status('正在朗读…');

    utterance.onend = () => {
      speaking = false;
      if (queue.length) playNext();
      else status('朗读完成 · 继续监听');
    };

    utterance.onerror = event => {
      speaking = false;
      status('语音错误：' + event.error);
      if (queue.length) playNext();
    };

    speechSynthesis.speak(utterance);
  }

  function scan(node) {
    if (!(node instanceof Element)) return;
    containers(node).forEach(inspect);
  }

  function testVoice() {
    if (!('speechSynthesis' in window)) {
      status('浏览器不支持语音');
      return;
    }

    speechSynthesis.cancel();
    speaking = false;

    const utterance = new SpeechSynthesisUtterance('语音测试成功。');
    utterance.lang = 'zh-CN';

    status('正在测试声音…');

    utterance.onend = () => status('测试完成 · 监听中');
    utterance.onerror = event => status('测试失败：' + event.error);

    speechSynthesis.speak(utterance);
  }

  function createPanel() {
    if (document.querySelector('#zxz-voice-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'zxz-voice-panel';
    panel.style.cssText = `
      position:fixed;right:10px;bottom:110px;z-index:2147483647;
      display:flex;flex-direction:column;gap:7px;padding:10px;
      border-radius:14px;background:#29272e;color:white;
      font:12px -apple-system,sans-serif;max-width:250px;
      box-shadow:0 3px 14px #0005;
    `;

    const label = document.createElement('div');
    label.id = 'zxz-voice-status';
    label.textContent = '1.4已启动 · 等待角色对白';
    label.style.cssText = 'line-height:1.5;word-break:break-word';

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';

    function makeButton(name) {
      const button = document.createElement('button');
      button.textContent = name;
      button.style.cssText = `
        border:0;border-radius:16px;padding:7px 10px;
        color:white;background:#7650a8;
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
        status('监听已恢复');
        playNext();
      }
    };

    test.onclick = testVoice;

    clear.onclick = () => {
      queue = [];
      speechSynthesis.cancel();
      speaking = false;
      status('播放队列已清空');
    };

    buttons.append(toggle, test, clear);
    panel.append(label, buttons);
    document.body.append(panel);
  }

  function start() {
    createPanel();

    containers(document.body).forEach(el => {
      seen.set(el, new Set(extract(readText(el))));
    });

    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'childList') {
          record.addedNodes.forEach(scan);
          if (record.target instanceof Element) {
            containers(record.target).forEach(inspect);
          }
        }

        if (record.type === 'characterData') {
          if (record.target.parentElement) scan(record.target.parentElement);
        }

        if (record.type === 'attributes') scan(record.target);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class']
    });

    status('1.4已启动 · 等待新消息');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
