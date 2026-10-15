import json
import cv2

FONT = cv2.FONT_HERSHEY_SIMPLEX
OPCOES = [
    ("MSMF padrao", cv2.CAP_MSMF, None, None, None),
    ("MSMF 640x480", cv2.CAP_MSMF, 640, 480, None),
    ("DSHOW padrao", cv2.CAP_DSHOW, None, None, None),
    ("DSHOW MJPG 640x480", cv2.CAP_DSHOW, 640, 480, "MJPG"),
    ("DSHOW YUY2 640x480", cv2.CAP_DSHOW, 640, 480, "YUY2"),
    ("DSHOW MJPG 1280x720", cv2.CAP_DSHOW, 1280, 720, "MJPG"),
]
NOMES = {cv2.CAP_MSMF: "MSMF", cv2.CAP_DSHOW: "DSHOW"}


def abrir(opc):
    nome, backend, w, h, fcc = opc
    cap = cv2.VideoCapture(0, backend)
    if not cap.isOpened():
        return None
    if fcc:
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*fcc))
    if w:
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, w)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
    return cap


i = 0
while i < len(OPCOES):
    opc = OPCOES[i]
    cap = abrir(opc)
    if cap is None:
        print("nao abriu:", opc[0])
        i += 1
        continue
    print("Testando:", opc[0], "| ESPACO = imagem boa | N = proxima | Q = sair")
    acao = None
    while True:
        ok, frame = cap.read()
        if ok:
            cv2.putText(frame, opc[0], (10, 25), FONT, 0.7, (0, 255, 255), 2)
            cv2.imshow("Teste de camera", frame)
        k = cv2.waitKey(30) & 0xFF
        if k == 32:
            acao = "ok"
            break
        if k == ord("n"):
            acao = "next"
            break
        if k == ord("q"):
            acao = "quit"
            break
    cap.release()
    if acao == "ok":
        cfg = {"backend": NOMES[opc[1]], "w": opc[2], "h": opc[3], "fourcc": opc[4]}
        json.dump(cfg, open("camera_cfg.json", "w"))
        print("Salvo em camera_cfg.json:", cfg)
        break
    if acao == "quit":
        break
    i += 1
cv2.destroyAllWindows()
