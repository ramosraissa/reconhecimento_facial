"""
FaceGate — Backend Flask integrado ao Supabase
Rotas:
  POST /api/register  { name, samples: [[x,y,z, ...], ...] }
  POST /api/verify    { sample: [x,y,z, ...] }
  GET  /api/users
  DELETE /api/users/<name>
  DELETE /api/users
Dados sincronizados com a tabela 'usuarios_cadastrados' no Supabase
e em cache local em faces.json.
"""

import os
import json
import math
import mimetypes
from datetime import datetime, timezone
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory

# ─────────────────────────────────────────────
# CARREGAMENTO DO .ENV E CONFIGURAÇÃO SUPABASE
# ─────────────────────────────────────────────
try:
    from dotenv import load_dotenv
    # Busca .env tanto na pasta atual quanto na pasta pai
    env_local = Path(__file__).resolve().parent / ".env"
    env_pai = Path(__file__).resolve().parent.parent / ".env"
    if env_local.exists():
        load_dotenv(dotenv_path=env_local)
    elif env_pai.exists():
        load_dotenv(dotenv_path=env_pai)
    else:
        load_dotenv()
except ImportError:
    for env_cand in [Path(__file__).resolve().parent / ".env", Path(__file__).resolve().parent.parent / ".env"]:
        if env_cand.exists():
            for line in env_cand.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ[k.strip()] = v.strip().strip('"').strip("'")
            break

try:
    import requests
except ImportError:
    requests = None
    print("[AVISO] Pacote 'requests' não encontrado. Execute: pip install requests")

# Suporte flexível para maiúsculas ou minúsculas nas variáveis de ambiente
SUPABASE_URL_RAW = (
    os.getenv("SUPABASE_URL") or
    os.getenv("supabase_url") or
    ""
)
SUPABASE_KEY = (
    os.getenv("SUPABASE_KEY") or
    os.getenv("supabase_secret_key") or
    os.getenv("SUPABASE_SECRET_KEY") or
    ""
)

def normalizar_supabase_url(raw_url: str) -> str:
    url = raw_url.strip().rstrip("/")
    if url and not url.endswith("/rest/v1"):
        url = f"{url}/rest/v1"
    return url

SUPABASE_REST_URL = normalizar_supabase_url(SUPABASE_URL_RAW)


def mascara_key(key: str) -> str:
    if not key or len(key) <= 10:
        return "***"
    return f"{key[:6]}...{key[-4:]}"


# Garantir mimetypes corretos para WebAssembly e ES Modules
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".mjs")

# ─────────────────────────────────────────────
# CONSTANTE AJUSTÁVEL
# ─────────────────────────────────────────────
THRESHOLD = 0.06          # Distância euclidiana média máxima para liberar acesso
FACES_FILE = Path("faces.json")

app = Flask(__name__, static_folder="static", static_url_path="/static")


@app.after_request
def ensure_custom_mimetypes(response):
    """Garante que .wasm seja servido como application/wasm e .mjs como text/javascript."""
    path = request.path.lower()
    if path.endswith(".wasm"):
        response.headers["Content-Type"] = "application/wasm"
    elif path.endswith(".mjs"):
        response.headers["Content-Type"] = "text/javascript"
    return response


# ─────────────────────────────────────────────
# INTEGRAÇÃO SUPABASE
# ─────────────────────────────────────────────

def converter_samples_para_embedding_512(samples: list) -> list[float]:
    """
    Converte as amostras faciais (ex: 478*3 = 1434 floats) em um vetor
    normalizado de exatamente 512 dimensões (requerido pelo public.vector(512)).
    """
    if not samples:
        return [0.0] * 512

    # Se for lista de listas de amostras, calcular a média das coordenadas
    num_amostras = len(samples)
    tamanho_amostra = len(samples[0])
    
    vetor_medio = [0.0] * tamanho_amostra
    for s in samples:
        for idx in range(min(tamanho_amostra, len(s))):
            vetor_medio[idx] += float(s[idx])
    vetor_medio = [v / num_amostras for v in vetor_medio]

    # Reduzir ou ajustar para exatamente 512 dimensões
    if len(vetor_medio) > 512:
        # Amostragem uniforme ao longo dos landmarks
        indices = [int(i * len(vetor_medio) / 512) for i in range(512)]
        vetor_512 = [round(float(vetor_medio[i]), 6) for i in indices]
    elif len(vetor_medio) < 512:
        vetor_512 = [round(float(x), 6) for x in vetor_medio] + [0.0] * (512 - len(vetor_medio))
    else:
        vetor_512 = [round(float(x), 6) for x in vetor_medio]

    return vetor_512


