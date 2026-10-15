/**
 * FaceGate — Servidor Node.js + Express v3.0
 * Reconhecimento por geometria facial com MediaPipe Face Landmarker
 *
 * Vetor de características: 1404 números (468 pontos × x,y,z normalizados)
 * Normalização: centrado no nariz (landmark 1), escala = distância ocular (33↔263)
 *
 * Rotas:
 *  GET  /                     → Página principal (index.html)
 *  GET  /api/health           → Status do servidor
 *  GET  /api/config           → Limiar e dimensão do vetor
 *  POST /api/cadastrar        → { nome, vetores: [1..5 vetores de 1404 números] }
 *  POST /api/reconhecer       → { vetor: [1404 números] }
 *  GET  /api/usuarios         → Lista usuários cadastrados
 *  DEL  /api/usuarios/:nome   → Remove usuário
 *  GET  /api/registros        → Histórico de acessos
 *  GET  /api/rostos-raw       → Conteúdo bruto de rostos.json (preview)
 *
 *  Arquivos estáticos extras:
 *  /mediapipe/wasm/**         → node_modules/@mediapipe/tasks-vision/wasm
 *  /mediapipe/face_landmarker.task → face_landmarker.task (raiz do projeto)
 */

'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const http    = require('http');

const app  = express();
const PORT = Number(process.env.PORT) || 5000;

// ============================================================
// CONSTANTES — ajuste LIMIAR para calibrar a sensibilidade
// ============================================================
const LIMIAR    = 0.35;   // Menor que este valor → ACESSO LIBERADO
const DIMENSOES = 1404;   // 468 pontos × (x, y, z)

// ============================================================
// CAMINHOS DE PERSISTÊNCIA
// ============================================================
const ROSTOS_PATH  = path.join(__dirname, 'rostos.json');
const ACESSOS_PATH = path.join(__dirname, 'acessos.json');

// ============================================================
// INICIALIZAÇÃO DOS JSONs
// ============================================================
function garantirArquivo(filePath, valorInicial) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(valorInicial, null, 2), 'utf8');
    console.log(`  [init] Criado: ${path.basename(filePath)}`);
  }
}
garantirArquivo(ROSTOS_PATH,  {});
garantirArquivo(ACESSOS_PATH, []);

// ============================================================
// LEITURA / ESCRITA SEGURA
// ============================================================
function lerRostos()  { try { return JSON.parse(fs.readFileSync(ROSTOS_PATH,  'utf8')); } catch { return {}; } }
function lerAcessos() { try { return JSON.parse(fs.readFileSync(ACESSOS_PATH, 'utf8')); } catch { return []; } }
function salvarRostos(d)  { fs.writeFileSync(ROSTOS_PATH,  JSON.stringify(d, null, 2), 'utf8'); }
function salvarAcessos(d) { fs.writeFileSync(ACESSOS_PATH, JSON.stringify(d, null, 2), 'utf8'); }

// ============================================================
// DISTÂNCIA EUCLIDIANA — raiz(∑(aᵢ − bᵢ)²)
// ============================================================
function distanciaEuclidiana(a, b) {
  let soma = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; soma += d * d; }
  return Math.sqrt(soma);
}

// ============================================================
// VALIDAÇÃO DE VETOR (1404 números finitos)
// ============================================================
function vetorValido(v) {
  return (
    Array.isArray(v) &&
    v.length === DIMENSOES &&
    v.every(n => typeof n === 'number' && isFinite(n))
  );
}

// ============================================================
// MIDDLEWARES
// ============================================================
app.use(express.json({ limit: '25mb' }));

// Estáticos da aplicação (CSS, JS)
app.use('/static', express.static(path.join(__dirname, 'static')));

// WASM do MediaPipe (arquivos .wasm e runtime .js)
app.use('/mediapipe/wasm', express.static(
  path.join(__dirname, 'node_modules/@mediapipe/tasks-vision/wasm')
));

// Bundle ES do MediaPipe tasks-vision
app.get('/mediapipe/vision_bundle.mjs', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, 'node_modules/@mediapipe/tasks-vision/vision_bundle.mjs'));
});

// Proxy: /static/js/mediapipe_vision.js re-exporta do bundle local
app.get('/static/js/mediapipe_vision.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`export { FaceLandmarker, FilesetResolver } from '/mediapipe/vision_bundle.mjs';`);
});

// Modelo face_landmarker.task (arquivo na raiz do projeto)
app.get('/mediapipe/face_landmarker.task', (req, res) => {
  const modelPath = path.join(__dirname, 'face_landmarker.task');
  if (!fs.existsSync(modelPath)) {
    return res.status(404).json({ erro: 'face_landmarker.task não encontrado. Execute o download conforme o README.' });
  }
  res.sendFile(modelPath);
});

