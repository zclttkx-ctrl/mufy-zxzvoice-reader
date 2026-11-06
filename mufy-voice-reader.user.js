// ==UserScript==
// @name         Mufy ZXZ Voice Reader — Jiang Chaosheng
// @namespace    https://github.com/zclttkx-ctrl/mufy-zxzvoice-reader
// @version      1.6.4
// @description  Read new Mufy dialogue with your locally saved VocoLoco voice.
// @match        https://chat.mufy.ai/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const VOCO_URL = 'https://zclttkx-ctrl.github.io/vocoloco-mufy/';
  const VOCO_ORIGIN = 'https://zclttkx-ctrl.github.io';
  const VOICE_NAME = '姜潮生';
  const CHANNEL = 'mufy-vocoloco-164';
  const DIALOGUE_SELECTOR = '.zxznarration';
  const STABLE_DELAY = 1200;
  const SCAN_INTERVAL = 350;

  let vocWindow = null;
  let bridgeReady = false;
  let enabled = false;
  let speaking = false;
  let stopped = false;
  let requestSeq = 0;
  let currentSource = null;
  let audioContext = null;
  const queue = [];
  const pending = new Map();
  const seen = new WeakSet();
  const timers = new WeakMap();

  const style = document.createElement('style');
  style.textContent = `
    #zxz164-panel{position:fixed;z-index:2147483647;right:14px;bottom:100px;
      display:flex;gap:7px;align-items:center;font:13px -apple-system,BlinkMacSystemFont,sans-serif}
    #zxz164-panel button{border:0;border-radius:18px;padding:10px 13px;color:#fff;
      background:#292929;box-shadow:0 2px 10px #0003}
    #zxz164-panel button.primary{background:#8b3444}
    #zxz164-status{max-width:145px;color:#fff;background:#222d;padding:7px 9px;border-radius:12px}
  `;
  document.documentElement.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'zxz164-panel';
  panel.innerHTML = '<button id="zxz164-connect">连接姜潮生</button><button id="zxz164-toggle" class="primary">开启朗读</button><button id="zxz164-stop">停止</button><span id="zxz164-status">未连接</span>';
  document.body.appendChild(panel);

  const statusEl = panel.querySelector('#zxz164-status');
  const toggleEl = panel.querySelector('#zxz164-toggle');
  const setStatus = (s) => { statusEl.textContent = s; };

  function unlockAudio() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('此浏览器不支持音频播放');
    if (!audioContext) audioContext = new Ctx({ sampleRate: 24000 });
    return audioContext.resume();
  }

  function connectVoco() {
    vocWindow = window.open(VOCO_URL, 'mufyVocoLoco');
    if (!vocWindow) {
      setStatus('弹窗被拦截，请允许弹窗');
      return;
    }
    bridgeReady = false;
    setStatus('正在连接声音页…');
    pingBridge();
  }

  function pingBridge() {
    if (!vocWindow || vocWindow.closed) {
      bridgeReady = false;
      if (enabled) setStatus('声音页未打开');
      return;
    }
    try {
      vocWindow.postMessage({
        channel: CHANNEL,
        type: 'ping',
        voice: VOICE_NAME
      }, VOCO_ORIGIN);
    } catch {}
  }

  function requestSpeech(text) {
    return new Promise((resolve, reject) => {
      const id = `${Date.now()}-${++requestSeq}`;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error('语音生成超时，请检查声音页是否仍打开'));
      }, 300000);

      pending.set(id, { resolve, reject, timeout });

      if (!vocWindow || vocWindow.closed) {
        clearTimeout(timeout);
        pending.delete(id);
        reject(new Error('请先连接并保持 VocoLoco 声音页打开'));
        return;
      }

      vocWindow.postMessage({
        channel: CHANNEL,
        type: 'synthesize',
        id,
        text,
        voice: VOICE_NAME
      }, VOCO_ORIGIN);
    });
  }

  function playPCM(pcm, sampleRate) {
    return new Promise((resolve, reject) => {
      if (!audioContext) {
        reject(new Error('请先开启朗读以启用音频'));
        return;
      }

      const samples = pcm instanceof Float32Array
        ? pcm
        : new Float32Array(pcm);

      if (!samples.length) {
        reject(new Error('收到的音频为空'));
        return;
      }

      const buffer = audioContext.createBuffer(
        1, samples.length, sampleRate || 24000
      );

      buffer.copyToChannel(samples, 0);

      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      currentSource = source;

      source.onended = () => {
        if (currentSource === source) currentSource = null;
        resolve();
      };

      source.start();
    });
  }

  async function pumpQueue() {
    if (speaking || !enabled || !queue.length) return;

    speaking = true;
    stopped = false;
    const text = queue.shift();

    try {
      setStatus('生成语音中…');
      const result = await requestSpeech(text);

      if (stopped || !enabled) return;

      setStatus('正在朗读');
      await playPCM(result.pcm, result.sampleRate);
    } catch (err) {
      setStatus(err.message || '朗读失败');
    } finally {
      speaking = false;

      if (enabled && !stopped) {
        if (queue.length) {
          pumpQueue();
        } else {
          setStatus(bridgeReady ? '姜潮生已连接 · 待机' : '等待连接');
        }
      }
    }
  }

  function enqueue(text) {
    const clean = (text || '').replace(/\s+/g, ' ').trim();
    if (!clean || clean.length < 2) return;
    queue.push(clean);
    pumpQueue();
  }

  function scan() {
    if (!enabled) return;

    document.querySelectorAll(DIALOGUE_SELECTOR).forEach((node) => {
      if (seen.has(node)) return;

      const text = node.innerText || node.textContent || '';
      if (!text.trim()) return;

      const oldTimer = timers.get(node);
      if (oldTimer) clearTimeout(oldTimer);

      const timer = setTimeout(() => {
        if (!node.isConnected || seen.has(node)) return;
        seen.add(node);
        enqueue(node.innerText || node.textContent || '');
      }, STABLE_DELAY);

      timers.set(node, timer);
    });
  }

  panel.querySelector('#zxz164-connect')
    .addEventListener('click', connectVoco);

  toggleEl.addEventListener('click', async () => {
    try {
      await unlockAudio();
      enabled = !enabled;
      toggleEl.textContent = enabled ? '暂停朗读' : '开启朗读';
      setStatus(enabled ? '朗读已开启' : '已暂停');
      if (enabled) scan();
    } catch (err) {
      setStatus(err.message);
    }
  });

  panel.querySelector('#zxz164-stop').addEventListener('click', () => {
    stopped = true;
    queue.length = 0;

    try { currentSource?.stop(); } catch {}
    currentSource = null;

    if (vocWindow && !vocWindow.closed) {
      vocWindow.postMessage({
        channel: CHANNEL,
        type: 'cancel'
      }, VOCO_ORIGIN);
    }

    setStatus('已停止');
  });

  window.addEventListener('message', (event) => {
    if (event.origin !== VOCO_ORIGIN || event.source !== vocWindow) return;

    const data = event.data || {};
    if (data.channel !== CHANNEL) return;

    if (data.type === 'pong') {
      bridgeReady = !!data.ready && !!data.voiceFound;
      setStatus(
        !data.voiceFound
          ? '未找到姜潮生声音'
          : (data.ready ? '姜潮生已连接' : '声音页加载中/忙碌')
      );
    }

    if (data.type === 'audio') {
      const item = pending.get(data.id);
      if (!item) return;

      clearTimeout(item.timeout);
      pending.delete(data.id);
      item.resolve({
        pcm: data.pcm,
        sampleRate: data.sampleRate || 24000
      });
    }

    if (data.type === 'error') {
      const item = pending.get(data.id);
      if (!item) return;

      clearTimeout(item.timeout);
      pending.delete(data.id);
      item.reject(new Error(data.message || '语音生成失败'));
    }
  });

  setInterval(pingBridge, 2500);
  setInterval(scan, SCAN_INTERVAL);
  setStatus('先连接声音页');
})();
