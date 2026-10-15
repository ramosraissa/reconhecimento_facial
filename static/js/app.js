/**
 * FaceGate v3 — Script Principal (ES Module)
 * Tecnologia: @mediapipe/tasks-vision rodando 100% no navegador
 *
 * Fluxo de detecção:
 *  1. FaceLandmarker carrega de /mediapipe/face_landmarker.task
 *  2. Detecta 468 landmarks (x,y,z) em cada frame
 *  3. Normaliza: centra no nariz (pt 1), escala pela distância ocular (pt 33↔263)
 *  4. Vetor final = 468 × 3 = 1404 números
 *  5. Envia para /api/reconhecer ou /api/cadastrar
 */

import { FaceLandmarker, FilesetResolver } from '/static/js/mediapipe_vision.js';

// ============================================================
// APLICAR TEMA ANTES DE QUALQUER RENDER (evita flash)
// ============================================================
(function () {
  const salvo = localStorage.getItem('fg-theme');
  const prefEscuro = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if ((salvo || (prefEscuro ? 'dark' : 'light')) === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();

// ============================================================
// ESTADO GLOBAL
// ============================================================
const state = {
  abaAtiva:            'acesso',
  limiar:              0.35,
  dimensoes:           1404,
  modelo:              'MediaPipe FaceLandmarker',
  landmarker:          null,       // FaceLandmarker instance
  modelosCarregados:   false,
  cameraStream:        null,       // stream singleton
  cameraFalhou:        false,
  scannerAtivo:        true,
  scannerTimer:        null,
  requisicaoAndamento: false,
  intervaloScanMs:     800,
  amostrasCapturadas:  [],         // [{thumb, vetor}]
};

// ============================================================
// ELEMENTOS DOM
// ============================================================
const DOM = {
  navItems:               document.querySelectorAll('.nav-item'),
  tabViews:               document.querySelectorAll('.tab-view'),
  badgeTotalUsuarios:     document.getElementById('badgeTotalUsuarios'),
  sbLimiarVal:            document.getElementById('sbLimiarVal'),
  sbDimVal:               document.getElementById('sbDimVal'),
  aiStatusText:           document.getElementById('aiStatusText'),
  btnThemeToggle:         document.getElementById('btnThemeToggle'),
  iconMoon:               document.getElementById('iconMoon'),
  iconSun:                document.getElementById('iconSun'),
  btnThemeLabel:          document.querySelector('.btn-theme-label'),

  cameraAlert:            document.getElementById('cameraAlert'),
  cameraAlertMsg:         document.getElementById('cameraAlertMsg'),
  modelLoadingBanner:     document.getElementById('modelLoadingBanner'),
  modelLoadingMsg:        document.getElementById('modelLoadingMsg'),

  // Acesso
  videoAcesso:            document.getElementById('videoAcesso'),
  overlayAcesso:          document.getElementById('overlayAcesso'),
  btnPausarScanner:       document.getElementById('btnPausarScanner'),
  lblPausa:               document.getElementById('lblPausa'),
  scannerLaser:           document.getElementById('scannerLaser'),
  liveStatusText:         document.getElementById('liveStatusText'),
  inputFotoAcesso:        document.getElementById('inputFotoAcesso'),
  fotoAcessoPreviewBox:   document.getElementById('fotoAcessoPreviewBox'),
  fotoAcessoPreviewImg:   document.getElementById('fotoAcessoPreviewImg'),
  fotoAcessoStatus:       document.getElementById('fotoAcessoStatus'),
  btnFecharFotoAcesso:    document.getElementById('btnFecharFotoAcesso'),

  cardResultado:          document.getElementById('cardResultado'),
  resultadoTimestamp:     document.getElementById('resultadoTimestamp'),
  resIconWrapper:         document.getElementById('resIconWrapper'),
  resBadge:               document.getElementById('resBadge'),
  resNome:                document.getElementById('resNome'),
  resMotivo:              document.getElementById('resMotivo'),
  txtDistanciaValor:      document.getElementById('txtDistanciaValor'),
  barDistanciaFill:       document.getElementById('barDistanciaFill'),
  thresholdMarker:        document.getElementById('thresholdMarker'),
  markerFlagTxt:          document.getElementById('markerFlagTxt'),
  labelLimiarBar:         document.getElementById('labelLimiarBar'),
  canvasEmbeddingSpectrum: document.getElementById('canvasEmbeddingSpectrum'),
  embRawBox:              document.getElementById('embRawBox'),
  embStatusTxt:           document.getElementById('embStatusTxt'),

  // Cadastro
  cadNomeInput:           document.getElementById('cadNomeInput'),
  videoCadastro:          document.getElementById('videoCadastro'),
  btnCapturarAmostra:     document.getElementById('btnCapturarAmostra'),
  btnLimparAmostras:      document.getElementById('btnLimparAmostras'),
  btnSalvarCadastroFinal: document.getElementById('btnSalvarCadastroFinal'),
  cadFeedbackMsg:         document.getElementById('cadFeedbackMsg'),
  slotsCount:             document.getElementById('slotsCount'),
  slotsHelpText:          document.getElementById('slotsHelpText'),
  jsonPreviewContent:     document.getElementById('jsonPreviewContent'),
  btnRecarregarJson:      document.getElementById('btnRecarregarJson'),
  inputFotosCadastro:     document.getElementById('inputFotosCadastro'),

  // Usuários
  usuariosGrid:           document.getElementById('usuariosGrid'),
  usuariosLoading:        document.getElementById('usuariosLoading'),
  usuariosVazio:          document.getElementById('usuariosVazio'),
  btnNovoCadastroRapido:  document.getElementById('btnNovoCadastroRapido'),

  // Registros
  registrosTableBody:     document.getElementById('registrosTableBody'),
  registrosVazio:         document.getElementById('registrosVazio'),
  btnAtualizarRegistros:  document.getElementById('btnAtualizarRegistros'),

  // Calibração
  calibUsuarioSelect:     document.getElementById('calibUsuarioSelect'),
  btnCalcularCalibracao:  document.getElementById('btnCalcularCalibracao'),
  calibFeedback:          document.getElementById('calibFeedback'),
  calibResultado:         document.getElementById('calibResultado'),
  calibIntraMin:          document.getElementById('calibIntraMin'),
  calibIntraMax:          document.getElementById('calibIntraMax'),
  calibIntraMedia:        document.getElementById('calibIntraMedia'),
  calibIntraDistancias:   document.getElementById('calibIntraDistancias'),
  calibInterMin:          document.getElementById('calibInterMin'),
  calibInterMax:          document.getElementById('calibInterMax'),
  calibInterMedia:        document.getElementById('calibInterMedia'),
  calibInterDetalhes:     document.getElementById('calibInterDetalhes'),
  calibSugestao:          document.getElementById('calibSugestao'),
  calibDica:              document.getElementById('calibDica'),
  calibLimiarAtual:       document.getElementById('calibLimiarAtual'),
};

// Canvas oculto para captura de thumbs e processamento de fotos
const thumbCanvas  = document.createElement('canvas');
const thumbCtx     = thumbCanvas.getContext('2d');

// ============================================================
// LANDMARKS DE REFERÊNCIA
//   1   = ponta do nariz (centro)
//   33  = canto externo do olho esquerdo
//   263 = canto externo do olho direito
// ============================================================
const IDX_NARIZ    = 1;
const IDX_OLH_ESQ  = 33;
const IDX_OLH_DIR  = 263;

// ============================================================
// VETOR DE GEOMETRIA FACIAL — 468 pontos × (x,y,z) = 1404 nums
// ============================================================
function extrairVetor(landmarks) {
  const nariz = landmarks[IDX_NARIZ];
  const olhE  = landmarks[IDX_OLH_ESQ];
  const olhD  = landmarks[IDX_OLH_DIR];

  // Escala = distância euclidiana entre os cantos externos dos olhos
  const dx    = olhD.x - olhE.x;
  const dy    = olhD.y - olhE.y;
  const dz    = olhD.z - olhE.z;
  const escala = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

  const vetor = [];
  for (const pt of landmarks) {
    vetor.push(
      (pt.x - nariz.x) / escala,
      (pt.y - nariz.y) / escala,
      (pt.z - nariz.z) / escala,
    );
  }
  return vetor; // 1404 números
}

// ============================================================
// CARREGAR MEDIAPIPE FACE LANDMARKER
// ============================================================
async function carregarMediaPipe() {
  const bannerEl  = DOM.modelLoadingBanner;
  const msgEl     = DOM.modelLoadingMsg;
  const statusEl  = DOM.aiStatusText;

  if (msgEl) msgEl.textContent = '⏳ Iniciando MediaPipe Face Landmarker...';

  try {
    console.log('[MediaPipe] Carregando FilesetResolver de /mediapipe/wasm...');

    const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');

    console.log('[MediaPipe] Criando FaceLandmarker...');

    state.landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:  '/mediapipe/face_landmarker.task',
        delegate:        'GPU'
      },
      outputFaceBlendshapes:    false,
      outputFacialTransformationMatrixes: false,
      runningMode:              'IMAGE',
      numFaces:                 1,
    });

    state.modelosCarregados = true;
    console.log('[MediaPipe] ✓ FaceLandmarker pronto!');

    if (msgEl)    msgEl.textContent    = '✓ MediaPipe Face Landmarker carregado!';
    if (statusEl) statusEl.textContent = 'MediaPipe Ativo';

    setTimeout(() => { if (bannerEl) bannerEl.classList.add('hidden'); }, 2000);

  } catch (err) {
    console.error('[MediaPipe] Erro ao carregar:', err);
    if (msgEl)    msgEl.textContent    = `❌ Falha ao carregar MediaPipe: ${err.message}`;
    if (statusEl) statusEl.textContent = 'Erro no modelo';
    // Não bloqueia o site — foto e câmera tentarão de novo quando disponível
  }
}

