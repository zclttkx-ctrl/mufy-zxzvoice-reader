// ==UserScript==
// @name         Mufy ZXZ Voice Reader
// @namespace    https://github.com/zclttkx-ctrl/mufy-zxzvoice-reader
// @version      1.5.8
// @description  Mufy message structure diagnostic
// @match        https://chat.mufy.ai/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const ACTION_SELECTOR = '[id="mufy_message_actions_btn"]';
  const ROW_SELECTOR = 'div.relative.flex.w-full.pb-4';

  const oldPanel = document.getElementById('zxz-voice-panel');
  if (oldPanel) oldPanel.remove();

  const panel = document.createElement('div');
  panel.id = 'zxz-voice-panel';

  panel.innerHTML = `
    <div style="font-weight:bold;color:#f0c5ce;margin-bottom:7px">
      ZXZ VOICE READER 1.5.8
    </div>
    <div id="zxz-status" style="font-size:11px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;max-height:35vh;overflow:auto">
      正在检查页面…
    </div>
    <button id="zxz-check" style="margin-top:8px;padding:7px;background:#713847;color:white;border:0;border-radius:5px">
      重新检查
    </button>
  `;

  Object.assign(panel.style, {
    position: 'fixed',
    zIndex: '2147483647',
    right: '10px',
    bottom: '110px',
    width: '290px',
    maxHeight: '55vh',
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

  function diagnostic() {
    const buttons = document.querySelectorAll(ACTION_SELECTOR);
    const lines = [];

    lines.push('操作按钮：' + buttons.length);
    lines.push('');

    buttons.forEach((button, index) => {
      const row = button.closest(ROW_SELECTOR);

      lines.push('===== 消息 ' + (index + 1) + ' =====');

      if (!row) {
        lines.push('没有找到第4层消息容器');
        return;
      }

      lines.push('根节点：' + row.tagName.toLowerCase());
      lines.push('根节点 class：' + row.className);

      const text = (row.innerText || '')
        .replace(/\s+/g, ' ')
        .trim();

      lines.push('消息文本：' + (text.slice(0, 220) || '(空)'));

      const descendants = row.querySelectorAll('*');

      const layoutClasses = [];

      descendants.forEach(el => {
        if (
          el.classList.contains('flex-row') ||
          el.classList.contains('flex-row-reverse')
        ) {
          layoutClasses.push(el.tagName.toLowerCase() + '.' + el.className);
        }
      });

      lines.push(
        '方向布局：' +
        (layoutClasses.slice(0, 5).join(' | ') || '未发现')
      );

      const images = row.querySelectorAll('img');

      images.forEach((img, i) => {
        lines.push(
          '图片' + (i + 1) +
          ' alt=' + (img.alt || '(无)') +
          ' src=' + (img.getAttribute('src') || '(无)').slice(0, 100)
        );
      });

      const prose = row.querySelectorAll('.prose');

      prose.forEach((el, i) => {
        lines.push(
          '正文' + (i + 1) +
          ' class=' + el.className +
          ' text=' + (el.innerText || '').slice(0, 150)
        );
      });

      lines.push('子元素结构：');

      Array.from(row.children).forEach((child, i) => {
        lines.push(
          '子元素' + i + '：' +
          child.tagName.toLowerCase() +
          ' .' +
          (typeof child.className === 'string'
            ? child.className.replace(/\s+/g, '.')
            : '')
        );
      });

      lines.push('');
    });

    status.textContent = lines.join('\n');
  }

  panel.querySelector('#zxz-check')
    .addEventListener('click', diagnostic);

  diagnostic();

})();