// ============================================================
// PÁGINA PRINCIPAL
// ============================================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'templates', 'index.html')));

// ============================================================
// GET /api/health
// ============================================================
app.get('/api/health', (req, res) => {
  const rostos = lerRostos();
  res.json({
    status:          'ok',
    servidor:        `http://localhost:${PORT}`,
    modelo:          'MediaPipe FaceLandmarker',
    dimensoes:       DIMENSOES,
    limiar:          LIMIAR,
    total_cadastros: Object.keys(rostos).length,
    node_version:    process.version
  });
});

// ============================================================
// GET /api/config
// ============================================================
app.get('/api/config', (req, res) => {
  res.json({ sucesso: true, limiar: LIMIAR, dimensoes: DIMENSOES, modelo: 'MediaPipe FaceLandmarker 1404-d' });
});

// ============================================================
// GET /api/rostos-raw
// ============================================================
app.get('/api/rostos-raw', (req, res) => res.json(lerRostos()));

// ============================================================
// POST /api/cadastrar
// Body: { nome: string, vetores: [[1404 números] × 1..5] }
// ============================================================
app.post('/api/cadastrar', (req, res) => {
  const { nome, vetores } = req.body;

  if (!nome || typeof nome !== 'string' || nome.trim() === '') {
    return res.status(400).json({ sucesso: false, erro: 'Nome inválido ou vazio.' });
  }

  if (!Array.isArray(vetores) || vetores.length < 1 || vetores.length > 5) {
    return res.status(400).json({
      sucesso: false,
      erro: `Envie de 1 a 5 vetores. Recebidos: ${Array.isArray(vetores) ? vetores.length : 0}`
    });
  }

  for (let i = 0; i < vetores.length; i++) {
    if (!vetorValido(vetores[i])) {
      return res.status(400).json({
        sucesso: false,
        erro: `Vetor #${i + 1} inválido. Cada vetor deve ter exatamente ${DIMENSOES} números finitos.`
      });
    }
  }

  const nomeLimpo = nome.trim();
  const rostos    = lerRostos();

  if (rostos[nomeLimpo]) {
    return res.status(409).json({
      sucesso: false,
      erro: `"${nomeLimpo}" já está cadastrado. Exclua antes de recadastrar.`
    });
  }

  rostos[nomeLimpo] = { vetores };
  salvarRostos(rostos);

  console.log(`  [cadastro] "${nomeLimpo}" registrado com ${vetores.length} vetor(es) de ${DIMENSOES} dimensões.`);
  return res.json({
    sucesso:  true,
    mensagem: `"${nomeLimpo}" cadastrado com sucesso com ${vetores.length} amostra(s).`
  });
});

// ============================================================
// POST /api/reconhecer
// Body: { vetor: [1404 números] }
// ============================================================
app.post('/api/reconhecer', (req, res) => {
  const { vetor } = req.body;

  if (!vetorValido(vetor)) {
    return res.status(400).json({
      sucesso: false,
      erro: `Vetor inválido. Envie um array de exatamente ${DIMENSOES} números.`
    });
  }

  const rostos = lerRostos();
  const nomes  = Object.keys(rostos);

  const registrarAcesso = (liberado, nome, distancia) => {
    try {
      const acessos = lerAcessos();
      acessos.unshift({
        data:      new Date().toISOString(),
        timestamp: new Date().toLocaleString('pt-BR'),
        nome:      nome || 'Desconhecido',
        distancia: distancia !== null ? Number(distancia.toFixed(4)) : null,
        liberado
      });
      if (acessos.length > 500) acessos.splice(500);
      salvarAcessos(acessos);
    } catch (e) {
      console.error('  [erro] Falha ao registrar acesso:', e.message);
    }
  };

  // Sem cadastros → nega sem erro
  if (nomes.length === 0) {
    registrarAcesso(false, 'Desconhecido', 1.0);
    return res.json({
      sucesso:   true,
      liberado:  false,
      nome:      null,
      distancia: null,
      mensagem:  'Nenhum cadastro encontrado no sistema.'
    });
  }

  let menorDistancia = Infinity;
  let melhorNome     = null;

  for (const nome of nomes) {
    const vetoresCadastrados = rostos[nome].vetores || [];
    for (const vetCadastrado of vetoresCadastrados) {
      if (!vetorValido(vetCadastrado)) continue;
      const dist = distanciaEuclidiana(vetor, vetCadastrado);
      if (dist < menorDistancia) {
        menorDistancia = dist;
        melhorNome     = nome;
      }
    }
  }

  const liberado = menorDistancia < LIMIAR;

  registrarAcesso(
    liberado,
    liberado ? melhorNome : 'Desconhecido',
    menorDistancia
  );

  return res.json({
    sucesso:   true,
    liberado,
    nome:      liberado ? melhorNome : null,
    distancia: Number(menorDistancia.toFixed(4))
  });
});