// ============================================================
// DETECTAR ROSTO EM ImageData / HTMLImageElement / HTMLVideoElement
// Retorna: { landmarks, vetor } ou null
// ============================================================
function detectarLandmarks(fonte) {
  if (!state.landmarker || !state.modelosCarregados) return null;
  try {
    const result = state.landmarker.detect(fonte);
    if (!result || !result.faceLandmarks || result.faceLandmarks.length !== 1) return null;
    const landmarks = result.faceLandmarks[0];
    if (!landmarks || landmarks.length !== 468) return null;
    return { landmarks, vetor: extrairVetor(landmarks) };
  } catch (e) {
    console.warn('[detect] Erro:', e.message);
    return null;
  }
}

// ============================================================
// CÂMERA — SINGLETON ROBUSTO
// ============================================================
function pararStream(stream) {
  if (stream) {
    stream.getTracks().forEach(t => {
      t.stop();
      console.log(`[câmera] Track parado: "${t.label}"`);
    });
  }
}

async function obterStreamCamera() {
  // Singleton: reutiliza se ativo
  if (state.cameraStream && state.cameraStream.active) {
    console.log('[câmera] Reutilizando stream ativo.');
    return state.cameraStream;
  }
  // Para o anterior inativo
  if (state.cameraStream) {
    pararStream(state.cameraStream);
    state.cameraStream = null;
    await new Promise(r => setTimeout(r, 300));
  }
  // Não tenta de novo se já falhou nesta sessão
  if (state.cameraFalhou) return null;

  try {
    const dispositivos = await navigator.mediaDevices.enumerateDevices();
    const cameras = dispositivos.filter(d => d.kind === 'videoinput');
    console.log(`[câmera] ${cameras.length} câmera(s): ${cameras.map(c => c.label || '(sem nome)').join(', ')}`);
    if (cameras.length === 0) {
      mostrarAlertaCamera('📷 Nenhuma câmera detectada. Use "Testar com foto".');
      state.cameraFalhou = true;
      return null;
    }
  } catch (e) {
    console.warn('[câmera] enumerateDevices falhou:', e.message);
  }

  try {
    console.log('[câmera] getUserMedia({ video: true })...');
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    const track  = stream.getVideoTracks()[0];
    if (track) {
      const s = track.getSettings();
      console.log(`[câmera] ✓ "${track.label}" — ${s.width}×${s.height}`);
    }
    state.cameraStream  = stream;
    state.cameraFalhou  = false;
    return stream;
  } catch (err) {
    console.error(`[câmera] ✗ ${err.name}: ${err.message}`);
    state.cameraFalhou = true;
    let msg;
    if (err.name === 'NotAllowedError')   msg = '⛔ Permissão negada. Permita a câmera nas configurações do navegador.';
    else if (err.name === 'NotReadableError') msg = '🔴 Câmera em uso por outro app (Teams, Zoom...). Feche-os e use "Testar com foto".';
    else if (err.name === 'NotFoundError')    msg = '📷 Câmera não encontrada. Use o botão "Testar com foto".';
    else msg = `❌ Câmera indisponível (${err.name}). Use "Testar com foto".`;
    mostrarAlertaCamera(msg);
    return null;
  }
}