def salvar_no_supabase(nome: str, embedding_512: list[float]) -> tuple[bool, dict | str]:
    """
    Envia o registro diretamente para a tabela 'usuarios_cadastrados' no Supabase.
    Tipos das colunas:
      - nome: text
      - embedding: public.vector(512) -> enviado como list de 512 floats
      - soft_delete: boolean -> False
    """
    if not requests:
        return False, "Biblioteca requests não disponível."
    if not SUPABASE_REST_URL or not SUPABASE_KEY:
        print("[SUPABASE][ERRO] SUPABASE_URL ou SUPABASE_KEY não configuradas no .env!")
        return False, "Credenciais do Supabase não configuradas no .env."

    endpoint = f"{SUPABASE_REST_URL}/usuarios_cadastrados"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }

    payload = {
        "nome": str(nome),
        "embedding": embedding_512,
        "soft_delete": False
    }

    print("\n" + "=" * 60)
    print(" [SUPABASE] ENVIANDO CADASTRO PARA O BANCO DE DADOS")
    print(f" URL Destino:          {endpoint}")
    print(f" Campo 'nome' (text):  {payload['nome']}")
    print(f" Campo 'soft_delete':  {payload['soft_delete']} (boolean)")
    print(f" Campo 'embedding':    vector({len(payload['embedding'])}) - 512 floats")
    print(f" Primeiras 3 posições: {payload['embedding'][:3]}")
    print("-" * 60)

    try:
        resp = requests.post(endpoint, headers=headers, json=payload, timeout=10)
        print(f" [SUPABASE] Resposta HTTP Status: {resp.status_code}")
        
        if resp.status_code in (200, 201):
            dados = resp.json()
            reg = dados[0] if isinstance(dados, list) and dados else dados
            print(f" [SUPABASE][SUCESSO] Registro salvo com êxito no banco!")
            if isinstance(reg, dict):
                print(f"   - ID Gerado:   {reg.get('id')}")
                print(f"   - Nome:        {reg.get('nome')}")
                print(f"   - Timestamp:   {reg.get('timestamp')}")
                print(f"   - Soft Delete: {reg.get('soft_delete')}")
            print("=" * 60 + "\n")
            return True, reg
        else:
            print(f" [SUPABASE][FALHA NA GRAVAÇÃO] Código de status: {resp.status_code}")
            print(f" [SUPABASE][DETALHES DO ERRO]: {resp.text}")
            print("=" * 60 + "\n")
            return False, resp.text
    except Exception as e:
        print(f" [SUPABASE][EXCEÇÃO DE CONEXÃO]: {e}")
        print("=" * 60 + "\n")
        return False, str(e)


def desativar_no_supabase(nome: str) -> None:
    """Atualiza o registro no Supabase marcando soft_delete = True."""
    if not requests or not SUPABASE_REST_URL or not SUPABASE_KEY:
        return
    endpoint = f"{SUPABASE_REST_URL}/usuarios_cadastrados?nome=eq.{nome}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "soft_delete": True,
        "deleted_at": datetime.now(timezone.utc).isoformat()
    }
    try:
        r = requests.patch(endpoint, headers=headers, json=payload, timeout=10)
        print(f"[SUPABASE] Desativação (soft_delete) de '{nome}': Status {r.status_code}")
    except Exception as e:
        print(f"[SUPABASE] Falha ao desativar '{nome}' no Supabase: {e}")


# ─────────────────────────────────────────────
# UTILITÁRIOS LOCAIS
# ─────────────────────────────────────────────

