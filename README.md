# FaceGate — Reconhecimento Facial com MediaPipe

Sistema de controle de acesso biométrico por geometria facial.  
Detecção 100% no navegador via **MediaPipe Face Landmarker** (478 pontos 3D).  
Backend em **Flask** — apenas armazena e compara os vetores.

## Como rodar

### 1. Instalar dependências
```bash
pip install -r requirements.txt
```

### 2. Iniciar o servidor
```bash
python app.py
```

### 3. Acessar no navegador
```
http://localhost:5000
```

> ⚠️ A câmera só funciona em `localhost` ou `https://`. Não abra o HTML diretamente como arquivo.

---

## Uso

### Aba "Cadastrar Rosto"
1. Digite o nome da pessoa
2. Posicione o rosto na câmera
3. Clique em **"Iniciar Cadastro"** — serão capturadas 5 amostras automaticamente (~500ms de intervalo)
4. Aguarde a confirmação

### Aba "Verificar Acesso"
1. Posicione o rosto na câmera
2. Clique em **"Verificar Acesso"**
3. Resultado: **Acesso Liberado** (verde) ou **Acesso Negado** (vermelho)
4. A distância calculada e o limite são exibidos para calibração

---

## Arquivos

```
app.py            # Backend Flask (API)
requirements.txt  # Dependências Python
faces.json        # Banco de dados de rostos (criado automaticamente)
static/
  index.html      # Frontend completo (HTML + CSS + JS)
```

---

## Configuração

No topo de `app.py`:
```python
THRESHOLD = 0.06   # Menor = mais rigoroso. Aumente se houver falsos negativos.
```

---

## Como funciona

1. **Detecção**: MediaPipe detecta 478 landmarks (x, y, z) no frame de vídeo
2. **Normalização**:
   - Multiplica x pela largura, y pela altura, z pela largura do vídeo
   - Centraliza no nariz (landmark 1)
   - Divide pela distância entre os olhos (landmarks 33 ↔ 263)
3. **Cadastro**: 5 amostras são salvas em `faces.json`
4. **Verificação**: calcula a distância euclidiana média ponto a ponto entre o vetor capturado e cada amostra salva. Usa a menor distância encontrada.
5. **Decisão**: se `distância ≤ THRESHOLD` → Acesso Liberado
