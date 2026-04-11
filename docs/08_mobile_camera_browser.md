# Camera do Celular de Quem Acessa

Este modo usa a camera do proprio navegador do usuario (celular ou desktop).

## 1. Subir o servidor

```bash
source .venv/bin/activate
bash scripts/run_web_mobile.sh
```

Abrir:

- `http://localhost:8081` (teste local)

## 2. Requisito importante: HTTPS no celular

Em celular, `getUserMedia` normalmente exige HTTPS (localhost e excecao local).
Para acesso externo, publique com tunnel HTTPS:

```bash
cloudflared tunnel --url http://localhost:8081
```

Use a URL HTTPS `trycloudflare.com` gerada.

## 3. Como funciona

- Cada usuario recebe uma sessao propria no browser.
- O browser captura a camera e envia frames para o backend.
- O backend roda YOLO, rastreia pessoas e conta cruzamento de linha.
- O botao `Exportar CSV` gera arquivo em `outputs/`.

## 4. Configuracao no .env

- `YOLO_INFER_MODEL=/Users/amaro/Downloads/exp.pt`
- `PERSON_CLASS_ID=0` (ou deixe vazio para detectar por nome `person`)
- `WEB_MOBILE_PORT=8081`
- `MOBILE_COUNT_LINE=0.5,0.3,0.5,0.9` (linha normalizada)
