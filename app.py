"""
FaceGate — Backend Flask
Rotas:
  POST /api/register  { name, samples: [[x,y,z, ...], ...] }
  POST /api/verify    { sample: [x,y,z, ...] }
  GET  /api/users
Dados salvos em faces.json (criado automaticamente).
"""

import json
import math
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory

import mimetypes

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
# UTILITÁRIOS
# ─────────────────────────────────────────────

def load_faces() -> dict:
    """Carrega o banco de rostos do arquivo JSON."""
    if FACES_FILE.exists():
        try:
            return json.loads(FACES_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_faces(db: dict) -> None:
    """Salva o banco de rostos no arquivo JSON."""
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
    """Remove um usuario do banco de faces."""
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
    return jsonify({"ok": True, "msg": f"Usuário '{target_name}' removido com sucesso."})


@app.route("/api/users", methods=["DELETE"])
def api_delete_all_users():
    """Remove todos os usuarios cadastrados."""
    save_faces({})
    return jsonify({"ok": True, "msg": "Todos os usuários foram removidos com sucesso."})


@app.route("/api/register", methods=["POST"])
def api_register():
    """
    Cadastra um novo rosto.
    Body JSON: { "name": str, "samples": [[float, ...], ...] }
    Cada sample e um vetor flat de 478*3 = 1434 floats.
    """
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    samples = body.get("samples", [])

    if not name:
        return jsonify({"ok": False, "msg": "Nome nao informado."}), 400
    if not samples or not isinstance(samples, list):
        return jsonify({"ok": False, "msg": "Nenhuma amostra enviada."}), 400

    db = load_faces()
    db[name] = {"samples": samples}
    save_faces(db)

    return jsonify({"ok": True, "msg": f"{name} cadastrado com {len(samples)} amostras."})


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
    print("=" * 50)
    print("  FaceGate - Reconhecimento Facial")
    print(f"  THRESHOLD = {THRESHOLD}")
    print("  Acesse: http://localhost:5000")
    print("=" * 50)
    app.run(host="127.0.0.1", port=5000, debug=False)