async function conectarStreamAoVideo(videoEl, stream) {
  if (!videoEl || !stream) return false;
  videoEl.autoplay    = true;
  videoEl.muted       = true;
  videoEl.playsInline = true;
  videoEl.srcObject   = stream;
  try {
    await videoEl.play();
    console.log(`[câmera] ✓ play() OK — ${videoEl.id}`);
    return true;
  } catch (e) {
    console.error(`[câmera] play() falhou: ${e.message}`);
    return false;
  }
}

function mostrarAlertaCamera(msg) {
  if (DOM.cameraAlert && DOM.cameraAlertMsg) {
    DOM.cameraAlertMsg.textContent = msg;
    DOM.cameraAlert.classList.remove('hidden');
  }
}

// ============================================================
// CÂMERA PARA TELA ACESSO
// ============================================================
async function iniciarCameraAcesso() {
  const stream = await obterStreamCamera();
  if (!stream) return;
  await conectarStreamAoVideo(DOM.videoAcesso, stream);
  ajustarTamanhoOverlay();
  window.addEventListener('resize', ajustarTamanhoOverlay);
}

// ============================================================
// CÂMERA PARA TELA CADASTRO
// ============================================================
async function iniciarCameraCadastro() {
  const stream = await obterStreamCamera();
  if (!stream) return;
  await conectarStreamAoVideo(DOM.videoCadastro, stream);
}

// ============================================================
// LOOP DE RECONHECIMENTO (~800ms)
// ============================================================
function iniciarLoopScanner() {
  if (!state.scannerAtivo || state.abaAtiva !== 'acesso') return;
  if (state.scannerTimer) clearTimeout(state.scannerTimer);

  const ciclo = async () => {
    if (!state.scannerAtivo || state.abaAtiva !== 'acesso') return;

    const v = DOM.videoAcesso;
    if (!state.requisicaoAndamento && v && v.readyState >= 2 && v.videoWidth > 0) {
      state.requisicaoAndamento = true;
      try { await executarCicloReconhecimento(); }
      catch (e) { console.error('[scanner]', e); }
      finally   { state.requisicaoAndamento = false; }
    }

    state.scannerTimer = setTimeout(ciclo, state.intervaloScanMs);
  };

  state.scannerTimer = setTimeout(ciclo, 300);
}

function pararLoopScanner() {
  if (state.scannerTimer) { clearTimeout(state.scannerTimer); state.scannerTimer = null; }
  state.requisicaoAndamento = false;
}

async function executarCicloReconhecimento() {
  if (!state.modelosCarregados) {
    aplicarEstadoResultado('amber', 'CARREGANDO IA', 'Aguarde o MediaPipe', 'Geralmente leva 5–15 segundos');
    return;
  }
  const v = DOM.videoAcesso;
  if (!v || v.readyState < 2 || v.videoWidth === 0) return;

  const deteccao = detectarLandmarks(v);

  if (!deteccao) {
    limparOverlayAcesso();
    aplicarEstadoResultado('neutral', 'AGUARDANDO ROSTO', 'Nenhuma pessoa identificada', 'Use câmera ou envie uma foto');
    atualizarCardDistancia(null, false);
    atualizarCardEmbedding(null);
    return;
  }

  desenharBoxNoOverlay(deteccao.landmarks, '...', null, null);

  try {
    const resp = await fetch('/api/reconhecer', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ vetor: deteccao.vetor }),
    });
    const res = await resp.json();
    processarResultadoAcesso(res, deteccao.landmarks, deteccao.vetor);
  } catch (err) {
    console.warn('[reconhecer] Falha na requisição:', err.message);
  }
}

// ============================================================
// PROCESSAR RESULTADO DE RECONHECIMENTO
// ============================================================
function processarResultadoAcesso(data, landmarks, vetor) {
  const agora = new Date().toLocaleTimeString('pt-BR');
  if (DOM.resultadoTimestamp) DOM.resultadoTimestamp.textContent = agora;

  if (!data || !data.sucesso) {
    aplicarEstadoResultado('neutral', 'AGUARDANDO ROSTO', 'Nenhuma pessoa identificada', 'Use câmera ou envie uma foto');
    atualizarCardDistancia(null, false);
    atualizarCardEmbedding(null);
    return;
  }

  if (landmarks) {
    desenharBoxNoOverlay(
      landmarks,
      data.liberado ? (data.nome || 'Autorizado') : 'Desconhecido',
      data.distancia,
      data.liberado
    );
  }

  if (data.liberado) {
    aplicarEstadoResultado(
      'liberado',
      'ACESSO LIBERADO',
      data.nome || 'Autorizado',
      `Reconhecido · distância ${(data.distancia || 0).toFixed(4)}`
    );
  } else {
    const motivo = data.mensagem ||
      (data.distancia !== null
        ? `Distância ${(data.distancia || 0).toFixed(4)} ≥ limiar ${state.limiar.toFixed(2)}`
        : 'Rosto não cadastrado');
    aplicarEstadoResultado('negado', 'ACESSO NEGADO', 'Pessoa não cadastrada', motivo);
  }

  atualizarCardDistancia(data.distancia, data.liberado);
  if (vetor) atualizarCardEmbedding(vetor);
}

// ============================================================
// CARDS DE RESULTADO
// ============================================================
function aplicarEstadoResultado(estado, badge, nome, motivo) {
  DOM.cardResultado.classList.remove('state-liberado', 'state-negado', 'state-amber');
  DOM.resBadge.textContent  = badge;
  DOM.resNome.textContent   = nome;
  DOM.resMotivo.textContent = motivo;

  const icones = {
    liberado: `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    negado:   `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
    amber:    `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
    neutral:  `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
  };

  if (['liberado','negado','amber'].includes(estado)) {
    DOM.cardResultado.classList.add(`state-${estado}`);
  }
  DOM.resIconWrapper.innerHTML = icones[estado] || icones.neutral;
}

