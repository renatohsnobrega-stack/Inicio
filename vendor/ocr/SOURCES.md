# Componentes do OCR local

Estas cópias são servidas pelo mesmo site do Elinor, somente após solicitação de leitura. O app não usa CDN, endpoint de OCR ou modelo remoto para transmitir notas. Arquivos selecionados e texto reconhecido são processados no navegador; o upload aprovado do original vai apenas ao Supabase privado existente.

| Componente | Versão fixa | Origem pública do pacote | Licença declarada |
|---|---|---|---|
| Tesseract.js | 6.0.1 | https://registry.npmjs.org/tesseract.js/-/tesseract.js-6.0.1.tgz | Apache-2.0 |
| Tesseract.js-core (LSTM, SIMD e fallback) | 6.0.0 | https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-6.0.0.tgz | Apache-2.0 |
| Modelo português `4.0.0_best_int/por.traineddata.gz` | @tesseract.js-data/por 1.0.0 | https://registry.npmjs.org/@tesseract.js-data/por/-/por-1.0.0.tgz | Apache-2.0 no upstream https://github.com/naptha/tessdata (licença incluída em `lang/LICENSE`); o empacotamento npm declara MIT |
| PDF.js / pdfjs-dist | 5.5.207 | https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-5.5.207.tgz | Apache-2.0 |

Avisos e licenças acompanham os respectivos diretórios. `SHA256SUMS` registra a integridade das cópias distribuídas, não substitui auditoria de dependências. Não atualizar versões automaticamente; qualquer atualização exige revisão e testes locais novamente.

O carregamento é lazy. O conjunto inclui alternativas de CPU; um navegador não precisa baixar ambas. Nada de nota é guardado no cache de bibliotecas/modelos; o arquivo original não é embutido no JSON do histórico. WebAssembly, workers, idioma português e PDF worker são todos locais ao site.
