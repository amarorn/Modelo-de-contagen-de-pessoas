# Plano de Validacao e Aceite

## 1. Metricas

- Contagem:
  - precision, recall, F1 de eventos `entry`/`exit`
  - erro percentual absoluto por intervalo (15 min, 1h, diario)
- Deteccao:
  - mAP50-95 para `person`
- Tracking:
  - IDF1, HOTA
- Sexo opcional:
  - macro-F1 e taxa de abstencao (`unknown`)

## 2. Protocolo de Teste

1. Coletar 7 dias de video em condicao real.
2. Rotular verdade-terreno de amostras representativas.
3. Rodar pipeline completo e comparar eventos.
4. Medir KPI por faixa horaria.

## 3. Criterios de Aceite

- F1 de contagem >= 0.92
- erro percentual medio diario <= 10%
- estabilidade operacional por 7 dias sem falha critica

## 4. Testes de Regressao

- novo modelo nao pode piorar F1 em mais de 1.5 pontos
- latencia p95 nao pode aumentar acima de 15%

## 5. Entrega Operacional

- modelo aprovado e versionado
- dashboard com KPIs de operacao
- runbook e plano de rollback validados