function atualizarCardDistancia(distancia, liberado) {
  if (distancia === null || distancia === undefined) {
    DOM.txtDistanciaValor.textContent = '--';
    DOM.barDistanciaFill.style.width  = '0%';
    DOM.barDistanciaFill.className    = 'distance-fill';
    return;
  }
  DOM.txtDistanciaValor.textContent = distancia.toFixed(4);
  // Normaliza pela escala 0–1 (GeomFace distances são menores que face-api, tipicamente 0–1)
  const pct = Math.min(Math.max((distancia / 1.0) * 100, 3), 100);
  DOM.barDistanciaFill.style.width = `${pct}%`;
  DOM.barDistanciaFill.className   = 'distance-fill ' + (liberado ? 'fill-green' : 'fill-red');
}

function atualizarCardEmbedding(vetor) {
  if (!vetor || !Array.isArray(vetor) || vetor.length === 0) {
    if (DOM.embStatusTxt) DOM.embStatusTxt.textContent = 'Aguardando vetor';
    if (DOM.embRawBox)    DOM.embRawBox.textContent    = '[aguardando geometria facial...]';
    desenharEspectroVazio();
    return;
  }
  if (DOM.embStatusTxt) DOM.embStatusTxt.textContent = `${vetor.length} dimensões (468 pontos × x,y,z)`;
  const preview = `[${vetor.slice(0, 8).map(n => n.toFixed(4)).join(', ')}, ... (${vetor.length - 8} ocultos)]`;
  if (DOM.embRawBox) DOM.embRawBox.textContent = preview;
  desenharEspectroEmbedding(vetor);
}

function desenharEspectroEmbedding(vetor) {
  const canvas = DOM.canvasEmbeddingSpectrum;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const barW   = w / vetor.length;
  const cy     = h / 2;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const corPos = isDark ? '#5CE6B0' : '#4ED8A5';
  const corNeg = isDark ? '#FF7A96' : '#FF6B8A';
  vetor.forEach((val, i) => {
    const barH = Math.min(Math.abs(val) * 80, cy - 2);
    ctx.fillStyle = val >= 0 ? corPos : corNeg;
    if (val >= 0) ctx.fillRect(i * barW, cy - barH, Math.max(barW - 0.5, 0.5), barH);
    else          ctx.fillRect(i * barW, cy,         Math.max(barW - 0.5, 0.5), barH);
  });
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(74,43,69,0.15)';
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
}

function desenharEspectroVazio() {
  const canvas = DOM.canvasEmbeddingSpectrum;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255,111,174,0.18)';
  ctx.beginPath();
  ctx.moveTo(0, canvas.height / 2);
  ctx.lineTo(canvas.width, canvas.height / 2);
  ctx.stroke();
}

// ============================================================
// CANVAS OVERLAY (box sobre o rosto ao vivo)
// ============================================================
function ajustarTamanhoOverlay() {
  if (!DOM.videoAcesso || !DOM.overlayAcesso) return;
  const rect = DOM.videoAcesso.getBoundingClientRect();
  DOM.overlayAcesso.width  = rect.width;
  DOM.overlayAcesso.height = rect.height;
}

function limparOverlayAcesso() {
  if (!DOM.overlayAcesso) return;
  const ctx = DOM.overlayAcesso.getContext('2d');
  ctx.clearRect(0, 0, DOM.overlayAcesso.width, DOM.overlayAcesso.height);
}

function desenharBoxNoOverlay(landmarks, nome, distancia, liberado) {
  if (!DOM.overlayAcesso || !landmarks) return;
  const ctx = DOM.overlayAcesso.getContext('2d');
  const cw  = DOM.overlayAcesso.width;
  const ch  = DOM.overlayAcesso.height;
  ctx.clearRect(0, 0, cw, ch);

  // Box a partir dos landmarks (coordenadas normalizadas 0–1)
  const xs = landmarks.map(p => p.x);
  const ys = landmarks.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  const x = minX * cw;
  const y = minY * ch;
  const w = (maxX - minX) * cw;
  const h = (maxY - minY) * ch;

  const isDark   = document.documentElement.getAttribute('data-theme') === 'dark';
  const corVerde = isDark ? '#5CE6B0' : '#4ED8A5';
  const corCoral = isDark ? '#FF7A96' : '#FF6B8A';
  const corRosa  = '#FF6FAE';
  const corBox   = liberado === null ? corRosa : (liberado ? corVerde : corCoral);

  ctx.strokeStyle = corBox; ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);

  // Cantos decorativos
  const cl = Math.min(w, h) * 0.22;
  ctx.lineWidth = 3.5;
  [
    [[x, y + cl], [x, y], [x + cl, y]],
    [[x + w - cl, y], [x + w, y], [x + w, y + cl]],
    [[x, y + h - cl], [x, y + h], [x + cl, y + h]],
    [[x + w - cl, y + h], [x + w, y + h], [x + w, y + h - cl]],
  ].forEach(pts => {
    ctx.beginPath(); ctx.moveTo(...pts[0]); ctx.lineTo(...pts[1]); ctx.lineTo(...pts[2]); ctx.stroke();
  });

  // Etiqueta
  const distStr    = distancia !== null && distancia !== undefined ? distancia.toFixed(4) : '...';
  const nomeLimpo  = (nome && nome !== 'desconhecido') ? nome.toUpperCase() : 'DESCONHECIDO';
  const labelTexto = `${nomeLimpo} · ${distStr}`;

  ctx.font = '600 13px "DM Mono", monospace';
  const tw   = ctx.measureText(labelTexto).width;
  const padX = 10, tagH = 26, tagW = tw + padX * 2;
  const tagX = x + (w - tagW) / 2;
  const tagY = y > 36 ? y - tagH - 6 : y + h + 6;

  ctx.fillStyle = isDark ? 'rgba(27,19,37,0.92)' : 'rgba(255,245,249,0.92)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(tagX, tagY, tagW, tagH, 7);
  else ctx.rect(tagX, tagY, tagW, tagH);
  ctx.fill();

  ctx.strokeStyle = corBox; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = corBox; ctx.textBaseline = 'middle';
  ctx.fillText(labelTexto, tagX + padX, tagY + tagH / 2);
}

