// ==UserScript==
// @name         Mufy ZXZ Voice Reader
// @namespace    https://github.com/zclttkx-ctrl/mufy-zxzvoice-reader
// @version      1.5.9
// @description  Mufy message ancestor diagnostic
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
      ZXZ VOICE READER 1.5.9
    </div>
    <div id="zxz-status" style="
      font-size:11px;
      line-height:1.6;
      white-space:pre-wrap;
      overflow-wrap:anywhere;
      max-height:40vh;
      overflow:auto
    ">正在检查页面…</div>
    <button id="zxz-check" style="
      margin-top:8px;
      padding:7px;
      background:#713847;
      color:white;
      border:0;
      border-radius:5px
    ">重新检查</button>
  `;

  Object.assign(panel.style, {
    position: 'fixed',
    zIndex: '2147483647',
    right: '10px',
    bottom: '110px',
    width: '290px',
    maxHeight: '60vh',
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

  function shortClass(el) {
    if (!el) return '';

    let value = typeof el.className === 'string'
      ? el.className
      : '';

    return value.replace(/\s+/g, '.').slice(0, 180);
  }

  function diagnostic() {
    const buttons = document.querySelectorAll(ACTION_SELECTOR);
    const lines = [];

    lines.push('操作按钮：' + buttons.length);
    lines.push('');

    buttons.forEach((button, index) => {
      lines.push('========== 按钮 ' + (index + 1) + ' ==========');

      let node = button;

      for (let level = 0; level <= 7 && node; level++) {
        const tag = node.tagName.toLowerCase();

        lines.push('');
        lines.push('--- 向上第 ' + level + ' 层 ---');
        lines.push('标签：' + tag);
        lines.push('class：' + shortClass(node));

        const text = (node.innerText || node.textContent || '')
          .replace(/\s+/g, ' ')
          .trim();

        lines.push('文本：' + (text.slice(0, 180) || '(空)'));

        const children = Array.from(node.children || []);

        lines.push('直接子元素数量：' + children.length);

        children.slice(0, 6).forEach((child, i) => {
          const childText = (
            child.innerText ||
            child.textContent ||
            ''
          ).replace(/\s+/g, ' ').trim();

          lines.push(
            '子元素' + i +
            '：' + child.tagName.toLowerCase() +
            ' .' + shortClass(child) +
            ' 文本=' + (childText.slice(0, 90) || '(空)')
          );
        });

        const images = node.querySelectorAll('img');

        if (images.length) {
          Array.from(images).slice(0, 3).forEach((img, i) => {
            lines.push(
              '图片' + i +
              '：alt=' + (img.alt || '(无)') +
              '；src=' + (img.getAttribute('src') || '(无)').slice(0, 100)
            );
          });
        }

        const prose = node.querySelectorAll('.prose');

        if (prose.length) {
          Array.from(prose).slice(0, 3).forEach((el, i) => {
            lines.push(
              '正文' + i +
              '：' + shortClass(el) +
              '；文本=' + (
                el.innerText || el.textContent || ''
              ).replace(/\s+/g, ' ').slice(0, 120)
            );
          });
        }

        node = node.parentElement;
      }

      lines.push('');
    });

    status.textContent = lines.join('\n');
  }

  panel.querySelector('#zxz-check')
    .addEventListener('click', diagnostic);

  diagnostic();

})();
