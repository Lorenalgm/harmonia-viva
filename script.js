/* ==========================================================================
   Harmonia Viva — Engine de Áudio & Visão Computacional (Hand Tracking)
   Web Audio API + MediaPipe Hands + Canvas Motion Fallback
   ========================================================================== */

// --- 1. Mapeamento de Notas e Frequências (Hz) ---
const NOTE_FREQS = {
  "C4": 261.63,
  "C#4": 277.18,
  "D4": 293.66,
  "D#4": 311.13,
  "E4": 329.63,
  "F4": 349.23,
  "F#4": 369.99,
  "G4": 392.00,
  "G#4": 415.30,
  "A4": 440.00,
  "A#4": 466.16,
  "B4": 493.88,
  "C5": 523.25
};

const NATURAL_NOTES = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"];

const KEY_BINDINGS = {
  'a': 'C4',
  'w': 'C#4',
  's': 'D4',
  'e': 'D#4',
  'd': 'E4',
  'f': 'F4',
  't': 'F#4',
  'g': 'G4',
  'y': 'G#4',
  'h': 'A4',
  'u': 'A#4',
  'j': 'B4',
  'k': 'C5'
};

// --- 2. Gerenciador de Áudio (Web Audio API) ---
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.analyser = null;
    this.currentWaveform = 'sine';
    this.volume = 0.6;
    this.sustainTime = 0.4;
    this.activeVoices = new Map();
  }

  init() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContextClass();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;

      this.masterGain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setWaveform(type) {
    this.currentWaveform = type;
  }

  setVolume(val) {
    this.volume = parseFloat(val);
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
  }

  setSustain(val) {
    this.sustainTime = parseFloat(val);
  }

  playNote(noteName, duration = null) {
    this.init();
    const freq = NOTE_FREQS[noteName];
    if (!freq) return null;

    if (this.activeVoices.has(noteName)) {
      this.stopNote(noteName);
    }

    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc.type = this.currentWaveform;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

    const now = this.ctx.currentTime;
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(1.0, now + 0.02);

    osc.connect(gainNode);
    gainNode.connect(this.masterGain);

    osc.start(now);

    const voice = { osc, gainNode, freq };
    this.activeVoices.set(noteName, voice);

    if (duration) {
      const releaseTime = this.sustainTime || 0.4;
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration + releaseTime);
      osc.stop(now + duration + releaseTime + 0.05);
      setTimeout(() => {
        if (this.activeVoices.get(noteName) === voice) {
          this.activeVoices.delete(noteName);
        }
      }, (duration + releaseTime + 0.1) * 1000);
    }

    return freq;
  }

  stopNote(noteName) {
    if (!this.ctx || !this.activeVoices.has(noteName)) return;

    const voice = this.activeVoices.get(noteName);
    this.activeVoices.delete(noteName);

    const now = this.ctx.currentTime;
    const releaseTime = Math.max(0.08, this.sustainTime * 0.4);

    voice.gainNode.gain.cancelScheduledValues(now);
    voice.gainNode.gain.setValueAtTime(voice.gainNode.gain.value, now);
    voice.gainNode.gain.exponentialRampToValueAtTime(0.0001, now + releaseTime);

    voice.osc.stop(now + releaseTime + 0.02);
  }

  playChord(frequencies, type = 'sine', duration = 1.2, arpeggiate = false) {
    this.init();
    const now = this.ctx.currentTime;

    frequencies.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);

      const startTime = arpeggiate ? now + idx * 0.12 : now;
      const endTime = startTime + duration;

      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.6 / Math.sqrt(frequencies.length), startTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(startTime);
      osc.stop(endTime + 0.05);
    });
  }
}

const audio = new AudioEngine();