// ============================================================
// FOTO → vetor geométrico (acesso e cadastro)
// ============================================================
function carregarImagem(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload  = () => { resolve(img); URL.revokeObjectURL(url); };
    img.onerror = () => { reject(new Error('Falha ao carregar imagem.')); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

function imagemParaCanvas(img) {
  thumbCanvas.width  = img.naturalWidth  || img.width;
  thumbCanvas.height = img.naturalHeight || img.height;
  thumbCtx.drawImage(img, 0, 0);
  return thumbCanvas;
}

async function processarFotoParaVetor(file) {
  const img       = await carregarImagem(file);
  const canvas    = imagemParaCanvas(img);
  const deteccao  = detectarLandmarks(canvas);
  if (!deteccao) return { ok: false, erro: 'Nenhum rosto detectado (ou mais de 1).' };
  const thumb = thumbCanvas.toDataURL('image/jpeg', 0.80);
  return { ok: true, vetor: deteccao.vetor, thumb };
}

// ============================================================
// TESTAR COM FOTO (tela Acesso)
// ============================================================
function configurarFotoAcesso() {
  if (!DOM.inputFotoAcesso) return;

  DOM.inputFotoAcesso.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = ''; // reset para permitir re-upload do mesmo arquivo

    if (!state.modelosCarregados) {
      alert('⏳ MediaPipe ainda carregando. Aguarde e tente novamente.');
      return;
    }

    // Mostra preview
    const objectUrl = URL.createObjectURL(file);
    DOM.fotoAcessoPreviewImg.src = objectUrl;
    DOM.fotoAcessoPreviewBox.style.display = 'block';
    DOM.fotoAcessoStatus.textContent = '🔍 Detectando geometria facial...';

    try {
      const resultado = await processarFotoParaVetor(file);
      URL.revokeObjectURL(objectUrl);

      if (!resultado.ok) {
        DOM.fotoAcessoStatus.textContent = `⚠️ ${resultado.erro}`;
        aplicarEstadoResultado('neutral', 'AGUARDANDO ROSTO', 'Nenhum rosto na foto', resultado.erro);
        return;
      }

      DOM.fotoAcessoStatus.textContent = '📡 Enviando ao servidor...';

      const resp = await fetch('/api/reconhecer', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ vetor: resultado.vetor }),
      });
      const res = await resp.json();

      const agoraStr = new Date().toLocaleTimeString('pt-BR');
      if (DOM.resultadoTimestamp) DOM.resultadoTimestamp.textContent = agoraStr;

      if (res.liberado) {
        DOM.fotoAcessoStatus.textContent = `✅ ACESSO LIBERADO — ${res.nome} (dist: ${(res.distancia||0).toFixed(4)})`;
        aplicarEstadoResultado('liberado', 'ACESSO LIBERADO', res.nome || 'Autorizado', `Dist: ${(res.distancia||0).toFixed(4)}`);
      } else {
        const motivo = res.mensagem || `Dist: ${(res.distancia||0).toFixed(4)} ≥ limiar`;
        DOM.fotoAcessoStatus.textContent = `❌ ACESSO NEGADO — ${motivo}`;
        aplicarEstadoResultado('negado', 'ACESSO NEGADO', 'Pessoa não cadastrada', motivo);
      }

      atualizarCardDistancia(res.distancia, res.liberado);
      atualizarCardEmbedding(resultado.vetor);

    } catch (err) {
      DOM.fotoAcessoStatus.textContent = `❌ Erro: ${err.message}`;
      console.error('[fotoAcesso]', err);
    }
  });

  if (DOM.btnFecharFotoAcesso) {
    DOM.btnFecharFotoAcesso.addEventListener('click', () => {
      DOM.fotoAcessoPreviewBox.style.display = 'none';
      DOM.fotoAcessoPreviewImg.src = '';
    });
  }
}

// ============================================================
// CADASTRAR COM FOTOS (tela Cadastro)
// ============================================================
function configurarFotosCadastro() {
  if (!DOM.inputFotosCadastro) return;

  DOM.inputFotosCadastro.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files).slice(0, 5);
    e.target.value = '';

    if (!files.length) return;

    if (!state.modelosCarregados) {
      mostrarFeedbackCadastro('⏳ MediaPipe ainda carregando. Aguarde e tente novamente.', 'error');
      return;
    }

    const nome = DOM.cadNomeInput.value.trim();
    if (!nome) {
      mostrarFeedbackCadastro('Informe o nome antes de enviar as fotos.', 'error');
      DOM.cadNomeInput.focus();
      return;
    }

    // Limpa amostras anteriores
    limparAmostrasCadastro();
    mostrarFeedbackCadastro(`Processando ${files.length} foto(s)...`, '');

    let processadas = 0;
    for (let i = 0; i < files.length; i++) {
      mostrarFeedbackCadastro(`Processando foto ${i + 1}/${files.length}...`, '');
      try {
        const resultado = await processarFotoParaVetor(files[i]);
        if (!resultado.ok) {
          mostrarFeedbackCadastro(`⚠️ Foto ${i + 1}: ${resultado.erro}`, 'error');
          continue;
        }
        const idx = state.amostrasCapturadas.length;
        if (idx >= 5) break;
        state.amostrasCapturadas.push({ thumb: resultado.thumb, vetor: resultado.vetor });
        preencherSlotVisual(idx, resultado.thumb);
        atualizarContadorSlots();
        processadas++;
      } catch (err) {
        mostrarFeedbackCadastro(`❌ Foto ${i + 1}: ${err.message}`, 'error');
      }
    }

    if (processadas === 0) {
      mostrarFeedbackCadastro('Nenhuma foto válida (sem rosto detectado). Tente outras fotos.', 'error');
      return;
    }

    if (state.amostrasCapturadas.length >= 1) {
      DOM.btnSalvarCadastroFinal.disabled = false;
      mostrarFeedbackCadastro(
        `✓ ${processadas} foto(s) processada(s). Clique em "Salvar Cadastro".`,
        'success'
      );
    }
  });
}

// ============================================================
// TELA CADASTRO — CÂMERA
// ============================================================
function configurarEventosCadastro() {
  if (DOM.btnCapturarAmostra)     DOM.btnCapturarAmostra.addEventListener('click', executarCapturaAmostra);
  if (DOM.btnLimparAmostras)      DOM.btnLimparAmostras.addEventListener('click', limparAmostrasCadastro);
  if (DOM.btnSalvarCadastroFinal) DOM.btnSalvarCadastroFinal.addEventListener('click', finalizarCadastro);
  if (DOM.btnRecarregarJson)      DOM.btnRecarregarJson.addEventListener('click', carregarPreviewJson);

  window.addEventListener('keydown', (e) => {
    if (state.abaAtiva === 'cadastro' &&
        e.code === 'Space' &&
        document.activeElement !== DOM.cadNomeInput) {
      e.preventDefault();
      executarCapturaAmostra();
    }
  });

  configurarFotosCadastro();
}