// ============================================================
// GET /api/usuarios
// ============================================================
app.get('/api/usuarios', (req, res) => {
  const rostos   = lerRostos();
  const usuarios = Object.entries(rostos).map(([nome, dados]) => ({
    nome,
    amostras:       (dados.vetores || []).length,
    total_amostras: (dados.vetores || []).length
  }));
  res.json({ sucesso: true, total: usuarios.length, usuarios });
});

// ============================================================
// DELETE /api/usuarios/:nome
// ============================================================
app.delete('/api/usuarios/:nome', (req, res) => {
  const nome   = decodeURIComponent(req.params.nome);
  const rostos = lerRostos();
  if (!rostos[nome]) {
    return res.status(404).json({ sucesso: false, erro: `"${nome}" não encontrado.` });
  }
  delete rostos[nome];
  salvarRostos(rostos);
  console.log(`  [delete] "${nome}" removido.`);
  res.json({ sucesso: true, mensagem: `"${nome}" removido com sucesso.` });
});

// ============================================================
// GET /api/registros
// ============================================================
app.get('/api/registros', (req, res) => {
  const acessos = lerAcessos();
  res.json({ sucesso: true, total: acessos.length, registros: acessos });
});

// ============================================================
// POST /api/calibrar
// Body: { nome } → retorna distâncias intra-pessoa e inter-pessoa
// ============================================================
app.post('/api/calibrar', (req, res) => {
  const { nome } = req.body;
  const rostos = lerRostos();
  const nomes  = Object.keys(rostos);

  if (!nome || !rostos[nome]) {
    return res.status(400).json({ sucesso: false, erro: `Usuário "${nome}" não encontrado.` });
  }

  const vetoresAlvo = rostos[nome].vetores || [];
  if (vetoresAlvo.length < 2) {
    return res.status(400).json({ sucesso: false, erro: 'São necessárias pelo menos 2 amostras para calibração intra-pessoa.' });
  }

  // Distâncias intra-pessoa (mesmo usuário, amostras diferentes)
  const intra = [];
  for (let i = 0; i < vetoresAlvo.length; i++) {
    for (let j = i + 1; j < vetoresAlvo.length; j++) {
      intra.push(Number(distanciaEuclidiana(vetoresAlvo[i], vetoresAlvo[j]).toFixed(4)));
    }
  }

  // Distâncias inter-pessoa (contra todos os outros cadastrados)
  const inter = [];
  for (const outroNome of nomes) {
    if (outroNome === nome) continue;
    for (const vetAlvo of vetoresAlvo) {
      for (const vetOutro of (rostos[outroNome].vetores || [])) {
        inter.push({
          pessoa: outroNome,
          distancia: Number(distanciaEuclidiana(vetAlvo, vetOutro).toFixed(4))
        });
      }
    }
  }

  const media = arr => arr.length ? (arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(4) : null;
  const min   = arr => arr.length ? Math.min(...arr).toFixed(4) : null;
  const max   = arr => arr.length ? Math.max(...arr).toFixed(4) : null;

  const interVals = inter.map(e => e.distancia);

  res.json({
    sucesso: true,
    nome,
    intra: { distancias: intra, media: media(intra), min: min(intra), max: max(intra) },
    inter: { detalhes: inter, media: media(interVals), min: min(interVals), max: max(interVals) },
    limiarAtual:   LIMIAR,
    sugestaoLimiar: intra.length && interVals.length
      ? Number(((Math.max(...intra) + Math.min(...interVals)) / 2).toFixed(4))
      : null,
    dica: 'O limiar ideal fica entre o max intra-pessoa e o min inter-pessoa.'
  });
});

// ============================================================
// INICIALIZAR SERVIDOR COM MENSAGEM DE ERRO CLARA SE PORTA OCUPADA
// ============================================================
const server = http.createServer(app);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ❌ ERRO: Porta ${PORT} já está em uso por outro processo.`);
    console.error(`     Solução: feche o processo que usa a porta, ou defina outra com PORT=XXXX node server.js`);
    console.error(`     Para ver quem usa a porta: netstat -ano | findstr :${PORT}\n`);
  } else {
    console.error('  ❌ Erro ao iniciar servidor:', err.message);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n  ✿ FaceGate v3 — Reconhecimento por Geometria Facial (MediaPipe)');
  console.log('  ──────────────────────────────────────────────────────────────');
  console.log(`  Acesse em   : http://localhost:${PORT}`);
  console.log(`  Health Check: http://localhost:${PORT}/api/health`);
  console.log(`  Modelo      : http://localhost:${PORT}/mediapipe/face_landmarker.task`);
  console.log(`  Limiar      : ${LIMIAR}  (1404-d geometria facial)`);
  console.log('  ──────────────────────────────────────────────────────────────\n');
});
