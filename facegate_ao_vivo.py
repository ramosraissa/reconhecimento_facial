"""
FaceGate AO VIVO (Python + OpenCV + face_recognition)
Uso:
    python facegate_ao_vivo.py cadastrar
    python facegate_ao_vivo.py acessar
    python facegate_ao_vivo.py listar
    python facegate_ao_vivo.py apagar
"""

import json
import sys
import time
import unicodedata
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
import face_recognition

ARQUIVO = Path("rostos_ao_vivo.json")
LOG = Path("acessos_ao_vivo.json")
LIMIAR = 0.5      # menor = mais rigoroso
AMOSTRAS = 5
ESCALA = 0.5


def sem_acento(t):
    return unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode()


def carregar():
    return json.loads(ARQUIVO.read_text(encoding="utf-8")) if ARQUIVO.exists() else {}


def salvar(db):
    ARQUIVO.write_text(json.dumps(db, indent=2, ensure_ascii=False), encoding="utf-8")


def registrar_log(nome, dist, liberado):
    log = json.loads(LOG.read_text(encoding="utf-8")) if LOG.exists() else []
    log.append({"data": datetime.now().isoformat(timespec="seconds"),
                "nome": nome or "desconhecido",
                "distancia": None if dist is None else round(float(dist), 4),
                "liberado": liberado})
    LOG.write_text(json.dumps(log, indent=2, ensure_ascii=False), encoding="utf-8")


def abrir_camera():
    for backend in (cv2.CAP_DSHOW, cv2.CAP_MSMF, cv2.CAP_ANY):
        cap = cv2.VideoCapture(0, backend)
        if cap.isOpened():
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            return cap
        cap.release()
    return None


def detectar(frame_bgr):
    pequeno = cv2.resize(frame_bgr, (0, 0), fx=ESCALA, fy=ESCALA)
    rgb = cv2.cvtColor(pequeno, cv2.COLOR_BGR2RGB)
    locais = face_recognition.face_locations(rgb)
    embs = face_recognition.face_encodings(rgb, locais)
    f = 1 / ESCALA
    locais = [(int(t * f), int(r * f), int(b * f), int(l * f)) for (t, r, b, l) in locais]
    return locais, embs


def cadastrar():
    nome = input("Seu nome: ").strip()
    if not nome:
        print("Nome invalido.")
        return
    cap = abrir_camera()
    if cap is None:
        print("Nao consegui abrir a camera.")
        return
    embeddings = []
    print("ESPACO = capturar (%d amostras, mude um pouco o angulo). Q = sair." % AMOSTRAS)
    while len(embeddings) < AMOSTRAS:
        ok, frame = cap.read()
        if not ok:
            break
        frame = cv2.flip(frame, 1)
        locais, embs = detectar(frame)
        for (t, r, b, l) in locais:
            cv2.rectangle(frame, (l, t), (r, b), (255, 160, 60), 2)
        cv2.putText(frame, "%s  %d/%d  (ESPACO captura)" % (sem_acento(nome), len(embeddings), AMOSTRAS),
                    (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        cv2.imshow("FaceGate - Cadastro", frame)
        tecla = cv2.waitKey(1) & 0xFF
        if tecla == ord("q"):
            break
        if tecla == 32:
            if len(embs) != 1:
                print("Precisa ter exatamente 1 rosto na imagem.")
                continue
            embeddings.append(embs[0].tolist())
            print("Amostra %d/%d ok" % (len(embeddings), AMOSTRAS))
            time.sleep(0.3)
    cap.release()
    cv2.destroyAllWindows()
    if len(embeddings) == AMOSTRAS:
        db = carregar()
        db[nome] = {"embeddings": embeddings}
        salvar(db)
        print("'%s' cadastrado com %d embeddings em %s" % (nome, AMOSTRAS, ARQUIVO))
    else:
        print("Cadastro incompleto, nada foi salvo.")


def acessar():
    db = carregar()
    nomes, conhecidos = [], []
    for nome, dados in db.items():
        for emb in dados["embeddings"]:
            nomes.append(nome)
            conhecidos.append(np.array(emb))
    conhecidos = np.array(conhecidos) if conhecidos else np.empty((0, 128))
    if not len(conhecidos):
        print("Nenhum cadastro: todo rosto sera NEGADO.")
    cap = abrir_camera()
    if cap is None:
        print("Nao consegui abrir a camera.")
        return
    print("Camera ao vivo. Q para sair.")
    ultimo_log = 0
    quadro = 0
    resultado = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame = cv2.flip(frame, 1)
        quadro += 1
        if quadro % 2 == 0:
            locais, embs = detectar(frame)
            resultado = []
            for loc, emb in zip(locais, embs):
                if len(conhecidos):
                    dists = np.linalg.norm(conhecidos - emb, axis=1)
                    i = int(np.argmin(dists))
                    dist = float(dists[i])
                else:
                    i, dist = None, None
                liberado = dist is not None and dist < LIMIAR
                if liberado:
                    texto = "ACESSO LIBERADO - %s (%.2f)" % (sem_acento(nomes[i]), dist)
                    cor = (0, 200, 0)
                else:
                    d = "sem cadastro" if dist is None else "%.2f" % dist
                    texto = "ACESSO NEGADO (%s)" % d
                    cor = (0, 0, 255)
                resultado.append((loc, texto, cor))
                if time.time() - ultimo_log > 2:
                    registrar_log(nomes[i] if liberado else None, dist, liberado)
                    ultimo_log = time.time()
        if not resultado:
            cv2.putText(frame, "AGUARDANDO ROSTO", (10, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 200), 2)
        for (t, r, b, l), texto, cor in resultado:
            cv2.rectangle(frame, (l, t), (r, b), cor, 2)
            cv2.rectangle(frame, (l, b), (max(r, l + 360), b + 30), cor, cv2.FILLED)
            cv2.putText(frame, texto, (l + 5, b + 22),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2)
        cv2.imshow("FaceGate - Acesso (Q sai)", frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break
    cap.release()
    cv2.destroyAllWindows()


def listar():
    db = carregar()
    if not db:
        print("Nenhum cadastro.")
    for nome, d in db.items():
        print("- %s: %d embeddings de 128 numeros" % (nome, len(d["embeddings"])))


def apagar():
    nome = input("Nome para apagar: ").strip()
    db = carregar()
    if nome in db:
        del db[nome]
        salvar(db)
        print("Apagado.")
    else:
        print("Nome nao encontrado.")


if __name__ == "__main__":
    comandos = {"cadastrar": cadastrar, "acessar": acessar, "listar": listar, "apagar": apagar}
    if len(sys.argv) != 2 or sys.argv[1] not in comandos:
        print(__doc__)
    else:
        comandos[sys.argv[1]]()
