import json, time, threading
from pathlib import Path
import cv2, numpy as np, face_recognition
from flask import Flask, Response, jsonify, request

LIMIAR = 0.5          # menor = mais rigoroso
AMOSTRAS = 5
ESC = 0.5
ARQ = Path("rostos_site.json")
app = Flask(__name__)
lock = threading.Lock()
E = {"jpg": None, "embs": [], "res": [], "erro": "", "amostras": [], "nome": "",
     "nomes": [], "mat": np.empty((0, 128)), "db": {}}


def carregar_base():
    db = json.loads(ARQ.read_text(encoding="utf-8")) if ARQ.exists() else {}
    nomes, mat = [], []
    for n, d in db.items():
        for e in d["embeddings"]:
            nomes.append(n)
            mat.append(e)
    with lock:
        E["nomes"] = nomes
        E["mat"] = np.array(mat) if mat else np.empty((0, 128))
        E["db"] = db


def abrir():
    p = Path("camera_cfg.json")
    cfg = json.loads(p.read_text(encoding="utf-8-sig")) if p.exists() else {}
    be = cv2.CAP_DSHOW if cfg.get("backend") == "DSHOW" else cv2.CAP_MSMF
    cap = cv2.VideoCapture(0, be)
    if cfg.get("fourcc"):
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*cfg["fourcc"]))
    if cfg.get("w"):
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, cfg["w"])
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, cfg["h"])
    return cap if cap.isOpened() else None


def camera():
    cap = abrir()
    if cap is None:
        E["erro"] = "Nao consegui abrir a camera pelo Python."
        return
    n = 0
    while True:
        ok, f = cap.read()
        if not ok:
            time.sleep(0.05)
            continue
        f = cv2.flip(f, 1)
        n += 1
        if n % 2 == 0:
            rgb = cv2.cvtColor(cv2.resize(f, (0, 0), fx=ESC, fy=ESC), cv2.COLOR_BGR2RGB)
            locs = face_recognition.face_locations(rgb)
            embs = face_recognition.face_encodings(rgb, locs)
            locs = [tuple(int(v / ESC) for v in l) for l in locs]
            res = []
            for loc, e in zip(locs, embs):
                with lock:
                    mat, nomes = E["mat"], E["nomes"]
                if len(mat):
                    d = np.linalg.norm(mat - e, axis=1)
                    i = int(np.argmin(d))
                    dist = float(d[i])
                else:
                    i, dist = None, None
                lib = dist is not None and dist < LIMIAR
                res.append({"loc": loc, "lib": lib, "nome": nomes[i] if lib else None, "dist": dist})
            with lock:
                E["embs"], E["res"] = embs, res
        with lock:
            res = list(E["res"])
        for r in res:
            t, rt, b, l = r["loc"]
            cv2.rectangle(f, (l, t), (rt, b), (0, 200, 0) if r["lib"] else (0, 0, 255), 3)
        E["jpg"] = cv2.imencode(".jpg", f, [cv2.IMWRITE_JPEG_QUALITY, 80])[1].tobytes()


def gen():
    while True:
        j = E["jpg"]
        if j:
            yield b"--f\r\nContent-Type: image/jpeg\r\n\r\n" + j + b"\r\n"
        time.sleep(0.04)


@app.route("/video")
def video():
    return Response(gen(), mimetype="multipart/x-mixed-replace; boundary=f")


@app.route("/status")
def status():
    with lock:
        res = list(E["res"])
        users = [{"nome": n, "n": len(d["embeddings"])} for n, d in E["db"].items()]
    s = {"tipo": "aguardando"}
    if res:
        r = res[0]
        s = {"tipo": "liberado" if r["lib"] else "negado", "nome": r["nome"], "dist": r["dist"]}
    return jsonify({"s": s, "erro": E["erro"], "amostras": len(E["amostras"]),
                    "total": AMOSTRAS, "users": users, "limiar": LIMIAR})


@app.route("/capturar", methods=["POST"])
def capturar():
    nome = (request.get_json() or {}).get("nome", "").strip()
    if not nome:
        return jsonify({"ok": False, "msg": "Digite o nome."})
    with lock:
        embs = list(E["embs"])
    if len(embs) != 1:
        return jsonify({"ok": False, "msg": "Precisa ter exatamente 1 rosto na camera."})
    if E["nome"] != nome:
        E["nome"], E["amostras"] = nome, []
    E["amostras"].append(embs[0].tolist())
    if len(E["amostras"]) >= AMOSTRAS:
        db = json.loads(ARQ.read_text(encoding="utf-8")) if ARQ.exists() else {}
        db[nome] = {"embeddings": E["amostras"]}
        ARQ.write_text(json.dumps(db, indent=2, ensure_ascii=False), encoding="utf-8")
        E["amostras"], E["nome"] = [], ""
        carregar_base()
        return jsonify({"ok": True, "msg": nome + " cadastrado!"})
    return jsonify({"ok": True, "msg": "Amostra %d/%d ok" % (len(E["amostras"]), AMOSTRAS)})


