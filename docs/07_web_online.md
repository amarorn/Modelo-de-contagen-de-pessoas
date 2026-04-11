# Dashboard Web e Acesso Online

## 1. Rodar no navegador local

Com ambiente virtual ativo:

```bash
source .venv/bin/activate
bash scripts/run_web.sh
```

Abra no navegador:

- `http://localhost:8080`

O dashboard mostra:

- video com deteccao
- entradas, saidas e total em tempo real
- botao para exportar CSV final

## 2. Acessar de outro dispositivo na mesma rede

Descubra o IP da maquina (Mac):

```bash
ipconfig getifaddr en0
```

Abra no celular/PC da rede:

- `http://SEU_IP:8080`

## 3. Publicar na internet com Cloudflare Tunnel

Instalar `cloudflared`:

```bash
brew install cloudflared
```

Com o dashboard rodando na porta 8080, execute:

```bash
cloudflared tunnel --url http://localhost:8080
```

O comando retorna um link publico HTTPS (`https://...trycloudflare.com`) para acessar pelo navegador de qualquer lugar.

## 4. Ajustes no .env

Campos recomendados:

- `YOLO_INFER_MODEL=/Users/amaro/Downloads/exp.pt`
- `PERSON_CLASS_ID=0`
- `YOLO_WEB_SOURCE=0` (ou URL RTSP do celular)
- `WEB_PORT=8080`

## 5. Observacoes

- No macOS, libere permissao de camera para Terminal/iTerm/Python.
- Se `source=0` falhar, teste `1` ou use RTSP do celular:
  - `bash scripts/run_web.sh rtsp://IP:PORT/stream`
