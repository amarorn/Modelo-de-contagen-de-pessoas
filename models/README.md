# models/

Diretório local para pesos e checkpoints de modelos. **Os ficheiros binários
(`*.pt`, `*.onnx`, `*.engine`, etc.) não são versionados no git** — apenas este
README é mantido. Cada engenheiro/ambiente baixa os pesos para esta pasta.

## Onde colocar os pesos

Coloque os ficheiros aqui ou em subdiretórios temáticos. Estrutura sugerida:

```
models/
├── README.md                   # este ficheiro (versionado)
├── person_count/
│   └── exp-6.pt                # detector YOLO de pessoas
├── gender_classifier/
│   └── classification-exp-4.pt # classificador de género
└── base/
    └── yolov8m.pt              # peso base do YOLOv8
```

> Nota: o repositório também usa `weights/` como destino de pesos treinados
> internamente (saídas de `runs/.../weights/best.pt`). Ambos os diretórios
> estão no `.gitignore` para o conteúdo binário.

## Como obter os pesos

Há três formas suportadas, dependendo do contexto:

### 1. Pesos públicos (Ultralytics)

Os pesos base do YOLOv8 são baixados automaticamente pela `ultralytics` na
primeira execução, ou manualmente:

```bash
# yolov8m.pt (~50 MB)
curl -L -o models/base/yolov8m.pt \
  https://github.com/ultralytics/assets/releases/download/v8.2.0/yolov8m.pt
```

### 2. Pesos treinados internamente

Os pesos resultantes de treinos próprios (ex.: `exp-6.pt`,
`classification-exp-4.pt`) estão no armazenamento da equipa. Solicite acesso
ao responsável pelo projeto e baixe via:

```bash
# Exemplo (substitua pelo bucket/URL real fornecido pela equipa):
aws s3 cp s3://<bucket>/person_count/exp-6.pt models/person_count/exp-6.pt
```

Se usar MinIO local (ver `docker-compose.yml`):

```bash
mc cp local/models/person_count/exp-6.pt models/person_count/exp-6.pt
```

### 3. Recriar localmente via pipeline de treino

Para reproduzir os pesos do zero:

```bash
make train               # ou: python -m scripts.train_person_count
```

Os artefatos finais aparecem em `runs/detect/.../weights/best.pt` — copie
para `models/person_count/<nome>.pt` antes de usar em produção.

## Configuração

Os caminhos são lidos por variáveis de ambiente (ver `.env.example`):

| Variável               | Exemplo                                         |
| ---------------------- | ----------------------------------------------- |
| `YOLO_INFER_MODEL`     | `models/person_count/exp-6.pt`                  |
| `YOLO_SEX_MODEL`       | `models/gender_classifier/classification-exp-4.pt` |
| `YOLO_AGE_MODEL`       | _(opcional, vazio se não disponível)_          |
| `YOLO_MODEL`           | `models/base/yolov8m.pt`                        |

Aponte cada variável para o ficheiro correspondente em `models/` (ou deixe
vazia para desativar a funcionalidade).

## Verificação

Após colocar os pesos, valide a integridade:

```bash
python -c "from ultralytics import YOLO; YOLO('models/person_count/exp-6.pt')"
```

Se carregar sem erro, está pronto.