def load_faces() -> dict:
    """Carrega o banco de rostos do arquivo JSON local."""
    if FACES_FILE.exists():
        try:
            return json.loads(FACES_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_faces(db: dict) -> None:
    """Salva o banco de rostos no arquivo JSON local."""
    FACES_FILE.write_text(json.dumps(db, indent=2, ensure_ascii=False), encoding="utf-8")


def euclidean_distance(a: list, b: list) -> float:
    """Distancia euclidiana media entre dois vetores de landmarks (x,y,z por ponto)."""
    if len(a) != len(b) or len(a) == 0:
        return float("inf")
    n_points = len(a) // 3
    total = 0.0
    for i in range(n_points):
        dx = a[i*3]   - b[i*3]
        dy = a[i*3+1] - b[i*3+1]
        dz = a[i*3+2] - b[i*3+2]
        total += math.sqrt(dx*dx + dy*dy + dz*dz)
    return total / n_points


# ─────────────────────────────────────────────
# ROTAS
# ─────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/api/users", methods=["GET"])
def api_users():
    """Lista todos os usuarios cadastrados."""
    db = load_faces()
    users = [{"name": name, "samples": len(data.get("samples", []))}
             for name, data in db.items()]
    return jsonify({"users": users})


import urllib.parse

@app.route("/api/users/<path:name>", methods=["DELETE"])
def api_delete_user(name):
    """Remove um usuario do banco de faces e marca soft_delete no Supabase."""
    name_decoded = urllib.parse.unquote(name).strip()
    db = load_faces()

    target_name = None
    if name in db:
        target_name = name
    elif name_decoded in db:
        target_name = name_decoded

    if not target_name:
        return jsonify({"ok": False, "msg": f"Usuário '{name_decoded or name}' não encontrado."}), 404

    del db[target_name]
    save_faces(db)
    
    # Atualiza no Supabase
    desativar_no_supabase(target_name)
    
    return jsonify({"ok": True, "msg": f"Usuário '{target_name}' removido com sucesso."})


@app.route("/api/users", methods=["DELETE"])
def api_delete_all_users():
    """Remove todos os usuarios cadastrados localmente."""
    save_faces({})
    return jsonify({"ok": True, "msg": "Todos os usuários locais foram removidos."})


@app.route("/api/register", methods=["POST"])
def api_register():
    """
    Cadastra um novo rosto.
    Body JSON: { "name": str, "samples": [[float, ...], ...] }
    """
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    samples = body.get("samples", [])

    if not name:
        return jsonify({"ok": False, "msg": "Nome não informado."}), 400
    if not samples or not isinstance(samples, list):
        return jsonify({"ok": False, "msg": "Nenhuma amostra enviada."}), 400

    # 1. Salva localmente em faces.json para a verificação em tempo real
    db = load_faces()
    db[name] = {"samples": samples}
    save_faces(db)

    # 2. Converte as amostras para o vetor de 512 dimensões esperado pelo pgvector
    vetor_512 = converter_samples_para_embedding_512(samples)

    # 3. Envia para a tabela usuarios_cadastrados no Supabase com prints detalhados
    sucesso_supabase, info = salvar_no_supabase(name, vetor_512)

    status_msg = f"{name} cadastrado com sucesso!"
    if sucesso_supabase:
        status_msg += " (Sincronizado com Supabase)"
    else:
        status_msg += " (Aviso: falha na sincronização com Supabase)"

    return jsonify({
        "ok": True,
        "msg": status_msg,
        "supabase_ok": sucesso_supabase,
        "supabase_info": info if isinstance(info, dict) else str(info)
    })


@app.route("/api/verify", methods=["POST"])
def api_verify():
    """
    Verifica se o rosto enviado pertence a alguem cadastrado.
    Body JSON: { "sample": [float, ...] }
    Retorna: { "access": bool, "name": str|null, "distance": float, "threshold": float }
    """
    body = request.get_json(silent=True) or {}
    sample = body.get("sample", [])

    if not sample:
        return jsonify({"ok": False, "msg": "Nenhuma amostra enviada."}), 400

    db = load_faces()
    if not db:
        return jsonify({
            "ok": True,
            "access": False,
            "name": None,
            "distance": None,
            "threshold": THRESHOLD,
            "msg": "Nenhum usuario cadastrado."
        })

    best_name = None
    best_dist = float("inf")

    for name, data in db.items():
        for saved_sample in data.get("samples", []):
            dist = euclidean_distance(sample, saved_sample)
            if dist < best_dist:
                best_dist = dist
                best_name = name

    access = best_dist <= THRESHOLD

    return jsonify({
        "ok": True,
        "access": access,
        "name": best_name if access else None,
        "distance": round(best_dist, 6),
        "threshold": THRESHOLD,
    })


# ─────────────────────────────────────────────
# PONTO DE ENTRADA
# ─────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("  FaceGate - Reconhecimento Facial + Supabase")
    print(f"  THRESHOLD = {THRESHOLD}")
    print(f"  Supabase URL: {SUPABASE_REST_URL or 'NÃO ENCONTRADA'}")
    print(f"  Supabase KEY: {mascara_key(SUPABASE_KEY)}")
    print("  Acesse: http://localhost:5000")
    print("=" * 60)
    app.run(host="127.0.0.1", port=5000, debug=False)
