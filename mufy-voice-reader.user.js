
// ==UserScript==
// @name         Mufy ZXZ Voice Reader
// @namespace    https://github.com/zclttkx-ctrl/mufy-zxzvoice-reader
// @version      1.5.0
// @description  Automatically read Mufy AI dialogue wrapped in voice markers
// @match        https://chat.mufy.ai/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const START_MARK = '【语音开始】';
  const END_MARK = '【语音结束】';

  const EXCLUDE_SELECTOR = [
    '.mufy_user_message_bubble',
    '[class*="message-incoming"]',
    '.mufy_message_narration',
    'script',
    'style',
    'textarea',
    'input',
    '[contenteditable="true"]'
  ].join(',');

  let enabled = false;
  let observer = null;
  let voiceUnlocked = false;

  const spokenTexts = new Set();

  const panel = document.createElement('div');
  panel.id = 'zxz-voice-reader-panel';

  panel.innerHTML = `
    <div id="zxz-vr-title">ZXZ VOICE READER <span>1.5.0</span></div>
    <div id="zxz-vr-status">正在寻找语音标记…</div>
    <div id="zxz-vr-buttons">
      <button id="zxz-vr-enable">开启朗读</button>
      <button id="zxz-vr-test">试听</button>
      <button id="zxz-vr-stop">停止</button>
    </div>
    <div id="zxz-vr-footer">自动识别角色对白 · 旁白不朗读</div>
  `;

  const css = document.createElement('style');
  css.textContent = `
    #zxz-voice-reader-panel {
      position: fixed;
      z-index: 2147483647;
      right: 12px;
      bottom: 22px;
      width: 245px;
      padding: 13px;
      box-sizing: border-box;
      border: 1px solid rgba(255,255,255,.18);
      border-radius: 13px;
      background: rgba(25,25,29,.96);
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      box-shadow: 0 5px 22px rgba(0,0,0,.28);
      font-size: 12px;
    }

    #zxz-vr-title {
      font-size: 11px;
      letter-spacing: 1px;
      font-weight: 700;
      color: #f0c5ce;
    }

    #zxz-vr-title span {
      float: right;
      color: #999;
      font-weight: 400;
    }

    #zxz-vr-status {
      min-height: 32px;
      padding: 12px 0 8px;
      color: #ddd;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }

    #zxz-vr-buttons {
      display: flex;
      gap: 6px;
    }

    #zxz-vr-buttons button {
      flex: 1;
      border: 0;
      border-radius: 7px;
      padding: 9px 3px;
      background: #713847;
      color: white;
      font-size: 11px;
      font-weight: 600;
    }

    #zxz-vr-buttons button:active {
      opacity: .7;
    }

    #zxz-vr-footer {
      padding-top: 9px;
      color: #888;
      font-size: 10px;
      text-align: center;
    }
  `;

  document.documentElement.appendChild(css);
  document.documentElement.appendChild(panel);

  const status = panel.querySelector('#zxz-vr-status');
  const enableButton = panel.querySelector('#zxz-vr-enable');

  function setStatus(message) {
    status.textContent = message;
  }

  function getText(element) {
    return (element.innerText || element.textContent || '')
      .replace(/\u00a0/g, ' ')
      .trim();
  }

  function containsMarkers(text) {
    return text.includes(START_MARK) && text.includes(END_MARK);
  }

  function isExcluded(element) {
    try {
      return !!element.closest(EXCLUDE_SELECTOR);
    } catch (error) {
      return false;
    }
  }

  // 找到包含完整语音标记的最小正文元素
  function findDialogueElements() {
    const all = document.body.querySelectorAll('*');
    const candidates = [];

    for (const element of all) {
      if (panel.contains(element)) continue;
      if (isExcluded(element)) continue;

      const text = getText(element);

      if (!text || !containsMarkers(text)) continue;

      candidates.push({
        element,
        text
      });
    }

    // 优先选最内层：如果子元素已经包含完整标记，
    // 就不再选择它的父级容器。
    const leaves = candidates.filter(item => {
      for (const child of item.element.children) {
        if (containsMarkers(getText(child))) {
          return false;
        }
      }
      return true;
    });

    return leaves.length ? leaves : candidates;
  }

  function extractDialogue(text) {
    const start = text.indexOf(START_MARK);
    if (start < 0) return '';

    const contentStart = start + START_MARK.length;
    const end = text.indexOf(END_MARK, contentStart);

    if (end < 0) return '';

    return text
      .slice(contentStart, end)
      .replace(/\s+/g, ' ')
      .trim();
  }

  function speak(text) {
    if (!enabled || !voiceUnlocked || !text) return;

    if (!('speechSynthesis' in window)) {
      setStatus('当前浏览器不支持语音朗读');
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 1;
    utterance.pitch = 1;

    const voices = window.speechSynthesis.getVoices();
    const chineseVoice = voices.find(voice =>
      voice.lang && voice.lang.toLowerCase().startsWith('zh')
    );

    if (chineseVoice) {
      utterance.voice = chineseVoice;
    }

    utterance.onstart = () => {
      setStatus('正在朗读角色对白…');
    };

    utterance.onend = () => {
      setStatus('朗读完成，继续监听新对白');
    };

    utterance.onerror = event => {
      setStatus('语音播放遇到问题：' + event.error);
    };

    window.speechSynthesis.speak(utterance);
  }

  function scanPage() {
    if (!document.body) return;

    const candidates = findDialogueElements();

    if (!candidates.length) {
      return;
    }

    let foundNew = false;

    for (const item of candidates) {
      const dialogue = extractDialogue(item.text);
      if (!dialogue) continue;

      // 同一段对白只朗读一次
      if (spokenTexts.has(dialogue)) continue;

      spokenTexts.add(dialogue);

      // 控制缓存大小
      if (spokenTexts.size > 120) {
        const first = spokenTexts.values().next().value;
        spokenTexts.delete(first);
      }

      foundNew = true;

      if (enabled && voiceUnlocked) {
        speak(dialogue);
      }
    }

    if (foundNew && !enabled) {
      setStatus('已发现角色语音对白，点击开启朗读');
    }
  }

  let scanTimer = null;

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanPage, 350);
  }

  function startObserver() {
    if (observer || !document.body) return;

    observer = new MutationObserver(() => {
      scheduleScan();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    setStatus('监听中，等待角色发送对白…');
  }

  enableButton.addEventListener('click', () => {
    if (!('speechSynthesis' in window)) {
      setStatus('当前浏览器不支持语音朗读');
      return;
    }

    enabled = true;
    voiceUnlocked = true;

    enableButton.textContent = '朗读已开启';
    setStatus('朗读已开启，等待角色新对白…');

    // 用户主动点击，解锁浏览器语音播放
    const unlock = new SpeechSynthesisUtterance('语音朗读已开启');
    unlock.lang = 'zh-CN';
    unlock.rate = 1;

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(unlock);
  });

  panel.querySelector('#zxz-vr-test').addEventListener('click', () => {
    if (!('speechSynthesis' in window)) {
      setStatus('当前浏览器不支持语音朗读');
      return;
    }

    enabled = true;
    voiceUnlocked = true;
    enableButton.textContent = '朗读已开启';

    window.speechSynthesis.cancel();

    const test = new SpeechSynthesisUtterance('听见了吗？过来。');
    test.lang = 'zh-CN';
    test.rate = 1;
    test.pitch = 1;

    window.speechSynthesis.speak(test);
    setStatus('正在试听…');
  });

  panel.querySelector('#zxz-vr-stop').addEventListener('click', () => {
    enabled = false;
    voiceUnlocked = false;

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    enableButton.textContent = '开启朗读';
    setStatus('朗读已停止');
  });

  function initialize() {
    startObserver();
    scanPage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }

})();