@app.route("/limpar", methods=["POST"])
def limpar():
    E["amostras"], E["nome"] = [], ""
    return jsonify({"ok": True})


@app.route("/usuario/<nome>", methods=["DELETE"])
def apagar(nome):
    db = json.loads(ARQ.read_text(encoding="utf-8")) if ARQ.exists() else {}
    db.pop(nome, None)
    ARQ.write_text(json.dumps(db, indent=2, ensure_ascii=False), encoding="utf-8")
    carregar_base()
    return jsonify({"ok": True})


PAGINA = r"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FaceGate</title>
<style>
:root{--bg:#FFF5F9;--c:#fff;--bd:#F8D7E7;--tx:#4A2B45;--mu:#9A7B92;--pk:#FF6FAE;--lv:#B79CFF;--ok:#2FBF8A;--no:#FF5C80}
@media(prefers-color-scheme:dark){:root{--bg:#1B1325;--c:#2A1D38;--bd:#46305A;--tx:#F6E9F5;--mu:#B9A3C2;--ok:#5CE6B0;--no:#FF7A96}}
*{box-sizing:border-box}body{margin:0;padding:24px;background:var(--bg);color:var(--tx);font-family:system-ui,Segoe UI,sans-serif}
h1{margin:0 0 4px}.sub{color:var(--mu);margin-bottom:20px}.g{display:flex;gap:20px;flex-wrap:wrap}
.card{background:var(--c);border:1px solid var(--bd);border-radius:24px;padding:20px;margin-bottom:16px}
.v{flex:2 1 460px}.v img{width:100%;border-radius:20px;border:3px solid var(--pk);display:block;background:#000;min-height:240px}
.r{flex:1 1 300px}.big{font-size:28px;font-weight:800;margin:6px 0}.mu{color:var(--mu);font-size:14px}
input{width:100%;padding:13px 16px;border-radius:16px;border:1px solid var(--bd);background:transparent;color:var(--tx);font-size:16px;margin:10px 0}
button{width:100%;padding:13px;border:0;border-radius:999px;background:linear-gradient(90deg,var(--pk),var(--lv));color:#fff;font-size:16px;font-weight:700;cursor:pointer;margin-top:6px}
button.s{background:transparent;color:var(--mu);border:1px solid var(--bd)}a{color:var(--pk);cursor:pointer}
</style></head><body>
<h1>FaceGate</h1><div class="sub">Reconhecimento facial ao vivo por embeddings (128 numeros)</div>
<div class="g"><div class="v"><img src="/video" alt="camera"></div>
<div class="r"><div class="card"><div class="mu">STATUS DE ACESSO</div><div class="big" id="t">AGUARDANDO ROSTO</div><div id="d" class="mu"></div></div>
<div class="card"><div class="mu">CADASTRAR ROSTO</div><input id="nome" placeholder="Seu nome">
<button id="cap">Capturar amostra (0/5)</button><button class="s" id="lim">Recomecar</button><div id="m" class="mu" style="margin-top:10px"></div></div>
<div class="card"><div class="mu">CADASTRADOS</div><div id="u">-</div></div></div></div>
<script>
const $=i=>document.getElementById(i);
async function st(){try{const j=await(await fetch('/status')).json();const s=j.s,t=$('t');
if(j.erro){t.textContent='CAMERA INDISPONIVEL';$('d').textContent=j.erro;return}
if(s.tipo=='liberado'){t.textContent='ACESSO LIBERADO';t.style.color='var(--ok)';$('d').textContent=s.nome+' - distancia '+s.dist.toFixed(2)+' < '+j.limiar}
else if(s.tipo=='negado'){t.textContent='ACESSO NEGADO';t.style.color='var(--no)';$('d').textContent=s.dist==null?'Pessoa nao cadastrada (sem cadastros)':'Pessoa nao cadastrada - distancia '+s.dist.toFixed(2)+' >= '+j.limiar}
else{t.textContent='AGUARDANDO ROSTO';t.style.color='';$('d').textContent=''}
$('cap').textContent='Capturar amostra ('+j.amostras+'/'+j.total+')';
$('u').innerHTML=j.users.length?j.users.map(u=>u.nome+' ('+u.n+') <a onclick="del(\''+encodeURIComponent(u.nome)+'\')">excluir</a>').join('<br>'):'Nenhum cadastro'}catch(e){}}
async function cap(){const r=await(await fetch('/capturar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nome:$('nome').value})})).json();$('m').textContent=r.msg;st()}
async function del(n){await fetch('/usuario/'+n,{method:'DELETE'});st()}
$('cap').onclick=cap;$('lim').onclick=async()=>{await fetch('/limpar',{method:'POST'});$('m').textContent='';st()};
document.addEventListener('keydown',e=>{if(e.code=='Space'&&document.activeElement.tagName!='INPUT'){e.preventDefault();cap()}});
setInterval(st,400);st();
</script></body></html>"""


@app.route("/")
def home():
    return PAGINA


if __name__ == "__main__":
    carregar_base()
    threading.Thread(target=camera, daemon=True).start()
    print("Abra http://localhost:5050")
    app.run(host="127.0.0.1", port=5050, threaded=True)
    