async function executarCapturaAmostra() {
  const nome = DOM.cadNomeInput.value.trim();
  if (!nome) { mostrarFeedbackCadastro('Informe o nome antes de capturar.', 'error'); DOM.cadNomeInput.focus(); return; }
  if (state.amostrasCapturadas.length >= 5) { mostrarFeedbackCadastro('5 amostras capturadas! Clique em "Salvar Cadastro".', 'success'); return; }
  if (!state.modelosCarregados) { mostrarFeedbackCadastro('⏳ MediaPipe ainda carregando.', 'error'); return; }

  DOM.btnCapturarAmostra.disabled = true;
  mostrarFeedbackCadastro('Detectando rosto...', '');

  try {
    const v = DOM.videoCadastro;
    if (!v || v.readyState < 2 || v.videoWidth === 0) {
      mostrarFeedbackCadastro('Câmera não disponível. Use "Cadastrar com fotos".', 'error');
      return;
    }

    const deteccao = detectarLandmarks(v);
    if (!deteccao) { mostrarFeedbackCadastro('Nenhum rosto detectado. Posicione o rosto na guia oval.', 'error'); return; }

    // thumb a partir do vídeo
    thumbCanvas.width  = v.videoWidth;
    thumbCanvas.height = v.videoHeight;
    thumbCtx.drawImage(v, 0, 0);
    const thumb = thumbCanvas.toDataURL('image/jpeg', 0.85);

    const idx = state.amostrasCapturadas.length;
    state.amostrasCapturadas.push({ thumb, vetor: deteccao.vetor });
    preencherSlotVisual(idx, thumb);
    atualizarContadorSlots();
    mostrarFeedbackCadastro(`✓ Amostra ${idx + 1}/5 capturada!`, 'success');

    if (state.amostrasCapturadas.length >= 5) {
      DOM.btnSalvarCadastroFinal.disabled = false;
      mostrarFeedbackCadastro('✓ Todas as 5 amostras prontas! Clique em "Salvar Cadastro".', 'success');
    }
  } catch (err) {
    console.error('[cadastro]', err);
    mostrarFeedbackCadastro(`Erro: ${err.message}`, 'error');
  } finally {
    DOM.btnCapturarAmostra.disabled = false;
  }
}

async function finalizarCadastro() {
  const nome = DOM.cadNomeInput.value.trim();
  if (!nome) { mostrarFeedbackCadastro('Informe o nome.', 'error'); return; }
  if (state.amostrasCapturadas.length < 1) { mostrarFeedbackCadastro('Capture ou envie pelo menos 1 amostra.', 'error'); return; }

  DOM.btnSalvarCadastroFinal.disabled = true;
  mostrarFeedbackCadastro('Salvando no servidor...', '');

  try {
    const vetores = state.amostrasCapturadas.map(a => a.vetor);
    const resp = await fetch('/api/cadastrar', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ nome, vetores }),
    });
    const res = await resp.json();

    if (!res.sucesso) {
      mostrarFeedbackCadastro(res.erro || 'Falha ao salvar.', 'error');
      DOM.btnSalvarCadastroFinal.disabled = false;
      return;
    }

    mostrarFeedbackCadastro(`✓ "${nome}" cadastrado!`, 'success');
    DOM.cadNomeInput.value = '';
    limparAmostrasCadastro();
    carregarPreviewJson();
    atualizarBadgeUsuarios();
    setTimeout(() => navegarPara('usuarios'), 1500);

  } catch (err) {
    console.error('[finalizarCadastro]', err);
    mostrarFeedbackCadastro(`Erro de conexão: ${err.message}`, 'error');
    DOM.btnSalvarCadastroFinal.disabled = false;
  }
}

function preencherSlotVisual(index, imgSrc) {
  const slotEl = document.getElementById(`slot-${index}`);
  if (!slotEl) return;
  const imgEl = slotEl.querySelector('.slot-thumb');
  if (imgEl) imgEl.src = imgSrc;
  slotEl.classList.add('filled');
}

function atualizarContadorSlots() {
  const total = state.amostrasCapturadas.length;
  if (DOM.slotsCount) DOM.slotsCount.textContent = total;
  if (DOM.slotsHelpText) {
    if (total >= 5) { DOM.slotsHelpText.textContent = 'Máximo de 5 amostras capturadas!'; DOM.slotsHelpText.style.color = 'var(--color-green)'; }
    else { DOM.slotsHelpText.textContent = `${total} amostra(s) — máx 5`; DOM.slotsHelpText.style.color = ''; }
  }
}

function limparAmostrasCadastro() {
  state.amostrasCapturadas = [];
  for (let i = 0; i < 5; i++) {
    const slot = document.getElementById(`slot-${i}`);
    if (slot) { slot.classList.remove('filled'); const img = slot.querySelector('.slot-thumb'); if (img) img.src = ''; }
  }
  atualizarContadorSlots();
  if (DOM.btnSalvarCadastroFinal) DOM.btnSalvarCadastroFinal.disabled = true;
  mostrarFeedbackCadastro('Amostras limpas. Reinicie a captura.', '');
}

function mostrarFeedbackCadastro(msg, tipo = '') {
  if (!DOM.cadFeedbackMsg) return;
  DOM.cadFeedbackMsg.textContent = msg;
  DOM.cadFeedbackMsg.className   = 'cad-feedback-box';
  if (tipo) DOM.cadFeedbackMsg.classList.add(tipo);
}

async function carregarPreviewJson() {
  if (!DOM.jsonPreviewContent) return;
  try {
    const res = await fetch('/api/rostos-raw');
    if (res.ok) {
      const dados = await res.json();
      // Omite os vetores longos para legibilidade
      const resumo = {};
      for (const [nome, dados2] of Object.entries(dados)) {
        resumo[nome] = { amostras: (dados2.vetores || []).length, dimensoes: 1404 };
      }
      DOM.jsonPreviewContent.textContent = JSON.stringify(resumo, null, 2);
    }
  } catch (e) { DOM.jsonPreviewContent.textContent = `Erro: ${e.message}`; }
}

// ============================================================
// TELA USUÁRIOS
// ============================================================
function configurarEventosUsuarios() {
  if (DOM.btnNovoCadastroRapido) DOM.btnNovoCadastroRapido.addEventListener('click', () => navegarPara('cadastro'));
}

async function atualizarBadgeUsuarios() {
  try {
    const res = await fetch('/api/usuarios');
    if (res.ok) { const d = await res.json(); if (DOM.badgeTotalUsuarios) DOM.badgeTotalUsuarios.textContent = d.total || 0; }
  } catch {}
}

