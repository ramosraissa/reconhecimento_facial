# FaceGate ✿ — Controle de Acesso por Reconhecimento Facial

**FaceGate** é um sistema web moderno de controle de acesso biométrico que usa **face-api.js** rodando diretamente no navegador para detectar rostos e gerar embeddings de 128 dimensões, sem dependências nativas compiladas.

## Stack

| Camada       | Tecnologia                              |
|--------------|-----------------------------------------|
| Backend      | Node.js 18+ + Express                   |
| IA Facial    | @vladmandic/face-api (browser)          |
| Persistência | `rostos.json` e `acessos.json` (local)  |
| Estilo       | CSS com tema claro/escuro + Fredoka + Nunito + DM Mono |

---

## Instalação e Execução

### Pré-requisitos
- **Node.js 18+** — https://nodejs.org

### Passos

```bash
# 1. Entrar na pasta do projeto
cd sistema_reconhecedor_de_face

# 2. Instalar dependências (express + face-api)
npm install

# 3. Iniciar o servidor
npm start

# 4. Abrir no navegador
#    http://localhost:5000
```

---

## Como Usar

### Cadastrar um rosto
1. Clique em **Cadastro** na sidebar
2. Digite o nome completo no campo de texto
3. Posicione o rosto dentro da guia oval no vídeo
4. Clique em **Capturar Amostra** (ou pressione **Espaço**) — 5 vezes
5. Clique em **Salvar Cadastro no rostos.json**

### Verificar acesso
1. Clique em **Acesso** na sidebar
2. A câmera abre automaticamente e inicia a varredura a cada ~500ms
3. Quando um rosto é detectado e reconhecido:
   - **Verde** = ACESSO LIBERADO (distância < 0.50)
   - **Coral** = ACESSO NEGADO (distância ≥ 0.50)

### Modo escuro
Clique no botão 🌙 **Modo Escuro** na sidebar. A preferência é salva no `localStorage`.

---

## Ajuste do Limiar

O limiar de reconhecimento é a constante `LIMIAR = 0.5` no topo do arquivo [`server.js`](server.js).

| Valor  | Efeito                                   |
|--------|------------------------------------------|
| `0.40` | Mais restritivo — exige mais similaridade |
| `0.50` | Padrão recomendado                        |
| `0.60` | Mais permissivo — aceita mais variações   |

---

## API REST

| Método | Rota                  | Descrição                                |
|--------|-----------------------|------------------------------------------|
| GET    | `/api/health`         | Status do servidor e total de cadastros  |
| GET    | `/api/config`         | Limiar e nome do modelo                  |
| POST   | `/api/cadastrar`      | Cadastrar rosto (nome + 5 embeddings)    |
| POST   | `/api/reconhecer`     | Reconhecer embedding (128 números)       |
| GET    | `/api/usuarios`       | Listar usuários cadastrados              |
| DELETE | `/api/usuarios/:nome` | Excluir usuário                          |
| GET    | `/api/registros`      | Histórico de tentativas de acesso        |
| GET    | `/api/rostos-raw`     | Conteúdo bruto do rostos.json            |

### Formato dos dados

**POST /api/cadastrar**
```json
{
  "nome": "Ana Silva",
  "embeddings": [[128 números], [128 números], [128 números], [128 números], [128 números]]
}
```

**POST /api/reconhecer**
```json
{ "embedding": [128 números] }
```

**Resposta de reconhecimento**
```json
{ "sucesso": true, "liberado": true, "nome": "Ana Silva", "distancia": 0.2341 }
```

---

## Estrutura dos Arquivos JSON

**rostos.json**
```json
{
  "Ana Silva": {
    "embeddings": [[128 números], [128 números], [128 números], [128 números], [128 números]]
  }
}
```

**acessos.json**
```json
[
  { "data": "2026-10-15T18:00:00.000Z", "timestamp": "15/10/2026, 18:00:00", "nome": "Ana Silva", "distancia": 0.2341, "liberado": true }
]
```

---

## Teste de Ponta a Ponta

```bash
# Com o servidor rodando em outro terminal:
node teste_e2e.js
```

O script executa 12 cenários (36 asserções):
- Health check
- Cadastro de embedding de teste
- Reconhecimento idêntico → libera com distância ≈ 0
- Reconhecimento aleatório → nega com distância > 6.0
- Validações de erro (400, 409)
- Listagem e exclusão de usuário

---

## Estrutura do Projeto

```
sistema_reconhecedor_de_face/
├── server.js          ← Servidor Express (backend)
├── package.json
├── teste_e2e.js       ← Testes automatizados
├── rostos.json        ← Criado automaticamente
├── acessos.json       ← Criado automaticamente
├── static/
│   ├── css/style.css  ← Tema claro/escuro
│   └── js/app.js      ← Lógica do navegador (face-api)
├── templates/
│   └── index.html     ← Interface HTML
└── node_modules/
    └── @vladmandic/face-api/
        ├── dist/face-api.js    ← Servido em /vendor/face-api.js
        └── model/              ← Servido em /models/
```

---

## Solução de Problemas

**Câmera não aparece (quadro preto)**
- Certifique-se de acessar via `http://localhost:5000` (não `file://` nem via IP)
- Permita o acesso à câmera quando o navegador solicitar
- Se aparecer "câmera em uso", feche Teams, Zoom, OBS ou Skype
- Clique em **↺ Tentar novamente** no aviso de erro

**Modelos não carregam**
- Execute `npm install` para garantir que `@vladmandic/face-api` está instalado
- Verifique se `node_modules/@vladmandic/face-api/model/` existe e tem 14 arquivos

**Porta 5000 em uso**
- Encerre o processo anterior: `Get-Process -Name node | Stop-Process -Force`
- Ou altere a constante `PORT` no topo de `server.js`
