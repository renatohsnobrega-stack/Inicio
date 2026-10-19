import { banco, q, erro, comoMembro, comoAnon } from './base.mjs';
import fs from 'fs';
const db = await banco(process.argv[2]);                       // banco como está hoje (versão antiga)
const [{ k }] = await q(db, comoMembro, `select public.criar_chave_api('Chave antiga') k`);
await q(db, comoAnon, `select public.agente_salvar($1, '[{"tipo":"remedio","id":"r1","dados":{"nome":"Losartana"}}]'::jsonb)`, [k]);
await db.exec(fs.readFileSync(process.argv[3], 'utf8').replace('seu-email@exemplo.com', 'renato@x.com').replace('email-da-esposa@exemplo.com', 'vanessa@x.com'));
const [{ l }] = await q(db, comoAnon, `select public.agente_listar($1) l`, [k]);
console.log(l.length === 1 ? '✔ migração: chave antiga continua funcionando, com acesso total, e os dados foram preservados' : '✘ falhou');
const [{ k2 }] = await q(db, comoMembro, `select public.criar_chave_api('Pierre', array['conta'], false) k2`);
console.log(k2 ? '✔ migração: já dá para criar a chave restrita' : '✘');