async function carregarUsuarios() {
  if (DOM.usuariosLoading) DOM.usuariosLoading.classList.remove('hidden');
  if (DOM.usuariosVazio)   DOM.usuariosVazio.classList.add('hidden');
  if (DOM.usuariosGrid)    DOM.usuariosGrid.classList.add('hidden');

  try {
    const res   = await fetch('/api/usuarios');
    const dados = await res.json();
    if (DOM.usuariosLoading) DOM.usuariosLoading.classList.add('hidden');

    if (!dados.usuarios || dados.usuarios.length === 0) {
      if (DOM.usuariosVazio) DOM.usuariosVazio.classList.remove('hidden');
      if (DOM.badgeTotalUsuarios) DOM.badgeTotalUsuarios.textContent = '0';
      return;
    }
    if (DOM.badgeTotalUsuarios) DOM.badgeTotalUsuarios.textContent = dados.usuarios.length;
    renderizarListaUsuarios(dados.usuarios);
  } catch (err) {
    console.error('[usuários]', err);
    if (DOM.usuariosLoading) DOM.usuariosLoading.classList.add('hidden');
    if (DOM.usuariosVazio)   DOM.usuariosVazio.classList.remove('hidden');
  }
}

function renderizarListaUsuarios(lista) {
  if (!DOM.usuariosGrid) return;
  DOM.usuariosGrid.innerHTML = '';
  DOM.usuariosGrid.classList.remove('hidden');

  lista.forEach(user => {
    const card = document.createElement('div');
    card.className = 'user-card-item';
    card.innerHTML = `
      <div class="user-info-side">
        <div class="user-avatar">${user.nome.charAt(0).toUpperCase()}</div>
        <div class="user-details">
          <span class="user-name" title="${user.nome}">${user.nome}</span>
          <span class="user-samples-badge">${user.amostras} amostra(s) · 1404-d</span>
        </div>
      </div>
      <button class="btn btn-danger btn-xs btn-excluir" data-nome="${encodeURIComponent(user.nome)}" title="Excluir">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
        <span>Excluir</span>
      </button>
    `;
    card.querySelector('.btn-excluir').addEventListener('click', () => excluirUsuario(user.nome));
    DOM.usuariosGrid.appendChild(card);
  });
}

