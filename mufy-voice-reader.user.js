// ==UserScript==
// @name         Mufy ZXZ Voice Reader
// @namespace    https://github.com/zclttkx-ctrl/mufy-zxzvoice-reader
// @version      1.5.7
// @description  Mufy message structure diagnostic
// @match        https://chat.mufy.ai/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const ACTION_SELECTOR = '[id="mufy_message_actions_btn"]';

  const oldPanel = document.getElementById('zxz-voice-panel');
  if (oldPanel) oldPanel.remove();

  const panel = document.createElement('div');
  panel.id = 'zxz-voice-panel';

  panel.innerHTML = `
    <div style="font-weight:bold;color:#f0c5ce;margin-bottom:7px">
      ZXZ VOICE READER 1.5.7
    </div>
    <div id="zxz-status" style="font-size:11px;line-height:1.6;overflow-wrap:anywhere">
      正在检查页面…
    </div>
    <button id="zxz-check" style="margin-top:8px;padding:7px;background:#713847;color:white;border:0;border-radius:5px">
      检查页面
    </button>
  `;

  Object.assign(panel.style, {
    position: 'fixed',
    zIndex: '2147483647',
    right: '10px',
    bottom: '110px',
    width: '270px',
    maxHeight: '45vh',
    overflow: 'auto',
    padding: '10px',
    boxSizing: 'border-box',
    border: '1px solid #555',
    borderRadius: '10px',
    background: 'rgba(25,25,29,.97)',
    color: 'white',
    font: '11px -apple-system,BlinkMacSystemFont,sans-serif',
    boxShadow: '0 4px 16px #0005'
  });

  document.documentElement.appendChild(panel);

  const status = panel.querySelector('#zxz-status');

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

  function describeNode(node, level) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
      return level + '层：非元素节点';
    }

    const tag = node.tagName.toLowerCase();

    let cls = '';

    if (typeof node.className === 'string') {
      cls = node.className;
    } else if (node.className && node.className.baseVal) {
      cls = node.className.baseVal;
    }

    cls = cls.trim().replace(/\s+/g, ' ');

    if (cls.length > 115) {
      cls = cls.slice(0, 115) + '…';
    }

    const id = node.id ? '#' + node.id : '';
    const classText = cls
      ? ' .' + cls.replace(/ /g, '.')
      : '';

    return level + '层：' + tag + id + classText;
  }

  function diagnostic() {
    const roots = collectRoots();

    const lines = [];
    let buttonCount = 0;

    for (const root of roots) {
      let buttons = [];

      try {
        buttons = root.querySelectorAll(ACTION_SELECTOR);
      } catch (_) {
        continue;
      }

      for (const button of buttons) {
        buttonCount++;

        lines.push('按钮 ' + buttonCount);

        let node = button;

        for (let level = 0; level < 9 && node; level++) {
          lines.push(describeNode(node, level));
          node = node.parentElement;
        }

        lines.push('----------');
      }
    }

    if (!buttonCount) {
      status.textContent = '没有找到操作按钮。';
      return;
    }

    status.textContent =
      '找到操作按钮：' + buttonCount +
      '。以下是每个按钮向上的九层结构：\n\n' +
      lines.join('\n');
  }

  panel.querySelector('#zxz-check')
    .addEventListener('click', diagnostic);

  diagnostic();

})();