// --- 3. Visualizador de Ondas em Canvas (Hero) ---
class WaveVisualizer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.modes = ['bars', 'oscilloscope', 'wave'];
    this.modeIndex = 0;
    this.phase = 0;

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
  }

  nextMode() {
    this.modeIndex = (this.modeIndex + 1) % this.modes.length;
    const modeNames = {
      'bars': 'Barras de Frequência',
      'oscilloscope': 'Osciloscópio Contínuo',
      'wave': 'Onda de Pulso Fluida'
    };
    const label = document.getElementById('visualizer-label');
    if (label) label.textContent = modeNames[this.modes[this.modeIndex]];
  }

  loop() {
    requestAnimationFrame(this.loop);
    const { ctx, width, height } = this;
    ctx.clearRect(0, 0, width, height);

    this.phase += 0.03;
    const currentMode = this.modes[this.modeIndex];

    let hasSound = false;
    let dataArray = null;

    if (audio.analyser) {
      const bufferLength = audio.analyser.frequencyBinCount;
      dataArray = new Uint8Array(bufferLength);
      
      if (currentMode === 'oscilloscope') {
        audio.analyser.getByteTimeDomainData(dataArray);
        for (let i = 0; i < bufferLength; i++) {
          if (Math.abs(dataArray[i] - 128) > 3) {
            hasSound = true;
            break;
          }
        }
      } else {
        audio.analyser.getByteFrequencyData(dataArray);
        for (let i = 0; i < bufferLength; i++) {
          if (dataArray[i] > 10) {
            hasSound = true;
            break;
          }
        }
      }
    }

    if (!hasSound) {
      this.drawIdleAnimation(ctx, width, height);
      return;
    }

    if (currentMode === 'bars') {
      this.drawFrequencyBars(ctx, width, height, dataArray);
    } else if (currentMode === 'oscilloscope') {
      this.drawOscilloscope(ctx, width, height, dataArray);
    } else {
      this.drawFluidWave(ctx, width, height, dataArray);
    }
  }

  drawIdleAnimation(ctx, width, height) {
    const centerY = height / 2;
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, '#8b5cf6');
    gradient.addColorStop(0.5, '#06b6d4');
    gradient.addColorStop(1, '#ec4899');

    ctx.beginPath();
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2.5;

    for (let x = 0; x < width; x += 4) {
      const y1 = centerY + Math.sin(x * 0.015 + this.phase) * 14 * Math.sin(x * 0.005);
      const y2 = Math.cos(x * 0.02 - this.phase * 0.8) * 8;
      const y = y1 + y2;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)';
    ctx.lineWidth = 1.5;
    for (let x = 0; x < width; x += 6) {
      const y = centerY + Math.sin(x * 0.01 - this.phase * 0.6) * 10;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  drawFrequencyBars(ctx, width, height, dataArray) {
    const numBars = 48;
    const barWidth = (width / numBars) - 2;

    for (let i = 0; i < numBars; i++) {
      const dataIndex = Math.floor(i * (dataArray.length / numBars) * 0.8);
      const value = dataArray[dataIndex] || 0;
      const barHeight = Math.max(4, (value / 255) * (height - 20));

      const x = i * (barWidth + 2);
      const y = height - barHeight - 10;

      const gradient = ctx.createLinearGradient(0, y, 0, height);
      gradient.addColorStop(0, '#06b6d4');
      gradient.addColorStop(0.6, '#8b5cf6');
      gradient.addColorStop(1, 'rgba(139, 92, 246, 0.2)');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, [3, 3, 0, 0]);
      ctx.fill();
    }
  }

  drawOscilloscope(ctx, width, height, dataArray) {
    ctx.beginPath();
    ctx.strokeStyle = '#38bdf8';
    ctx.shadowColor = 'rgba(56, 189, 248, 0.7)';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 3;

    const sliceWidth = width / dataArray.length;
    let x = 0;

    for (let i = 0; i < dataArray.length; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * height) / 2;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);

      x += sliceWidth;
    }

    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  drawFluidWave(ctx, width, height, dataArray) {
    const centerY = height / 2;
    ctx.beginPath();
    ctx.strokeStyle = '#c084fc';
    ctx.lineWidth = 3;

    for (let i = 0; i < dataArray.length; i += 2) {
      const x = (i / dataArray.length) * width;
      const factor = (dataArray[i] / 255) * 45;
      const y = centerY + Math.sin(x * 0.03 + this.phase) * factor;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// --- 4. Motor de Visão Computacional e Rastreamento de Dedos ---
class HandTrackingEngine {
  constructor() {
    this.video = document.getElementById('webcam');
    this.canvas = document.getElementById('hand-canvas');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.placeholder = document.getElementById('camera-placeholder');
    this.statusBadge = document.getElementById('camera-status');
    this.btnCamLabel = document.getElementById('btn-cam-label');
    this.btnToggleCam = document.getElementById('btn-toggle-camera');
    this.infoBar = document.getElementById('tracking-info');
    this.fpsDisplay = document.getElementById('fps-display');
    this.fingerDisplay = document.getElementById('finger-status-display');
    this.airKeysOverlay = document.getElementById('air-keys-overlay');
    this.modeLabel = document.getElementById('current-trigger-mode');

    this.stream = null;
    this.isCameraRunning = false;
    this.hands = null;
    this.cameraUtils = null;
    this.triggerMode = 'tap'; // 'tap' (toque aéreo) ou 'pinch' (pinça)
    this.activeAirNotes = new Set();
    this.ripples = []; // Efeitos visuais de toque no canvas

    // FPS Counter
    this.lastFrameTime = performance.now();
    this.frameCount = 0;
    this.fps = 0;

    // Fallback de movimento caso MediaPipe CDN não carregue
    this.isUsingFallback = false;
    this.prevFrameData = null;
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });

    this.setupListeners();
  }

  setupListeners() {
    const btnMain = document.getElementById('btn-toggle-camera-main');
    if (btnMain) btnMain.addEventListener('click', () => this.startCamera());

    if (this.btnToggleCam) {
      this.btnToggleCam.addEventListener('click', () => {
        if (this.isCameraRunning) this.stopCamera();
        else this.startCamera();
      });
    }

    const btnToggleZones = document.getElementById('btn-toggle-zones');
    if (btnToggleZones && this.airKeysOverlay) {
      btnToggleZones.addEventListener('click', () => {
        this.airKeysOverlay.classList.toggle('hidden');
      });
    }

    const btnToggleMode = document.getElementById('btn-toggle-mode');
    if (btnToggleMode && this.modeLabel) {
      btnToggleMode.addEventListener('click', () => {
        if (this.triggerMode === 'tap') {
          this.triggerMode = 'pinch';
          this.modeLabel.textContent = 'Pinça (Pinch)';
          this.setInfo('👌 Modo Pinça: Junte o polegar e o indicador no ar para tocar a nota!');
        } else {
          this.triggerMode = 'tap';
          this.modeLabel.textContent = 'Toque Aéreo';
          this.setInfo('👇 Modo Toque: Mova as pontas dos dedos para baixo nas colunas das notas!');
        }
      });
    }

    window.addEventListener('resize', () => this.resizeCanvas());
  }

  resizeCanvas() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    if (this.ctx) this.ctx.scale(dpr, dpr);
    this.canvasWidth = rect.width;
    this.canvasHeight = rect.height;
  }

  setInfo(msg) {
    if (this.infoBar) this.infoBar.textContent = msg;
  }

  setStatus(type, text) {
    if (!this.statusBadge) return;
    this.statusBadge.className = `status-badge status-${type}`;
    this.statusBadge.textContent = text;
  }

  async startCamera() {
    audio.init();

    // Verificação de protocolo de arquivo local (file://)
    if (window.location.protocol === 'file:') {
      this.setStatus('off', 'Bloqueio de Segurança (file://)');
      this.setInfo('⚠️ Atenção: Navegadores bloqueiam a câmera em arquivos abertos diretamente (file://). Inicie o servidor local: no terminal rode "python3 -m http.server 8000" e acesse "http://localhost:8000".');
      alert('🔒 Por segurança, os navegadores não permitem acesso à câmera quando o arquivo é aberto como file://.\n\nPara liberar a câmera com 1 clique:\n1. Abra o Terminal do seu Mac\n2. Digite:\n   cd /Users/lorena/.gemini/antigravity/scratch/pagina-musica\n   python3 -m http.server 8000\n3. Acesse no navegador: http://localhost:8000');
      return;
    }

    this.setStatus('active', 'Iniciando Câmera...');
    this.setInfo('Solicitando permissão da câmera ao navegador...');

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        },
        audio: false
      });

      this.video.srcObject = this.stream;
      await this.video.play();

      this.isCameraRunning = true;
      if (this.placeholder) this.placeholder.classList.add('hidden');
      if (this.btnCamLabel) this.btnCamLabel.textContent = 'Desligar Câmera';
      if (this.btnToggleCam) this.btnToggleCam.classList.add('active-danger');
      this.setStatus('tracking', 'Câmera Ativa — Rastreando');
      this.setInfo('Câmera conectada! Mostre suas mãos para tocar as notas.');

      this.resizeCanvas();
      this.initTracking();
    } catch (err) {
      console.error('Erro ao acessar a câmera:', err);
      this.setStatus('off', 'Câmera Bloqueada');
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        this.setInfo('❌ Permissão negada. Clique no ícone de configurações ao lado da URL (à esquerda de localhost:8000) e marque Câmera como "Permitir", ou libere nas permissões do macOS.');
        alert('⚠️ Acesso à câmera está bloqueado!\n\nComo liberar:\n1. Clique no ícone de configurações (ou cadeado) na barra de endereço do navegador à esquerda de "localhost:8000".\n2. Altere a opção "Câmera" para "Permitir".\n3. No Mac: verifique em Ajustes do Sistema > Privacidade e Segurança > Câmera se o seu navegador está com permissão ativada.\n4. Recarregue a página.');
      } else {
        this.setInfo(`⚠️ Não foi possível iniciar a webcam: ${err.message}.`);
      }
    }
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.isCameraRunning = false;
    if (this.placeholder) this.placeholder.classList.remove('hidden');
    if (this.btnCamLabel) this.btnCamLabel.textContent = 'Ligar Câmera';
    if (this.btnToggleCam) this.btnToggleCam.classList.remove('active-danger');
    this.setStatus('off', 'Câmera Desligada');
    this.setInfo('💡 Dica: Mantenha a mão bem iluminada e visível no enquadramento.');
    if (this.fpsDisplay) this.fpsDisplay.textContent = '0 FPS';

    this.clearAllAirNotes();
    if (this.ctx) this.ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
  }

  initTracking() {
    // Verifica se MediaPipe Hands está carregado globalmente
    if (typeof window.Hands !== 'undefined') {
      try {
        this.hands = new window.Hands({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });

        this.hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });

        this.hands.onResults((results) => this.onMediaPipeResults(results));

        // Loop de envio de frames para o MediaPipe
        const processFrame = async () => {
          if (!this.isCameraRunning) return;
          if (this.video.readyState >= 2) {
            await this.hands.send({ image: this.video });
          }
          requestAnimationFrame(processFrame);
        };
        requestAnimationFrame(processFrame);
        return;
      } catch (e) {
        console.warn('MediaPipe Hands falhou ao instanciar, ativando fallback óptico:', e);
      }
    }

    // Fallback óptico em Canvas caso MediaPipe não esteja disponível
    console.log('Utilizando modo de visão computacional de alta fidelidade nativo (Fallback)');
    this.isUsingFallback = true;
    this.runOpticalFallbackLoop();
  }

  // --- Processamento com MediaPipe Hands ---
  onMediaPipeResults(results) {
    if (!this.isCameraRunning) return;
    this.updateFPS();

    const { ctx, canvasWidth, canvasHeight } = this;
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Desenha e atualiza animações de ripples (ondas de toque)
    this.drawRipples();

    const handsDetected = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;
    const currentFrameActiveNotes = new Set();

    if (handsDetected) {
      this.setStatus('tracking', `Mãos Detectadas (${results.multiHandLandmarks.length})`);

      for (let h = 0; h < results.multiHandLandmarks.length; h++) {
        const landmarks = results.multiHandLandmarks[h];
        this.drawHandSkeleton(ctx, landmarks, canvasWidth, canvasHeight);

        // Dedos para detecção: Indicador (8), Médio (12), Anelar (16), Mindinho (20), Polegar (4)
        const fingertips = [
          { idx: 8, name: 'Indicador' },
          { idx: 12, name: 'Médio' },
          { idx: 16, name: 'Anelar' },
          { idx: 4, name: 'Polegar' }
        ];

        // Mapeamento do modo Pinça (Polegar 4 e Indicador 8 juntos)
        if (this.triggerMode === 'pinch') {
          const thumb = landmarks[4];
          const index = landmarks[8];
          const dist = Math.hypot(thumb.x - index.x, thumb.y - index.y);

          if (dist < 0.075) {
            const midX = (thumb.x + index.x) / 2;
            const midY = (thumb.y + index.y) / 2;
            const mirroredX = 1.0 - midX;
            const note = this.getNoteFromX(mirroredX);

            if (note) {
              currentFrameActiveNotes.add({ note, x: mirroredX * canvasWidth, y: midY * canvasHeight, finger: 'Pinça' });
            }
          }
        } else {
          // Modo Toque Aéreo (Tap / Y-Threshold)
          // A zona de disparo fica nos 38% inferiores (y > 0.62)
          const triggerThresholdY = 0.62;

          fingertips.forEach((tip) => {
            const pt = landmarks[tip.idx];
            if (pt.y > triggerThresholdY) {
              const mirroredX = 1.0 - pt.x;
              const note = this.getNoteFromX(mirroredX);
              if (note) {
                currentFrameActiveNotes.add({
                  note,
                  x: mirroredX * canvasWidth,
                  y: pt.y * canvasHeight,
                  finger: tip.name
                });
              }
            }
          });
        }
      }
    } else {
      this.setStatus('active', 'Aguardando Mãos...');
    }

    this.synchronizeAirNotes(currentFrameActiveNotes);
  }

  // Identifica a nota musical baseada na coordenada X normalizada (0.0 a 1.0)
  getNoteFromX(normalizedX) {
    const colIndex = Math.floor(normalizedX * NATURAL_NOTES.length);
    const clampedIndex = Math.max(0, Math.min(NATURAL_NOTES.length - 1, colIndex));
    return NATURAL_NOTES[clampedIndex];
  }

  // Desenho do esqueleto da mão estilizado com gradiente neon
  drawHandSkeleton(ctx, landmarks, w, h) {
    // Conexões das articulações da mão
    const CONNECTIONS = [
      [0, 1], [1, 2], [2, 3], [3, 4], // Polegar
      [0, 5], [5, 6], [6, 7], [7, 8], // Indicador
      [0, 9], [9, 10], [10, 11], [11, 12], // Médio
      [0, 13], [13, 14], [14, 15], [15, 16], // Anelar
      [0, 17], [17, 18], [18, 19], [19, 20], // Mindinho
      [5, 9], [9, 13], [13, 17] // Palma
    ];

    ctx.save();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.65)';
    ctx.shadowColor = 'rgba(139, 92, 246, 0.8)';
    ctx.shadowBlur = 8;

    CONNECTIONS.forEach(([start, end]) => {
      const p1 = landmarks[start];
      const p2 = landmarks[end];
      // Inverte X para coincidir com a imagem espelhada da câmera
      const x1 = (1.0 - p1.x) * w;
      const y1 = p1.y * h;
      const x2 = (1.0 - p2.x) * w;
      const y2 = p2.y * h;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    });

    // Desenha as pontas dos dedos com brilho ciano
    const fingertipsIndices = [4, 8, 12, 16, 20];
    fingertipsIndices.forEach((idx) => {
      const pt = landmarks[idx];
      const x = (1.0 - pt.x) * w;
      const y = pt.y * h;

      ctx.beginPath();
      ctx.fillStyle = '#06b6d4';
      ctx.shadowColor = '#06b6d4';
      ctx.shadowBlur = 12;
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();

      // Anel externo
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.stroke();
    });

    ctx.restore();
  }

  // Adiciona efeito ripple de impacto da nota no ar
  addRipple(x, y) {
    this.ripples.push({ x, y, radius: 4, opacity: 1 });
  }

  drawRipples() {
    const { ctx } = this;
    if (!ctx || this.ripples.length === 0) return;

    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.radius += 3.5;
      r.opacity -= 0.05;

      if (r.opacity <= 0) {
        this.ripples.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = `rgba(6, 182, 212, ${r.opacity})`;
      ctx.lineWidth = 2.5;
      ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Sincroniza as notas ativadas pelas mãos com o Sintetizador e Teclado
  synchronizeAirNotes(currentFrameNotes) {
    const notesToPlay = new Set();
    let lastTriggerInfo = null;

    currentFrameNotes.forEach((item) => {
      notesToPlay.add(item.note);
      lastTriggerInfo = item;
    });

    // Inicia notas recém-tocadas
    notesToPlay.forEach((note) => {
      if (!this.activeAirNotes.has(note)) {
        this.activeAirNotes.add(note);
        const freq = audio.playNote(note);

        // Feedback visual nas guias da câmera
        const airCol = document.querySelector(`.air-col[data-note="${note}"]`);
        if (airCol) airCol.classList.add('active');

        // Feedback visual no teclado do piano
        const pianoKey = document.querySelector(`.key[data-note="${note}"]`);
        if (pianoKey) {
          pianoKey.classList.add('camera-triggered');
          pianoKey.classList.add('active');
        }

        // Adiciona onda de choque visual
        if (lastTriggerInfo) {
          this.addRipple(lastTriggerInfo.x, lastTriggerInfo.y);
        }

        // Atualiza display de notas
        const currentNoteEl = document.getElementById('current-note-display');
        const currentFreqEl = document.getElementById('current-freq-display');
        if (currentNoteEl) currentNoteEl.textContent = note;
        if (currentFreqEl && freq) currentFreqEl.textContent = `${freq.toFixed(1)} Hz`;
        if (this.fingerDisplay && lastTriggerInfo) {
          this.fingerDisplay.innerHTML = `Origem: <span class="badge-source">Câmera (${lastTriggerInfo.finger})</span>`;
        }
      }
    });

    // Para notas que os dedos soltaram
    this.activeAirNotes.forEach((note) => {
      if (!notesToPlay.has(note)) {
        this.activeAirNotes.delete(note);
        audio.stopNote(note);

        const airCol = document.querySelector(`.air-col[data-note="${note}"]`);
        if (airCol) airCol.classList.remove('active');

        const pianoKey = document.querySelector(`.key[data-note="${note}"]`);
        if (pianoKey) {
          pianoKey.classList.remove('camera-triggered');
          pianoKey.classList.remove('active');
        }
      }
    });
  }

  clearAllAirNotes() {
    this.activeAirNotes.forEach((note) => {
      audio.stopNote(note);
      const airCol = document.querySelector(`.air-col[data-note="${note}"]`);
      if (airCol) airCol.classList.remove('active');

      const pianoKey = document.querySelector(`.key[data-note="${note}"]`);
      if (pianoKey) {
        pianoKey.classList.remove('camera-triggered');
        pianoKey.classList.remove('active');
      }
    });
    this.activeAirNotes.clear();
  }

  // --- Fallback Óptico por Diferença de Movimento (Offline / Sem MediaPipe) ---
  runOpticalFallbackLoop() {
    const loop = () => {
      if (!this.isCameraRunning) return;
      this.updateFPS();

      const { video, ctx, canvasWidth, canvasHeight, offscreenCanvas, offscreenCtx } = this;
      if (video.readyState >= 2) {
        offscreenCanvas.width = 160;
        offscreenCanvas.height = 120;
        offscreenCtx.drawImage(video, 0, 0, 160, 120);

        const currentFrame = offscreenCtx.getImageData(0, 0, 160, 120);
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        this.drawRipples();

        const currentFrameNotes = new Set();

        if (this.prevFrameData) {
          const numCols = NATURAL_NOTES.length;
          const colWidth = 160 / numCols;
          const triggerStartY = Math.floor(120 * 0.62);

          // Verifica movimento por coluna
          for (let col = 0; col < numCols; col++) {
            // Como o vídeo é exibido espelhado no CSS (scaleX -1), invertemos a coluna correspondente
            const mirroredCol = (numCols - 1) - col;
            let diffSum = 0;

            for (let y = triggerStartY; y < 120; y += 3) {
              for (let x = Math.floor(col * colWidth); x < Math.floor((col + 1) * colWidth); x += 3) {
                const idx = (y * 160 + x) * 4;
                const dR = Math.abs(currentFrame.data[idx] - this.prevFrameData.data[idx]);
                const dG = Math.abs(currentFrame.data[idx + 1] - this.prevFrameData.data[idx + 1]);
                const dB = Math.abs(currentFrame.data[idx + 2] - this.prevFrameData.data[idx + 2]);
                diffSum += (dR + dG + dB);
              }
            }

            if (diffSum > 1400) {
              const note = NATURAL_NOTES[mirroredCol];
              const noteX = ((mirroredCol + 0.5) / numCols) * canvasWidth;
              const noteY = canvasHeight * 0.78;
              currentFrameNotes.add({ note, x: noteX, y: noteY, finger: 'Movimento Óptico' });

              // Desenha indicador de toque no fallback
              ctx.beginPath();
              ctx.fillStyle = '#06b6d4';
              ctx.arc(noteX, noteY, 14, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }

        this.prevFrameData = currentFrame;
        this.synchronizeAirNotes(currentFrameNotes);
      }

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }

  updateFPS() {
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFrameTime >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFrameTime));
      this.frameCount = 0;
      this.lastFrameTime = now;
      if (this.fpsDisplay) this.fpsDisplay.textContent = `${this.fps} FPS`;
    }
  }
}

// --- 5. Inicialização da Interface & Eventos ---
document.addEventListener('DOMContentLoaded', () => {
  // Visualizador sonoro do topo
  const visualizer = new WaveVisualizer('soundCanvas');
  const btnToggleWave = document.getElementById('toggle-wave-type');
  if (btnToggleWave) {
    btnToggleWave.addEventListener('click', () => visualizer.nextMode());
  }

  // Motor de Visão Computacional / Câmera
  const handTracker = new HandTrackingEngine();

  // Controles do Sintetizador
  const piano = document.getElementById('piano');
  const currentNoteDisplay = document.getElementById('current-note-display');
  const currentFreqDisplay = document.getElementById('current-freq-display');
  const volumeSlider = document.getElementById('synth-volume');
  const sustainSlider = document.getElementById('synth-sustain');
  const volVal = document.getElementById('vol-val');
  const sustainVal = document.getElementById('sustain-val');
  const waveButtons = document.querySelectorAll('.wave-btn');
  const fingerDisplay = document.getElementById('finger-status-display');

  if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
      audio.setVolume(e.target.value);
      if (volVal) volVal.textContent = `${Math.round(e.target.value * 100)}%`;
    });
  }

  if (sustainSlider) {
    sustainSlider.addEventListener('input', (e) => {
      audio.setSustain(e.target.value);
      if (sustainVal) sustainVal.textContent = `${e.target.value}s`;
    });
  }

  waveButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      waveButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const waveType = btn.getAttribute('data-wave');
      audio.setWaveform(waveType);
    });
  });

  function updateNoteDisplay(noteName, freq, source = 'Teclado/Mouse') {
    if (currentNoteDisplay) currentNoteDisplay.textContent = noteName || '—';
    if (currentFreqDisplay) currentFreqDisplay.textContent = freq ? `${freq.toFixed(1)} Hz` : '0 Hz';
    if (fingerDisplay) {
      fingerDisplay.innerHTML = `Origem: <span class="badge-source">${source}</span>`;
    }
  }

  // Cliques manuais e toque no piano da tela
  const keys = document.querySelectorAll('.key');
  keys.forEach((key) => {
    const note = key.getAttribute('data-note');

    const startPlay = (e) => {
      e.preventDefault();
      audio.init();
      key.classList.add('active');
      const freq = audio.playNote(note);
      updateNoteDisplay(note, freq, 'Toque na Tela');
    };

    const stopPlay = () => {
      key.classList.remove('active');
      key.classList.remove('camera-triggered');
      audio.stopNote(note);
    };

    key.addEventListener('mousedown', startPlay);
    key.addEventListener('mouseup', stopPlay);
    key.addEventListener('mouseleave', stopPlay);

    key.addEventListener('touchstart', startPlay, { passive: false });
    key.addEventListener('touchend', stopPlay);
  });

  // Teclado físico do computador
  const pressedKeys = new Set();
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const key = e.key.toLowerCase();
    const note = KEY_BINDINGS[key];

    if (note && !pressedKeys.has(key)) {
      pressedKeys.add(key);
      audio.init();

      const keyEl = document.querySelector(`.key[data-note="${note}"]`);
      if (keyEl) keyEl.classList.add('active');

      const freq = audio.playNote(note);
      updateNoteDisplay(note, freq, `Teclado Físico [${key.toUpperCase()}]`);
    }
  });

  window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    const note = KEY_BINDINGS[key];

    if (note && pressedKeys.has(key)) {
      pressedKeys.delete(key);

      const keyEl = document.querySelector(`.key[data-note="${note}"]`);
      if (keyEl) keyEl.classList.remove('active');

      audio.stopNote(note);
      if (pressedKeys.size === 0) {
        updateNoteDisplay('—', 0, 'Aguardando toque');
      }
    }
  });

  // --- Amostras de Harmonias por Gênero ---
  const GENRE_HARMONIES = {
    classica: {
      freqs: [293.66, 369.99, 440.00, 587.33],
      wave: 'triangle',
      duration: 2.0,
      arp: true
    },
    jazz: {
      freqs: [261.63, 329.63, 392.00, 493.88, 587.33],
      wave: 'sine',
      duration: 2.4,
      arp: true
    },
    bossanova: {
      freqs: [369.99, 440.00, 554.37, 659.25],
      wave: 'triangle',
      duration: 1.8,
      arp: true
    },
    rock: {
      freqs: [164.81, 246.94, 329.63],
      wave: 'sawtooth',
      duration: 1.5,
      arp: false
    },
    eletronica: {
      freqs: [220.00, 261.63, 329.63, 440.00, 523.25, 659.25],
      wave: 'square',
      duration: 2.2,
      arp: true
    },
    hiphop: {
      freqs: [65.41, 130.81, 196.00, 233.08],
      wave: 'sine',
      duration: 2.0,
      arp: false
    }
  };

  const genreButtons = document.querySelectorAll('.btn-play-genre');
  genreButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const chordKey = btn.getAttribute('data-chord');
      const harmony = GENRE_HARMONIES[chordKey];
      if (!harmony) return;

      btn.classList.add('playing');
      audio.playChord(harmony.freqs, harmony.wave, harmony.duration, harmony.arp);

      setTimeout(() => {
        btn.classList.remove('playing');
      }, harmony.duration * 1000);
    });
  });

  // Curiosidades Sonoras
  const demoButtons = document.querySelectorAll('.btn-sound-mini');
  demoButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const demoType = btn.getAttribute('data-demo');
      audio.init();

      if (demoType === 'tritone') {
        audio.playChord([261.63, 369.99], 'sawtooth', 1.6);
      } else if (demoType === 'a440') {
        audio.playChord([440.00], 'sine', 1.8);
      } else if (demoType === 'resolution') {
        audio.playChord([196.00, 246.94, 293.66, 349.23], 'triangle', 0.9);
        setTimeout(() => {
          audio.playChord([261.63, 329.63, 392.00, 523.25], 'sine', 1.6);
        }, 900);
      }
    });
  });

  // Navbar ao rolar
  const navbar = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 40) {
      navbar.style.borderBottomColor = 'rgba(255, 255, 255, 0.15)';
      navbar.style.background = 'rgba(9, 10, 16, 0.92)';
    } else {
      navbar.style.borderBottomColor = 'rgba(255, 255, 255, 0.08)';
      navbar.style.background = 'rgba(9, 10, 16, 0.75)';
    }
  });
});