async function excluirUsuario(nome) {
  if (!confirm(`Excluir "${nome}" e todos os seus vetores?`)) return;
  try {
    const res  = await fetch(`/api/usuarios/${encodeURIComponent(nome)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.sucesso) { carregarUsuarios(); carregarPreviewJson(); atualizarBadgeUsuarios(); }
    else alert(data.erro || 'Falha ao excluir.');
  } catch { alert('Erro de conexão.'); }
}

// ============================================================
// TELA REGISTROS
// ============================================================
function configurarEventosRegistros() {
  if (DOM.btnAtualizarRegistros) DOM.btnAtualizarRegistros.addEventListener('click', carregarRegistros);
}

async function carregarRegistros() {
  try {
    const res   = await fetch('/api/registros');
    const dados = await res.json();
    if (!dados.registros || dados.registros.length === 0) {
      if (DOM.registrosTableBody) DOM.registrosTableBody.innerHTML = '';
      if (DOM.registrosVazio) DOM.registrosVazio.classList.remove('hidden');
      return;
    }
    if (DOM.registrosVazio) DOM.registrosVazio.classList.add('hidden');
    renderizarTabelaRegistros(dados.registros);
  } catch (err) { console.error('[registros]', err); }
}

function renderizarTabelaRegistros(registros) {
  if (!DOM.registrosTableBody) return;
  DOM.registrosTableBody.innerHTML = '';
  registros.forEach(reg => {
    const tr = document.createElement('tr');
    const distStr = reg.distancia !== null && reg.distancia !== undefined ? Number(reg.distancia).toFixed(4) : '--';
    const iconeCheck = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    const iconeX     = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    tr.innerHTML = `
      <td class="font-mono">${reg.timestamp || reg.data || '--'}</td>
      <td><strong>${reg.nome || 'Desconhecido'}</strong></td>
      <td class="font-mono">${distStr}</td>
      <td class="font-mono">${state.limiar.toFixed(2)}</td>
      <td><span class="status-tag ${reg.liberado ? 'tag-liberado' : 'tag-negado'}">${reg.liberado ? iconeCheck : iconeX} ${reg.liberado ? 'ACESSO LIBERADO' : 'ACESSO NEGADO'}</span></td>
    `;
    DOM.registrosTableBody.appendChild(tr);
  });
}

// ============================================================
// TELA CALIBRAÇÃO
// ============================================================
function configurarEventosCalibracao() {
  if (DOM.btnCalcularCalibracao) {
    DOM.btnCalcularCalibracao.addEventListener('click', calcularCalibracao);
  }
}

async function carregarSelectCalibracao() {
  if (!DOM.calibUsuarioSelect) return;
  try {
    const res   = await fetch('/api/usuarios');
    const dados = await res.json();
    DOM.calibUsuarioSelect.innerHTML = '<option value="">-- Selecione um usuário --</option>';
    (dados.usuarios || []).forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.nome; opt.textContent = `${u.nome} (${u.amostras} amostras)`;
      DOM.calibUsuarioSelect.appendChild(opt);
    });
  } catch {}
}

async function calcularCalibracao() {
  const nome = DOM.calibUsuarioSelect.value;
  if (!nome) { if (DOM.calibFeedback) { DOM.calibFeedback.textContent = 'Selecione um usuário.'; DOM.calibFeedback.className = 'cad-feedback-box error'; } return; }

  if (DOM.calibFeedback) { DOM.calibFeedback.textContent = 'Calculando...'; DOM.calibFeedback.className = 'cad-feedback-box'; }

  try {
    const resp = await fetch('/api/calibrar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome }),
    });
    const res = await resp.json();

    if (!res.sucesso) {
      if (DOM.calibFeedback) { DOM.calibFeedback.textContent = res.erro || 'Erro.'; DOM.calibFeedback.className = 'cad-feedback-box error'; }
      return;
    }

    if (DOM.calibFeedback) { DOM.calibFeedback.textContent = `Análise para "${nome}" concluída.`; DOM.calibFeedback.className = 'cad-feedback-box success'; }
    if (DOM.calibResultado) DOM.calibResultado.style.display = 'block';

    DOM.calibIntraMin.textContent    = res.intra.min  ?? '--';
    DOM.calibIntraMax.textContent    = res.intra.max  ?? '--';
    DOM.calibIntraMedia.textContent  = res.intra.media ?? '--';
    DOM.calibIntraDistancias.textContent = `Distâncias: [${(res.intra.distancias || []).join(', ')}]`;

    DOM.calibInterMin.textContent    = res.inter.min  ?? '--';
    DOM.calibInterMax.textContent    = res.inter.max  ?? '--';
    DOM.calibInterMedia.textContent  = res.inter.media ?? '--';

    const detalhes = (res.inter.detalhes || []).map(d => `${d.pessoa}: ${d.distancia}`).join(' | ');
    DOM.calibInterDetalhes.textContent = detalhes || '(sem outros usuários cadastrados)';

    DOM.calibSugestao.textContent  = res.sugestaoLimiar ?? '--';
    DOM.calibLimiarAtual.textContent = res.limiarAtual ?? '--';

  } catch (err) {
    if (DOM.calibFeedback) { DOM.calibFeedback.textContent = `Erro: ${err.message}`; DOM.calibFeedback.className = 'cad-feedback-box error'; }
  }
}

// ============================================================
// NAVEGAÇÃO
// ============================================================
function configurarNavegacao() {
  DOM.navItems.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      if (tab) navegarPara(tab);
    });
  });
}

function navegarPara(tabName) {
  state.abaAtiva = tabName;
  DOM.navItems.forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName));
  DOM.tabViews.forEach(view => view.classList.toggle('active', view.id === `tab-${tabName}`));

  if (tabName === 'acesso') {
    iniciarCameraAcesso();
    iniciarLoopScanner();
  } else if (tabName === 'cadastro') {
    pararLoopScanner();
    iniciarCameraCadastro();
    carregarPreviewJson();
    if (DOM.cadNomeInput) DOM.cadNomeInput.focus();
  } else if (tabName === 'usuarios') {
    pararLoopScanner();
    carregarUsuarios();
  } else if (tabName === 'registros') {
    pararLoopScanner();
    carregarRegistros();
  } else if (tabName === 'calibracao') {
    pararLoopScanner();
    carregarSelectCalibracao();
  }
}

// ============================================================
// TEMA CLARO / ESCURO
// ============================================================
function configurarTema() {
  if (!DOM.btnThemeToggle) return;
  atualizarIconesTema();
  DOM.btnThemeToggle.addEventListener('click', () => {
    const escuro  = document.documentElement.getAttribute('data-theme') === 'dark';
    const novoTema = escuro ? 'light' : 'dark';
    if (novoTema === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('fg-theme', novoTema);
    atualizarIconesTema();
  });
}

function atualizarIconesTema() {
  const escuro = document.documentElement.getAttribute('data-theme') === 'dark';
  if (DOM.iconMoon)      DOM.iconMoon.classList.toggle('hidden',  escuro);
  if (DOM.iconSun)       DOM.iconSun.classList.toggle('hidden',  !escuro);
  if (DOM.btnThemeLabel) DOM.btnThemeLabel.textContent = escuro ? 'Modo Claro' : 'Modo Escuro';
}

// ============================================================
// CARREGARCONFIGURACOES
// ============================================================
async function carregarConfiguracoes() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const d = await res.json();
      state.limiar    = d.limiar    || 0.35;
      state.dimensoes = d.dimensoes || 1404;
      if (DOM.sbLimiarVal) DOM.sbLimiarVal.textContent = state.limiar.toFixed(2);
      if (DOM.sbDimVal)    DOM.sbDimVal.textContent    = `${state.dimensoes}-d`;
      // Atualiza marcador do limiar na barra
      if (DOM.thresholdMarker) DOM.thresholdMarker.style.left = `${Math.min(state.limiar * 100, 95)}%`;
      if (DOM.markerFlagTxt)   DOM.markerFlagTxt.textContent  = state.limiar.toFixed(2);
      if (DOM.labelLimiarBar)  DOM.labelLimiarBar.textContent  = `Limiar: ${state.limiar.toFixed(2)}`;
    }
  } catch (err) { console.warn('[config]', err); }
}

// ============================================================
// INIT
// ============================================================
async function init() {
  configurarTema();
  configurarNavegacao();
  configurarEventosCadastro();
  configurarEventosAcesso();
  configurarEventosUsuarios();
  configurarEventosRegistros();
  configurarEventosCalibracao();
  configurarFotoAcesso();

  window.addEventListener('beforeunload', () => pararStream(state.cameraStream));

  await carregarConfiguracoes();
  await atualizarBadgeUsuarios();

  // Carrega MediaPipe (não bloqueia a UI)
  carregarMediaPipe().then(() => {
    // Após carregar, inicia a câmera se estiver na aba Acesso
    if (state.abaAtiva === 'acesso') {
      iniciarCameraAcesso();
      iniciarLoopScanner();
    }
  });

  // Inicia navegação inicial sem câmera (câmera só abre após MediaPipe carregar)
  state.abaAtiva = 'acesso';
  DOM.navItems.forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-tab') === 'acesso'));
  DOM.tabViews.forEach(view => view.classList.toggle('active', view.id === 'tab-acesso'));
}

function configurarEventosAcesso() {
  if (DOM.btnPausarScanner) DOM.btnPausarScanner.addEventListener('click', toggleScanner);
}

function toggleScanner() {
  state.scannerAtivo = !state.scannerAtivo;
  if (state.scannerAtivo) {
    if (DOM.lblPausa)       DOM.lblPausa.textContent     = 'Pausar Scanner';
    if (DOM.scannerLaser)   DOM.scannerLaser.style.display = 'block';
    if (DOM.liveStatusText) DOM.liveStatusText.textContent = `Câmera ao vivo · ${state.intervaloScanMs}ms`;
    iniciarLoopScanner();
  } else {
    if (DOM.lblPausa)       DOM.lblPausa.textContent     = 'Retomar Scanner';
    if (DOM.scannerLaser)   DOM.scannerLaser.style.display = 'none';
    if (DOM.liveStatusText) DOM.liveStatusText.textContent = 'Scanner em pausa';
    pararLoopScanner();
    limparOverlayAcesso();
  }
}

// ============================================================
// API PÚBLICA
// ============================================================
window.FaceGateApp = { navegarPara };

// ============================================================
// ARRANQUE
// ============================================================
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
